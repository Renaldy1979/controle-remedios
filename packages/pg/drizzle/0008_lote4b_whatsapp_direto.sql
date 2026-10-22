CREATE TABLE IF NOT EXISTS "agent_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"turns" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"member_id" uuid,
	"operation" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"msg_id" text,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"cache_write_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"media_tokens" integer DEFAULT 0 NOT NULL,
	"cost_micros" integer DEFAULT 0 NOT NULL,
	"estimated" boolean DEFAULT false NOT NULL,
	"idem_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "whatsapp_inbound" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"msg_id" text NOT NULL,
	"phone" text NOT NULL,
	"payload" jsonb,
	"status" text DEFAULT 'pendente' NOT NULL,
	"stage" text DEFAULT 'novo' NOT NULL,
	"response_text" text,
	"response_origin" text,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_until" timestamp with time zone,
	"error_summary" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "whatsapp_inbound_status_ck" CHECK ("whatsapp_inbound"."status" in ('pendente','processando','feito','erro')),
	CONSTRAINT "whatsapp_inbound_stage_ck" CHECK ("whatsapp_inbound"."stage" in ('novo','respondido','enviado'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "whatsapp_runtime" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "family_integrations" ADD COLUMN "ai_monthly_limit_micros" integer;--> statement-breakpoint
ALTER TABLE "family_integrations" ADD COLUMN "ai_limit_notified_month" text;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "whatsapp_opt_out_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD COLUMN "send_attempts" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD COLUMN "failed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD COLUMN "error_summary" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_sessions" ADD CONSTRAINT "agent_sessions_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_sessions" ADD CONSTRAINT "agent_sessions_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_sessions_member_uq" ON "agent_sessions" USING btree ("family_id","member_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ai_usage_idem_uq" ON "ai_usage" USING btree ("family_id","idem_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_usage_family_time_idx" ON "ai_usage" USING btree ("family_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_inbound_msg_uq" ON "whatsapp_inbound" USING btree ("msg_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "whatsapp_inbound_status_idx" ON "whatsapp_inbound" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "whatsapp_inbound_phone_idx" ON "whatsapp_inbound" USING btree ("phone","created_at");--> statement-breakpoint
-- RLS por família nas tabelas novas com family_id (mesma política das demais).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ai_usage','agent_sessions'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY family_isolation ON %I USING (family_id = nullif(current_setting(''app.familia_id'', true), '''')::uuid) WITH CHECK (family_id = nullif(current_setting(''app.familia_id'', true), '''')::uuid)', t);
  END LOOP;
END $$;
--> statement-breakpoint
-- Tabelas SEM família (fila de entrada e estado do WhatsApp do sistema): só dentro de withPlataforma (app.plataforma = 'on').
ALTER TABLE "whatsapp_inbound" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "whatsapp_inbound" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY platform_access ON "whatsapp_inbound"
  USING (current_setting('app.plataforma', true) = 'on')
  WITH CHECK (current_setting('app.plataforma', true) = 'on');
--> statement-breakpoint
ALTER TABLE "whatsapp_runtime" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "whatsapp_runtime" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY platform_access ON "whatsapp_runtime"
  USING (current_setting('app.plataforma', true) = 'on')
  WITH CHECK (current_setting('app.plataforma', true) = 'on');
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'medcuidar_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "ai_usage", "agent_sessions", "whatsapp_inbound", "whatsapp_runtime" TO medcuidar_app;
  END IF;
END $$;
