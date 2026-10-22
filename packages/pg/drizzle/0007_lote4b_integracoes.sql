CREATE TABLE IF NOT EXISTS "family_integrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"n8n_webhook_url" text,
	"n8n_secret_enc" text,
	"n8n_checked_at" timestamp with time zone,
	"n8n_check_ok" boolean,
	"n8n_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "family_integrations" ADD CONSTRAINT "family_integrations_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "family_integrations_family_uq" ON "family_integrations" USING btree ("family_id");--> statement-breakpoint
-- RLS por família (mesma política das demais) e permissões do papel da aplicação.
ALTER TABLE "family_integrations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "family_integrations" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY family_isolation ON "family_integrations"
  USING (family_id = nullif(current_setting('app.familia_id', true), '')::uuid)
  WITH CHECK (family_id = nullif(current_setting('app.familia_id', true), '')::uuid);
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'medcuidar_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "family_integrations" TO medcuidar_app;
  END IF;
END $$;
