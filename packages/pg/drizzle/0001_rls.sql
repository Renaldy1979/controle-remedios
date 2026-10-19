-- RLS (isolamento por família) + funções SECURITY DEFINER mínimas para o que acontece ANTES de saber a família.
-- Dono das funções = papel de migração (BYPASSRLS, ver docker/init-roles.sh). O papel da aplicação não tem BYPASSRLS.

-- 1) Famílias: a própria linha é a família da transação.
ALTER TABLE "families" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "families" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY family_isolation ON "families"
  USING (id = nullif(current_setting('app.familia_id', true), '')::uuid)
  WITH CHECK (id = nullif(current_setting('app.familia_id', true), '')::uuid);
--> statement-breakpoint

-- 2) Todas as tabelas com family_id: ENABLE + FORCE e a mesma política (USING e WITH CHECK).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'profiles', 'members', 'patients', 'care_assignments', 'medications', 'treatments', 'treatment_phases',
    'dose_events', 'stock_items', 'stock_movements', 'prescriptions', 'prescription_files', 'prescription_items',
    'prescription_shares', 'prescription_views', 'replenishments', 'replenishment_steps', 'notifications',
    'message_log', 'audit_log', 'api_keys', 'idempotency'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY family_isolation ON %I
         USING (family_id = nullif(current_setting(''app.familia_id'', true), '''')::uuid)
         WITH CHECK (family_id = nullif(current_setting(''app.familia_id'', true), '''')::uuid)', t);
  END LOOP;
END $$;
--> statement-breakpoint

-- 3) Tabelas da plataforma (sem família): só dentro de withPlataforma (app.plataforma = 'on').
ALTER TABLE "platform_api_keys" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "platform_api_keys" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY platform_access ON "platform_api_keys"
  USING (current_setting('app.plataforma', true) = 'on')
  WITH CHECK (current_setting('app.plataforma', true) = 'on');
--> statement-breakpoint
ALTER TABLE "platform_audit_log" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "platform_audit_log" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY platform_access ON "platform_audit_log"
  USING (current_setting('app.plataforma', true) = 'on')
  WITH CHECK (current_setting('app.plataforma', true) = 'on');
--> statement-breakpoint
-- phone_lockouts: RLS ligado e SEM política = a aplicação não lê nem grava direto; só verify_pending_phone.
ALTER TABLE "phone_lockouts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "phone_lockouts" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- 4) Trocar o número invalida o verificado: informar um número pendente novo zera o verificado.
CREATE OR REPLACE FUNCTION members_phone_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.phone_pending IS NOT NULL
     AND NEW.phone_pending IS DISTINCT FROM OLD.phone_pending
     AND NEW.phone_verified IS NOT DISTINCT FROM OLD.phone_verified THEN
    NEW.phone_verified := NULL;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER members_phone_change BEFORE UPDATE ON "members"
  FOR EACH ROW EXECUTE FUNCTION members_phone_change();
--> statement-breakpoint

-- 5) Funções SECURITY DEFINER (search_path fixo; execução só para o papel da aplicação).

-- Telefone VERIFICADO (só dígitos) → membro e família.
CREATE OR REPLACE FUNCTION resolve_member_by_phone(p_tel text)
RETURNS TABLE (member_id uuid, family_id uuid, active boolean, family_active boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT m.id, m.family_id, (m.active AND m.removed_at IS NULL), f.active
  FROM members m JOIN families f ON f.id = m.family_id
  WHERE p_tel ~ '^[0-9]{10,15}$' AND m.phone_verified = p_tel
$$;
--> statement-breakpoint

-- Usuário do Appwrite Auth (login) → membro e família.
CREATE OR REPLACE FUNCTION resolve_member_by_appwrite_user(p_appwrite_user_id text)
RETURNS TABLE (member_id uuid, family_id uuid, active boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT m.id, m.family_id, (m.active AND m.removed_at IS NULL AND f.active)
  FROM members m JOIN families f ON f.id = m.family_id
  WHERE m.appwrite_user_id = p_appwrite_user_id
$$;
--> statement-breakpoint

-- Hash da chave Bearer → família (cdf_) ou plataforma (cpl_, family_id nulo). Ignora revogadas e famílias inativas.
CREATE OR REPLACE FUNCTION resolve_api_key(p_key_hash text)
RETURNS TABLE (kind text, key_id uuid, family_id uuid, scopes text[])
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
BEGIN
  RETURN QUERY
    UPDATE api_keys k SET last_used_at = now()
    FROM families f
    WHERE k.key_hash = p_key_hash AND k.revoked_at IS NULL AND f.id = k.family_id AND f.active
    RETURNING 'family'::text, k.id, k.family_id, k.scopes;
  IF FOUND THEN RETURN; END IF;
  RETURN QUERY
    UPDATE platform_api_keys p SET last_used_at = now()
    WHERE p.key_hash = p_key_hash AND p.revoked_at IS NULL
    RETURNING 'platform'::text, p.id, NULL::uuid, p.scopes;
END $$;
--> statement-breakpoint

-- O dono do número envia o código ao WhatsApp do sistema; p_tel é o remetente real, p_code_hash o sha256 do código.
-- Resultado: verificado | invalido | bloqueado | em_uso. 5 erros por código (o código cai) e 5 por telefone em 15 min
-- → bloqueio de 15 min. Número verificado em outro usuário → em_uso e nada muda.
CREATE OR REPLACE FUNCTION verify_pending_phone(p_tel text, p_code_hash text)
RETURNS TABLE (result text, member_id uuid, family_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE v_blocked timestamptz; v_member uuid; v_family uuid;
BEGIN
  IF p_tel IS NULL OR p_tel !~ '^[0-9]{10,15}$' OR p_code_hash IS NULL OR p_code_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN QUERY SELECT 'invalido'::text, NULL::uuid, NULL::uuid; RETURN;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('verify_pending_phone:' || p_tel, 0));

  SELECT l.blocked_until INTO v_blocked FROM phone_lockouts l WHERE l.phone = p_tel;
  IF v_blocked IS NOT NULL AND v_blocked > now() THEN
    RETURN QUERY SELECT 'bloqueado'::text, NULL::uuid, NULL::uuid; RETURN;
  END IF;

  SELECT m.id, m.family_id INTO v_member, v_family
  FROM members m JOIN families f ON f.id = m.family_id
  WHERE m.phone_pending = p_tel AND m.verification_code_hash = p_code_hash AND m.verification_expires_at > now()
    AND m.verification_attempts < 5 AND m.active AND m.removed_at IS NULL AND f.active
  ORDER BY m.verification_expires_at DESC LIMIT 1
  FOR UPDATE OF m;

  IF v_member IS NULL THEN
    UPDATE members m SET
      verification_attempts = m.verification_attempts + 1,
      verification_code_hash = CASE WHEN m.verification_attempts + 1 >= 5 THEN NULL ELSE m.verification_code_hash END,
      verification_expires_at = CASE WHEN m.verification_attempts + 1 >= 5 THEN NULL ELSE m.verification_expires_at END
    WHERE m.phone_pending = p_tel AND m.verification_code_hash IS NOT NULL;
    INSERT INTO phone_lockouts AS l (phone, failures, updated_at) VALUES (p_tel, 1, now())
    ON CONFLICT (phone) DO UPDATE SET
      failures = CASE WHEN l.blocked_until IS NOT NULL OR l.updated_at < now() - interval '15 minutes' THEN 1 ELSE l.failures + 1 END,
      blocked_until = NULL,
      updated_at = now();
    UPDATE phone_lockouts l SET failures = 0, blocked_until = now() + interval '15 minutes'
    WHERE l.phone = p_tel AND l.failures >= 5;
    RETURN QUERY SELECT 'invalido'::text, NULL::uuid, NULL::uuid; RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM members m WHERE m.phone_verified = p_tel AND m.id <> v_member) THEN
    RETURN QUERY SELECT 'em_uso'::text, NULL::uuid, v_family; RETURN;
  END IF;

  UPDATE members m SET phone_verified = p_tel, phone_pending = NULL, verification_code_hash = NULL,
    verification_expires_at = NULL, verification_attempts = 0
  WHERE m.id = v_member;
  DELETE FROM phone_lockouts l WHERE l.phone = p_tel;
  RETURN QUERY SELECT 'verificado'::text, v_member, v_family; RETURN;
END $$;
--> statement-breakpoint

-- 6) Privilégios: o papel da aplicação só faz DML; funções só por EXECUTE explícito.
DO $$
BEGIN
  REVOKE ALL ON FUNCTION resolve_member_by_phone(text) FROM PUBLIC;
  REVOKE ALL ON FUNCTION resolve_member_by_appwrite_user(text) FROM PUBLIC;
  REVOKE ALL ON FUNCTION resolve_api_key(text) FROM PUBLIC;
  REVOKE ALL ON FUNCTION verify_pending_phone(text, text) FROM PUBLIC;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'medcuidar_app') THEN
    GRANT USAGE ON SCHEMA public TO medcuidar_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO medcuidar_app;
    REVOKE ALL ON "phone_lockouts" FROM medcuidar_app;
    GRANT EXECUTE ON FUNCTION resolve_member_by_phone(text) TO medcuidar_app;
    GRANT EXECUTE ON FUNCTION resolve_member_by_appwrite_user(text) TO medcuidar_app;
    GRANT EXECUTE ON FUNCTION resolve_api_key(text) TO medcuidar_app;
    GRANT EXECUTE ON FUNCTION verify_pending_phone(text, text) TO medcuidar_app;
  END IF;
END $$;
