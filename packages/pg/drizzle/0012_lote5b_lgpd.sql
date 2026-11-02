-- Lote 5B (docs/13): consentimento, autorização do paciente e exclusão agendada da família.
-- Aditiva: só colunas novas (nulas) e funções.

-- 1) Aceite da política de privacidade por pessoa (versão vigente em apps/web/src/lib/privacy.ts).
ALTER TABLE "members" ADD COLUMN "privacy_accepted_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "privacy_version" text;
--> statement-breakpoint

-- 2) Quem cadastrou o paciente declarou ter autorização da pessoa ou ser o responsável por ela.
ALTER TABLE "patients" ADD COLUMN "data_authorized_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "data_authorized_by" uuid REFERENCES "members"("id");
--> statement-breakpoint

-- 3) Exclusão agendada: `families.deleted_at` = data do pedido; `deletion_requested_by` = quem pediu (sem FK: o membro some na exclusão).
ALTER TABLE "families" ADD COLUMN "deletion_requested_by" uuid;
--> statement-breakpoint

-- 4) Famílias cuja exclusão agendada venceu (a rotina diária apaga). Só ids.
CREATE OR REPLACE FUNCTION list_families_due_for_deletion(p_days integer)
RETURNS TABLE (family_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT f.id FROM families f
  WHERE f.deleted_at IS NOT NULL AND f.deleted_at < now() - make_interval(days => GREATEST(p_days, 0))
  ORDER BY f.deleted_at
$$;
--> statement-breakpoint

-- 5) Família com exclusão agendada deixa de ser atendida pelo WhatsApp e pelas chaves de API
--    (o login do portal continua só para a tela de cancelar a exclusão).
CREATE OR REPLACE FUNCTION resolve_member_by_phone(p_tel text)
RETURNS TABLE (member_id uuid, family_id uuid, active boolean, family_active boolean, access_state access_state)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT m.id, m.family_id, (m.active AND m.removed_at IS NULL), (f.active AND f.deleted_at IS NULL), m.access_state
  FROM members m JOIN families f ON f.id = m.family_id
  WHERE p_tel ~ '^[0-9]{10,15}$' AND m.phone_verified = p_tel
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION resolve_api_key(p_key_hash text)
RETURNS TABLE (kind text, key_id uuid, family_id uuid, scopes text[])
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
BEGIN
  RETURN QUERY
    UPDATE api_keys k SET last_used_at = now()
    FROM families f
    WHERE k.key_hash = p_key_hash AND k.revoked_at IS NULL AND f.id = k.family_id AND f.active AND f.deleted_at IS NULL
    RETURNING 'family'::text, k.id, k.family_id, k.scopes;
  IF FOUND THEN RETURN; END IF;
  RETURN QUERY
    UPDATE platform_api_keys p SET last_used_at = now()
    WHERE p.key_hash = p_key_hash AND p.revoked_at IS NULL
    RETURNING 'platform'::text, p.id, NULL::uuid, p.scopes;
END $$;
--> statement-breakpoint

DO $$
BEGIN
  REVOKE ALL ON FUNCTION list_families_due_for_deletion(integer) FROM PUBLIC;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'medcuidar_app') THEN
    GRANT EXECUTE ON FUNCTION list_families_due_for_deletion(integer) TO medcuidar_app;
  END IF;
END $$;
