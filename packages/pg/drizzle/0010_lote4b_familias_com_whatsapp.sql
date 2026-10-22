-- Famílias que o agendador do WhatsApp precisa visitar: ativas, com ao menos uma pessoa ativa de número VERIFICADO (e sem pedir PARAR)
-- e ao menos um tratamento ativo. As demais não têm o que lembrar: o custo do ciclo cresce só com quem usa o WhatsApp.
-- Só ids e fuso (como list_active_families), sem nome nem dado de saúde.
CREATE OR REPLACE FUNCTION list_whatsapp_families()
RETURNS TABLE (family_id uuid, timezone text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT f.id, f.timezone FROM families f
  WHERE f.active AND f.deleted_at IS NULL
    AND EXISTS (SELECT 1 FROM members m WHERE m.family_id = f.id AND m.active AND m.removed_at IS NULL AND m.phone_verified IS NOT NULL AND m.whatsapp_opt_out_at IS NULL)
    AND EXISTS (SELECT 1 FROM treatments t WHERE t.family_id = f.id AND t.status = 'active' AND t.deleted_at IS NULL)
  ORDER BY f.created_at
$$;
--> statement-breakpoint
DO $$
BEGIN
  REVOKE ALL ON FUNCTION list_whatsapp_families() FROM PUBLIC;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'medcuidar_app') THEN
    GRANT EXECUTE ON FUNCTION list_whatsapp_families() TO medcuidar_app;
  END IF;
END $$;
