CREATE TABLE IF NOT EXISTS "conversation_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "outbound_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"body" text NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"not_before" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_until" timestamp with time zone,
	"claim_count" smallint DEFAULT 0 NOT NULL,
	"sent_at" timestamp with time zone,
	"discarded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversation_state" ADD CONSTRAINT "conversation_state_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversation_state" ADD CONSTRAINT "conversation_state_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "conversation_state_member_uq" ON "conversation_state" USING btree ("family_id","member_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "outbound_messages_dedupe_uq" ON "outbound_messages" USING btree ("family_id","dedupe_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outbound_messages_pending_idx" ON "outbound_messages" USING btree ("family_id","not_before") WHERE "outbound_messages"."sent_at" is null and "outbound_messages"."discarded_at" is null;
--> statement-breakpoint
-- RLS por família nas duas tabelas novas (mesma política das demais).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['outbound_messages', 'conversation_state'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY family_isolation ON %I
         USING (family_id = nullif(current_setting(''app.familia_id'', true), '''')::uuid)
         WITH CHECK (family_id = nullif(current_setting(''app.familia_id'', true), '''')::uuid)', t);
  END LOOP;
END $$;
--> statement-breakpoint

-- Famílias ativas: a rotina de lembretes (chave de plataforma) precisa percorrer todas, sem conhecer nenhuma antes.
-- Devolve só ids, fuso e horário do resumo. Não expõe nome, membros nem dados.
CREATE OR REPLACE FUNCTION list_active_families()
RETURNS TABLE (family_id uuid, timezone text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT f.id, f.timezone FROM families f WHERE f.active AND f.deleted_at IS NULL ORDER BY f.created_at
$$;
--> statement-breakpoint

-- Primeiro acesso por WhatsApp: depois de confirmar o e-mail no Appwrite, o membro `whatsapp_verified` com ESSE e-mail
-- (definido por ele no primeiro acesso) vira `active`. Só age se houver exatamente UM candidato e o usuário do Appwrite
-- ainda não estiver ligado a nenhum membro; o e-mail vem da conta já confirmada no Appwrite, nunca de parâmetro do cliente.
CREATE OR REPLACE FUNCTION activate_member_by_email(p_email text, p_appwrite_user_id text)
RETURNS TABLE (member_id uuid, family_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE v_member uuid; v_family uuid; v_n int;
BEGIN
  IF p_email IS NULL OR p_appwrite_user_id IS NULL OR p_appwrite_user_id = '' THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM members m WHERE m.appwrite_user_id = p_appwrite_user_id) THEN RETURN; END IF;
  SELECT count(*) INTO v_n FROM members m JOIN families f ON f.id = m.family_id
   WHERE lower(m.email) = lower(p_email) AND m.access_state = 'whatsapp_verified' AND m.active AND m.removed_at IS NULL AND f.active;
  IF v_n <> 1 THEN RETURN; END IF;
  UPDATE members m SET access_state = 'active', appwrite_user_id = p_appwrite_user_id, email_confirmed_at = now()
   WHERE lower(m.email) = lower(p_email) AND m.access_state = 'whatsapp_verified' AND m.active AND m.removed_at IS NULL
   RETURNING m.id, m.family_id INTO v_member, v_family;
  IF v_member IS NULL THEN RETURN; END IF;
  RETURN QUERY SELECT v_member, v_family;
END $$;
--> statement-breakpoint

DO $$
BEGIN
  REVOKE ALL ON FUNCTION list_active_families() FROM PUBLIC;
  REVOKE ALL ON FUNCTION activate_member_by_email(text, text) FROM PUBLIC;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'medcuidar_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "outbound_messages", "conversation_state" TO medcuidar_app;
    GRANT EXECUTE ON FUNCTION list_active_families() TO medcuidar_app;
    GRANT EXECUTE ON FUNCTION activate_member_by_email(text, text) TO medcuidar_app;
  END IF;
END $$;
