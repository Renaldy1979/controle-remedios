-- Lote 5E-A (docs/15): uma conta do Appwrite pode ter um vínculo (linha de `members`) em várias famílias.

-- 1) O login deixa de ser único no sistema e passa a ser único DENTRO da família.
DROP INDEX IF EXISTS "members_appwrite_user_uq";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "members_family_appwrite_user_uq" ON "members" USING btree ("family_id","appwrite_user_id") WHERE "members"."appwrite_user_id" is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "members_appwrite_user_idx" ON "members" USING btree ("appwrite_user_id") WHERE "members"."appwrite_user_id" is not null;--> statement-breakpoint

-- 2) Devolve TODOS os vínculos da conta, com o que a tela de escolha precisa (o tipo de retorno muda: recria).
DROP FUNCTION IF EXISTS resolve_member_by_appwrite_user(text);--> statement-breakpoint
CREATE FUNCTION resolve_member_by_appwrite_user(p_appwrite_user_id text)
RETURNS TABLE (member_id uuid, family_id uuid, active boolean, access_state access_state, family_name text, profile_name text, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT m.id, m.family_id, (m.active AND m.removed_at IS NULL AND f.active), m.access_state, f.name, p.name, m.created_at
  FROM members m JOIN families f ON f.id = m.family_id JOIN profiles p ON p.id = m.profile_id
  WHERE m.appwrite_user_id = p_appwrite_user_id
  ORDER BY lower(f.name), m.created_at, m.id
$$;
--> statement-breakpoint

-- 3) Exclusão de uma família: a conta de login só pode ser apagada se não tiver vínculo em nenhuma outra. Responde só sim/não.
CREATE OR REPLACE FUNCTION appwrite_user_has_other_family(p_appwrite_user_id text, p_family_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM members m WHERE m.appwrite_user_id = p_appwrite_user_id AND m.family_id <> p_family_id)
$$;
--> statement-breakpoint

-- 4) Ajuste único da publicação: contas que desativações ANTIGAS bloquearam no Appwrite (agora desativar só encerra o vínculo).
CREATE OR REPLACE FUNCTION list_appwrite_users_of_inactive_members()
RETURNS TABLE (appwrite_user_id text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT DISTINCT m.appwrite_user_id FROM members m
  WHERE m.appwrite_user_id IS NOT NULL AND (NOT m.active OR m.removed_at IS NOT NULL)
$$;
--> statement-breakpoint

DO $$
BEGIN
  REVOKE ALL ON FUNCTION resolve_member_by_appwrite_user(text) FROM PUBLIC;
  REVOKE ALL ON FUNCTION appwrite_user_has_other_family(text, uuid) FROM PUBLIC;
  REVOKE ALL ON FUNCTION list_appwrite_users_of_inactive_members() FROM PUBLIC;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'medcuidar_app') THEN
    GRANT EXECUTE ON FUNCTION resolve_member_by_appwrite_user(text) TO medcuidar_app;
    GRANT EXECUTE ON FUNCTION appwrite_user_has_other_family(text, uuid) TO medcuidar_app;
    GRANT EXECUTE ON FUNCTION list_appwrite_users_of_inactive_members() TO medcuidar_app;
  END IF;
END $$;
