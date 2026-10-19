CREATE TYPE "public"."dose_channel" AS ENUM('whatsapp', 'panel', 'system');--> statement-breakpoint
CREATE TYPE "public"."control_unit" AS ENUM('unit', 'ml', 'drop', 'gram');--> statement-breakpoint
CREATE TYPE "public"."dose_status" AS ENUM('pending', 'taken', 'late', 'missed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."med_route" AS ENUM('drops', 'tablet', 'powder', 'liquid', 'ointment', 'other');--> statement-breakpoint
CREATE TYPE "public"."message_direction" AS ENUM('in', 'out');--> statement-breakpoint
CREATE TYPE "public"."message_type" AS ENUM('text', 'button', 'audio', 'image');--> statement-breakpoint
CREATE TYPE "public"."notification_kind" AS ENUM('dose_reminder', 'dose_upcoming_family', 'dose_missed', 'low_stock', 'prescription_expiring', 'replenishment_update', 'daily_summary', 'login_code', 'reply');--> statement-breakpoint
CREATE TYPE "public"."prescription_status" AS ENUM('valid', 'expired', 'awaiting_new', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."recipients_mode" AS ENUM('all_members', 'assignments_only', 'assignments_plus_family');--> statement-breakpoint
CREATE TYPE "public"."replenishment_status" AS ENUM('needs_prescription', 'prescription_received', 'purchased', 'done', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."replenishment_trigger" AS ENUM('low_stock', 'prescription_expiry', 'manual');--> statement-breakpoint
CREATE TYPE "public"."schedule_type" AS ENUM('interval', 'fixed_times');--> statement-breakpoint
CREATE TYPE "public"."share_channel" AS ENUM('internal', 'whatsapp');--> statement-breakpoint
CREATE TYPE "public"."stock_movement_type" AS ENUM('purchase', 'dose', 'adjustment', 'loss');--> statement-breakpoint
CREATE TYPE "public"."treatment_status" AS ENUM('active', 'paused', 'finished');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"name" text NOT NULL,
	"prefix" text DEFAULT 'cdf_' NOT NULL,
	"key_hash" text NOT NULL,
	"scopes" text[] DEFAULT '{}' NOT NULL,
	"created_by_member_id" uuid,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_keys_prefix" CHECK ("api_keys"."prefix" = 'cdf_')
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"actor_member_id" uuid,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"meta" jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "care_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"weekdays" smallint[] DEFAULT '{0,1,2,3,4,5,6}' NOT NULL,
	"start_time" text NOT NULL,
	"end_time" text NOT NULL,
	"priority" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "care_assignments_time_fmt" CHECK ("care_assignments"."start_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and "care_assignments"."end_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "dose_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"treatment_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"medication_id" uuid NOT NULL,
	"phase_id" uuid,
	"scheduled_at" timestamp with time zone NOT NULL,
	"status" "dose_status" DEFAULT 'pending' NOT NULL,
	"confirmed_by_member_id" uuid,
	"confirmed_at" timestamp with time zone,
	"channel" "dose_channel",
	"source_message_id" text,
	"skipped_reason" text,
	"amount" double precision NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dose_events_amount" CHECK ("dose_events"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "families" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"timezone" text DEFAULT 'America/Sao_Paulo' NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "idempotency" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"status" smallint,
	"response" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "medications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"name" text NOT NULL,
	"alternative_names" text[] DEFAULT '{}' NOT NULL,
	"route" "med_route" NOT NULL,
	"control_unit" "control_unit" NOT NULL,
	"drops_per_ml" double precision,
	"package_size" double precision,
	"requires_prescription" boolean DEFAULT false NOT NULL,
	"notes" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "medications_drops_pos" CHECK ("medications"."drops_per_ml" is null or "medications"."drops_per_ml" > 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"appwrite_user_id" text,
	"role_label" text,
	"active" boolean DEFAULT true NOT NULL,
	"receives_family_alerts" boolean DEFAULT false NOT NULL,
	"phone_verified" text,
	"phone_pending" text,
	"verification_code_hash" text,
	"verification_expires_at" timestamp with time zone,
	"verification_attempts" smallint DEFAULT 0 NOT NULL,
	"removed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "members_phone_verified_fmt" CHECK ("members"."phone_verified" is null or "members"."phone_verified" ~ '^[0-9]{10,15}$'),
	CONSTRAINT "members_phone_pending_fmt" CHECK ("members"."phone_pending" is null or "members"."phone_pending" ~ '^[0-9]{10,15}$')
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "message_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"direction" "message_direction" NOT NULL,
	"provider_message_id" text NOT NULL,
	"member_id" uuid,
	"type" "message_type" DEFAULT 'text' NOT NULL,
	"body_redacted" text,
	"transcript" text,
	"related_dose_event_id" uuid,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"kind" "notification_kind" NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"read_at" timestamp with time zone,
	"whatsapp_sent_at" timestamp with time zone,
	"dedupe_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "patients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"name" text NOT NULL,
	"birth_date" date,
	"notes" text,
	"can_use_phone" boolean DEFAULT true NOT NULL,
	"self_member_id" uuid,
	"reminder_recipients_mode" "recipients_mode" DEFAULT 'all_members' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "phone_lockouts" (
	"phone" text PRIMARY KEY NOT NULL,
	"failures" smallint DEFAULT 0 NOT NULL,
	"blocked_until" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "platform_api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"prefix" text DEFAULT 'cpl_' NOT NULL,
	"key_hash" text NOT NULL,
	"scopes" text[] DEFAULT '{}' NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_api_keys_prefix" CHECK ("platform_api_keys"."prefix" = 'cpl_')
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "platform_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key_id" uuid,
	"method" text NOT NULL,
	"route" text NOT NULL,
	"family_id" uuid,
	"masked_phone" text,
	"status" smallint NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "prescription_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"prescription_id" uuid NOT NULL,
	"storage_file_id" text NOT NULL,
	"page" integer DEFAULT 1 NOT NULL,
	"mime" text NOT NULL,
	"size" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "prescription_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"prescription_id" uuid NOT NULL,
	"medication_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "prescription_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"prescription_id" uuid NOT NULL,
	"shared_by_member_id" uuid NOT NULL,
	"channel" "share_channel" NOT NULL,
	"target_member_id" uuid,
	"target_phone" text,
	"shared_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "prescription_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"prescription_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"viewed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "prescriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"doctor_name" text,
	"specialty" text,
	"issued_on" date NOT NULL,
	"valid_until" date,
	"status" "prescription_status" DEFAULT 'valid' NOT NULL,
	"superseded_by_id" uuid,
	"is_controlled" boolean DEFAULT false NOT NULL,
	"copies" smallint,
	"notes" text,
	"uploaded_by_member_id" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prescriptions_dates" CHECK ("prescriptions"."valid_until" is null or "prescriptions"."valid_until" >= "prescriptions"."issued_on")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"name" text NOT NULL,
	"permissions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "replenishment_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"replenishment_id" uuid NOT NULL,
	"step" integer NOT NULL,
	"owner_member_id" uuid,
	"done_at" timestamp with time zone,
	"note" text,
	"prescription_id" uuid,
	"purchase_quantity" double precision
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "replenishments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"medication_id" uuid NOT NULL,
	"status" "replenishment_status" DEFAULT 'needs_prescription' NOT NULL,
	"triggered_by" "replenishment_trigger" NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "stock_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"medication_id" uuid NOT NULL,
	"control_unit" "control_unit" NOT NULL,
	"is_estimate" boolean DEFAULT false NOT NULL,
	"cached_balance" double precision DEFAULT 0 NOT NULL,
	"cached_balance_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "stock_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"stock_item_id" uuid NOT NULL,
	"type" "stock_movement_type" NOT NULL,
	"quantity" double precision NOT NULL,
	"dose_event_id" uuid,
	"replenishment_id" uuid,
	"created_by_member_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_movements_dose_link" CHECK ("stock_movements"."type" <> 'dose' or "stock_movements"."dose_event_id" is not null),
	CONSTRAINT "stock_movements_qty" CHECK ("stock_movements"."quantity" <> 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "treatment_phases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"treatment_id" uuid NOT NULL,
	"order" integer NOT NULL,
	"start_day" integer NOT NULL,
	"end_day" integer,
	"schedule_type" "schedule_type" NOT NULL,
	"interval_hours" double precision,
	"first_dose_time" text,
	"times" text[],
	"dose_amount" double precision NOT NULL,
	CONSTRAINT "treatment_phases_days" CHECK ("treatment_phases"."start_day" >= 1 and ("treatment_phases"."end_day" is null or "treatment_phases"."end_day" >= "treatment_phases"."start_day")),
	CONSTRAINT "treatment_phases_amount" CHECK ("treatment_phases"."dose_amount" > 0),
	CONSTRAINT "treatment_phases_schedule" CHECK (("treatment_phases"."schedule_type" = 'interval' and "treatment_phases"."interval_hours" > 0 and "treatment_phases"."first_dose_time" is not null)
    or ("treatment_phases"."schedule_type" = 'fixed_times' and coalesce(array_length("treatment_phases"."times", 1), 0) > 0))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "treatments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"medication_id" uuid NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"status" "treatment_status" DEFAULT 'active' NOT NULL,
	"low_stock_days" integer,
	"notes" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "treatments_dates" CHECK ("treatments"."end_date" is null or "treatments"."end_date" >= "treatments"."start_date")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_created_by_member_id_members_id_fk" FOREIGN KEY ("created_by_member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_member_id_members_id_fk" FOREIGN KEY ("actor_member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "care_assignments" ADD CONSTRAINT "care_assignments_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "care_assignments" ADD CONSTRAINT "care_assignments_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "care_assignments" ADD CONSTRAINT "care_assignments_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "dose_events" ADD CONSTRAINT "dose_events_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "dose_events" ADD CONSTRAINT "dose_events_treatment_id_treatments_id_fk" FOREIGN KEY ("treatment_id") REFERENCES "public"."treatments"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "dose_events" ADD CONSTRAINT "dose_events_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "dose_events" ADD CONSTRAINT "dose_events_medication_id_medications_id_fk" FOREIGN KEY ("medication_id") REFERENCES "public"."medications"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "dose_events" ADD CONSTRAINT "dose_events_phase_id_treatment_phases_id_fk" FOREIGN KEY ("phase_id") REFERENCES "public"."treatment_phases"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "dose_events" ADD CONSTRAINT "dose_events_confirmed_by_member_id_members_id_fk" FOREIGN KEY ("confirmed_by_member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "idempotency" ADD CONSTRAINT "idempotency_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "medications" ADD CONSTRAINT "medications_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "members" ADD CONSTRAINT "members_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "members" ADD CONSTRAINT "members_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "message_log" ADD CONSTRAINT "message_log_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "message_log" ADD CONSTRAINT "message_log_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "message_log" ADD CONSTRAINT "message_log_related_dose_event_id_dose_events_id_fk" FOREIGN KEY ("related_dose_event_id") REFERENCES "public"."dose_events"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notifications" ADD CONSTRAINT "notifications_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notifications" ADD CONSTRAINT "notifications_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "patients" ADD CONSTRAINT "patients_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "patients" ADD CONSTRAINT "patients_self_member_id_members_id_fk" FOREIGN KEY ("self_member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "platform_audit_log" ADD CONSTRAINT "platform_audit_log_key_id_platform_api_keys_id_fk" FOREIGN KEY ("key_id") REFERENCES "public"."platform_api_keys"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "prescription_files" ADD CONSTRAINT "prescription_files_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "prescription_files" ADD CONSTRAINT "prescription_files_prescription_id_prescriptions_id_fk" FOREIGN KEY ("prescription_id") REFERENCES "public"."prescriptions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "prescription_items" ADD CONSTRAINT "prescription_items_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "prescription_items" ADD CONSTRAINT "prescription_items_prescription_id_prescriptions_id_fk" FOREIGN KEY ("prescription_id") REFERENCES "public"."prescriptions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "prescription_items" ADD CONSTRAINT "prescription_items_medication_id_medications_id_fk" FOREIGN KEY ("medication_id") REFERENCES "public"."medications"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "prescription_shares" ADD CONSTRAINT "prescription_shares_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "prescription_shares" ADD CONSTRAINT "prescription_shares_prescription_id_prescriptions_id_fk" FOREIGN KEY ("prescription_id") REFERENCES "public"."prescriptions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "prescription_shares" ADD CONSTRAINT "prescription_shares_shared_by_member_id_members_id_fk" FOREIGN KEY ("shared_by_member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "prescription_shares" ADD CONSTRAINT "prescription_shares_target_member_id_members_id_fk" FOREIGN KEY ("target_member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "prescription_views" ADD CONSTRAINT "prescription_views_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "prescription_views" ADD CONSTRAINT "prescription_views_prescription_id_prescriptions_id_fk" FOREIGN KEY ("prescription_id") REFERENCES "public"."prescriptions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "prescription_views" ADD CONSTRAINT "prescription_views_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_uploaded_by_member_id_members_id_fk" FOREIGN KEY ("uploaded_by_member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "profiles" ADD CONSTRAINT "profiles_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "replenishment_steps" ADD CONSTRAINT "replenishment_steps_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "replenishment_steps" ADD CONSTRAINT "replenishment_steps_replenishment_id_replenishments_id_fk" FOREIGN KEY ("replenishment_id") REFERENCES "public"."replenishments"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "replenishment_steps" ADD CONSTRAINT "replenishment_steps_owner_member_id_members_id_fk" FOREIGN KEY ("owner_member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "replenishment_steps" ADD CONSTRAINT "replenishment_steps_prescription_id_prescriptions_id_fk" FOREIGN KEY ("prescription_id") REFERENCES "public"."prescriptions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "replenishments" ADD CONSTRAINT "replenishments_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "replenishments" ADD CONSTRAINT "replenishments_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "replenishments" ADD CONSTRAINT "replenishments_medication_id_medications_id_fk" FOREIGN KEY ("medication_id") REFERENCES "public"."medications"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_medication_id_medications_id_fk" FOREIGN KEY ("medication_id") REFERENCES "public"."medications"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_stock_item_id_stock_items_id_fk" FOREIGN KEY ("stock_item_id") REFERENCES "public"."stock_items"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_dose_event_id_dose_events_id_fk" FOREIGN KEY ("dose_event_id") REFERENCES "public"."dose_events"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_replenishment_id_replenishments_id_fk" FOREIGN KEY ("replenishment_id") REFERENCES "public"."replenishments"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_created_by_member_id_members_id_fk" FOREIGN KEY ("created_by_member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "treatment_phases" ADD CONSTRAINT "treatment_phases_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "treatment_phases" ADD CONSTRAINT "treatment_phases_treatment_id_treatments_id_fk" FOREIGN KEY ("treatment_id") REFERENCES "public"."treatments"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "treatments" ADD CONSTRAINT "treatments_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "treatments" ADD CONSTRAINT "treatments_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "treatments" ADD CONSTRAINT "treatments_medication_id_medications_id_fk" FOREIGN KEY ("medication_id") REFERENCES "public"."medications"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "api_keys_hash_uq" ON "api_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "api_keys_family_idx" ON "api_keys" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_time_idx" ON "audit_log" USING btree ("family_id","at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_entity_idx" ON "audit_log" USING btree ("family_id","entity","entity_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "care_assignments_patient_idx" ON "care_assignments" USING btree ("family_id","patient_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "dose_events_treatment_time_uq" ON "dose_events" USING btree ("treatment_id","scheduled_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "dose_events_source_message_uq" ON "dose_events" USING btree ("source_message_id") WHERE "dose_events"."source_message_id" is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dose_events_family_time_idx" ON "dose_events" USING btree ("family_id","scheduled_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dose_events_patient_time_idx" ON "dose_events" USING btree ("family_id","patient_id","scheduled_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dose_events_status_idx" ON "dose_events" USING btree ("family_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idempotency_family_key_uq" ON "idempotency" USING btree ("family_id","key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idempotency_created_idx" ON "idempotency" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "medications_family_idx" ON "medications" USING btree ("family_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "members_phone_verified_uq" ON "members" USING btree ("phone_verified") WHERE "members"."phone_verified" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "members_appwrite_user_uq" ON "members" USING btree ("appwrite_user_id") WHERE "members"."appwrite_user_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "members_family_email_uq" ON "members" USING btree ("family_id",lower("email")) WHERE "members"."email" is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "members_phone_pending_idx" ON "members" USING btree ("phone_pending") WHERE "members"."phone_pending" is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "members_family_idx" ON "members" USING btree ("family_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "message_log_provider_uq" ON "message_log" USING btree ("provider_message_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "message_log_family_time_idx" ON "message_log" USING btree ("family_id","received_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "notifications_dedupe_uq" ON "notifications" USING btree ("family_id","dedupe_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_member_idx" ON "notifications" USING btree ("family_id","member_id","read_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "patients_family_idx" ON "patients" USING btree ("family_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "platform_api_keys_hash_uq" ON "platform_api_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platform_audit_log_at_idx" ON "platform_audit_log" USING btree ("at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prescription_files_idx" ON "prescription_files" USING btree ("family_id","prescription_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "prescription_items_uq" ON "prescription_items" USING btree ("prescription_id","medication_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prescription_items_med_idx" ON "prescription_items" USING btree ("family_id","medication_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prescription_shares_idx" ON "prescription_shares" USING btree ("family_id","prescription_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prescription_views_idx" ON "prescription_views" USING btree ("family_id","prescription_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prescriptions_patient_idx" ON "prescriptions" USING btree ("family_id","patient_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prescriptions_status_idx" ON "prescriptions" USING btree ("family_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "profiles_family_name_uq" ON "profiles" USING btree ("family_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "replenishment_steps_uq" ON "replenishment_steps" USING btree ("replenishment_id","step");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "replenishment_steps_family_idx" ON "replenishment_steps" USING btree ("family_id","replenishment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "replenishments_status_idx" ON "replenishments" USING btree ("family_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "replenishments_patient_med_idx" ON "replenishments" USING btree ("family_id","patient_id","medication_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "replenishments_open_uq" ON "replenishments" USING btree ("family_id","patient_id","medication_id") WHERE "replenishments"."status" not in ('done','cancelled');--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "stock_items_patient_med_uq" ON "stock_items" USING btree ("family_id","patient_id","medication_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "stock_movements_dose_event_uq" ON "stock_movements" USING btree ("dose_event_id") WHERE "stock_movements"."dose_event_id" is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stock_movements_item_idx" ON "stock_movements" USING btree ("family_id","stock_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "treatment_phases_order_uq" ON "treatment_phases" USING btree ("treatment_id","order");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "treatment_phases_family_idx" ON "treatment_phases" USING btree ("family_id","treatment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "treatments_patient_idx" ON "treatments" USING btree ("family_id","patient_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "treatments_status_idx" ON "treatments" USING btree ("family_id","status");