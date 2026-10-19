-- Estados de acesso, convites e link de primeiro acesso: RLS, gatilho e funções SECURITY DEFINER do fluxo pré-membro.

-- 1) RLS por família nas duas tabelas novas (mesma política das demais).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['invites', 'first_access_links'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY family_isolation ON %I
         USING (family_id = nullif(current_setting(''app.familia_id'', true), '''')::uuid)
         WITH CHECK (family_id = nullif(current_setting(''app.familia_id'', true), '''')::uuid)', t);
  END LOOP;
END $$;
--> statement-breakpoint

-- 2) Trocar o número invalida o verificado; quem estava `whatsapp_verified` volta a `invited`
--    (o estado exige telefone verificado).
CREATE OR REPLACE FUNCTION members_phone_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.phone_pending IS NOT NULL
     AND NEW.phone_pending IS DISTINCT FROM OLD.phone_pending
     AND NEW.phone_verified IS NOT DISTINCT FROM OLD.phone_verified THEN
    NEW.phone_verified := NULL;
    IF NEW.access_state = 'whatsapp_verified' THEN NEW.access_state := 'invited'; END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint

-- 3) As funções de resolução passam a devolver o estado de acesso (o tipo de retorno muda: recria).
DROP FUNCTION IF EXISTS resolve_member_by_phone(text);
--> statement-breakpoint
DROP FUNCTION IF EXISTS resolve_member_by_appwrite_user(text);
--> statement-breakpoint
CREATE FUNCTION resolve_member_by_phone(p_tel text)
RETURNS TABLE (member_id uuid, family_id uuid, active boolean, family_active boolean, access_state access_state)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT m.id, m.family_id, (m.active AND m.removed_at IS NULL), f.active, m.access_state
  FROM members m JOIN families f ON f.id = m.family_id
  WHERE p_tel ~ '^[0-9]{10,15}$' AND m.phone_verified = p_tel
$$;
--> statement-breakpoint
CREATE FUNCTION resolve_member_by_appwrite_user(p_appwrite_user_id text)
RETURNS TABLE (member_id uuid, family_id uuid, active boolean, access_state access_state)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT m.id, m.family_id, (m.active AND m.removed_at IS NULL AND f.active), m.access_state
  FROM members m JOIN families f ON f.id = m.family_id
  WHERE m.appwrite_user_id = p_appwrite_user_id
$$;
--> statement-breakpoint

-- 4) Convite por WhatsApp. p_tel é o REMETENTE real; p_code_hash = hashConviteCodigo(telefone, código).
--    A busca é pelo número do remetente: quem não é o número esperado não encontra o convite, não gasta tentativa
--    dele e não descobre se existe (resposta igual a "código errado"). Resultado: verificado | invalido | bloqueado | em_uso.
--    5 erros no convite o revogam; 5 erros por telefone em 15 min bloqueiam o remetente (phone_lockouts, compartilhado
--    com verify_pending_phone). Uso único: consumed_at. Marca o membro `whatsapp_verified` (se ainda `invited`).
CREATE FUNCTION consume_whatsapp_invite(p_tel text, p_code_hash text)
RETURNS TABLE (result text, member_id uuid, family_id uuid, invite_id uuid, profile_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE v_blocked timestamptz; v_inv invites%ROWTYPE;
BEGIN
  IF p_tel IS NULL OR p_tel !~ '^[0-9]{10,15}$' OR p_code_hash IS NULL OR p_code_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN QUERY SELECT 'invalido'::text, NULL::uuid, NULL::uuid, NULL::uuid, NULL::uuid; RETURN;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('verify_pending_phone:' || p_tel, 0));

  SELECT l.blocked_until INTO v_blocked FROM phone_lockouts l WHERE l.phone = p_tel;
  IF v_blocked IS NOT NULL AND v_blocked > now() THEN
    RETURN QUERY SELECT 'bloqueado'::text, NULL::uuid, NULL::uuid, NULL::uuid, NULL::uuid; RETURN;
  END IF;

  SELECT i.* INTO v_inv
  FROM invites i
  JOIN members m ON m.id = i.member_id AND m.active AND m.removed_at IS NULL
  JOIN families f ON f.id = i.family_id AND f.active
  WHERE i.kind = 'whatsapp' AND i.expected_phone = p_tel AND i.consumed_at IS NULL AND i.revoked_at IS NULL
    AND i.expires_at > now() AND i.attempts < 5
  FOR UPDATE OF i;

  IF v_inv.id IS NULL OR v_inv.code_hash <> p_code_hash THEN
    -- erro: conta no convite DESTE número (se houver) e no telefone remetente
    IF v_inv.id IS NOT NULL THEN
      UPDATE invites i SET attempts = i.attempts + 1,
        revoked_at = CASE WHEN i.attempts + 1 >= 5 THEN now() ELSE i.revoked_at END
      WHERE i.id = v_inv.id;
    END IF;
    INSERT INTO phone_lockouts AS l (phone, failures, updated_at) VALUES (p_tel, 1, now())
    ON CONFLICT (phone) DO UPDATE SET
      failures = CASE WHEN l.blocked_until IS NOT NULL OR l.updated_at < now() - interval '15 minutes' THEN 1 ELSE l.failures + 1 END,
      blocked_until = NULL,
      updated_at = now();
    UPDATE phone_lockouts l SET failures = 0, blocked_until = now() + interval '15 minutes'
    WHERE l.phone = p_tel AND l.failures >= 5;
    RETURN QUERY SELECT 'invalido'::text, NULL::uuid, NULL::uuid, NULL::uuid, NULL::uuid; RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM members m WHERE m.phone_verified = p_tel AND m.id <> v_inv.member_id) THEN
    RETURN QUERY SELECT 'em_uso'::text, NULL::uuid, v_inv.family_id, NULL::uuid, NULL::uuid; RETURN;
  END IF;

  UPDATE invites i SET consumed_at = now() WHERE i.id = v_inv.id;
  UPDATE members m SET phone_verified = p_tel, phone_pending = NULL, verification_code_hash = NULL,
    verification_expires_at = NULL, verification_attempts = 0,
    access_state = CASE WHEN m.access_state = 'invited' THEN 'whatsapp_verified'::access_state ELSE m.access_state END
  WHERE m.id = v_inv.member_id;
  DELETE FROM phone_lockouts l WHERE l.phone = p_tel;
  RETURN QUERY SELECT 'verificado'::text, v_inv.member_id, v_inv.family_id, v_inv.id, v_inv.profile_id; RETURN;
END $$;
--> statement-breakpoint

-- 5) Link de primeiro acesso: resolver (só leitura, para mostrar a tela) e consumir (uso único, atômico).
--    Aceitam o sha256 do token; token inexistente, vencido, revogado ou já usado → nenhuma linha.
CREATE FUNCTION resolve_first_access_link(p_token_hash text)
RETURNS TABLE (link_id uuid, member_id uuid, family_id uuid, email text, access_state access_state, expires_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT l.id, l.member_id, l.family_id, m.email, m.access_state, l.expires_at
  FROM first_access_links l
  JOIN members m ON m.id = l.member_id AND m.active AND m.removed_at IS NULL
  JOIN families f ON f.id = l.family_id AND f.active
  WHERE p_token_hash ~ '^[0-9a-f]{64}$' AND l.token_hash = p_token_hash
    AND l.consumed_at IS NULL AND l.revoked_at IS NULL AND l.expires_at > now()
$$;
--> statement-breakpoint
CREATE FUNCTION consume_first_access_link(p_token_hash text)
RETURNS TABLE (link_id uuid, member_id uuid, family_id uuid)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE first_access_links l SET consumed_at = now()
  FROM members m, families f
  WHERE p_token_hash ~ '^[0-9a-f]{64}$' AND l.token_hash = p_token_hash
    AND l.consumed_at IS NULL AND l.revoked_at IS NULL AND l.expires_at > now()
    AND m.id = l.member_id AND m.active AND m.removed_at IS NULL AND f.id = l.family_id AND f.active
  RETURNING l.id, l.member_id, l.family_id
$$;
--> statement-breakpoint

-- 6) Privilégios.
DO $$
BEGIN
  REVOKE ALL ON FUNCTION resolve_member_by_phone(text) FROM PUBLIC;
  REVOKE ALL ON FUNCTION resolve_member_by_appwrite_user(text) FROM PUBLIC;
  REVOKE ALL ON FUNCTION consume_whatsapp_invite(text, text) FROM PUBLIC;
  REVOKE ALL ON FUNCTION resolve_first_access_link(text) FROM PUBLIC;
  REVOKE ALL ON FUNCTION consume_first_access_link(text) FROM PUBLIC;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'medcuidar_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "invites", "first_access_links" TO medcuidar_app;
    GRANT EXECUTE ON FUNCTION resolve_member_by_phone(text) TO medcuidar_app;
    GRANT EXECUTE ON FUNCTION resolve_member_by_appwrite_user(text) TO medcuidar_app;
    GRANT EXECUTE ON FUNCTION consume_whatsapp_invite(text, text) TO medcuidar_app;
    GRANT EXECUTE ON FUNCTION resolve_first_access_link(text) TO medcuidar_app;
    GRANT EXECUTE ON FUNCTION consume_first_access_link(text) TO medcuidar_app;
  END IF;
END $$;
