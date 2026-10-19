CREATE TYPE "public"."access_state" AS ENUM('invited', 'whatsapp_verified', 'active');--> statement-breakpoint
CREATE TYPE "public"."invite_kind" AS ENUM('email', 'whatsapp');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "first_access_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "first_access_links_hash_fmt" CHECK ("first_access_links"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "first_access_links_expiry" CHECK ("first_access_links"."expires_at" > "first_access_links"."created_at")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"kind" "invite_kind" NOT NULL,
	"profile_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"email" text,
	"expected_phone" text,
	"code_hash" text,
	"expires_at" timestamp with time zone NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"consumed_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_by_member_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invites_kind_fields" CHECK (("invites"."kind" = 'email' and "invites"."email" is not null and "invites"."expected_phone" is null)
    or ("invites"."kind" = 'whatsapp' and coalesce("invites"."expected_phone" ~ '^[0-9]{10,15}$', false) and coalesce("invites"."code_hash" ~ '^[0-9a-f]{64}$', false))),
	CONSTRAINT "invites_expiry" CHECK ("invites"."expires_at" > "invites"."created_at")
);
--> statement-breakpoint
ALTER TABLE "treatment_phases" DROP CONSTRAINT "treatment_phases_schedule";--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "access_state" "access_state" DEFAULT 'invited' NOT NULL;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "email_confirmed_at" timestamp with time zone;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "first_access_links" ADD CONSTRAINT "first_access_links_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "first_access_links" ADD CONSTRAINT "first_access_links_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "invites" ADD CONSTRAINT "invites_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "invites" ADD CONSTRAINT "invites_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "invites" ADD CONSTRAINT "invites_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "invites" ADD CONSTRAINT "invites_created_by_member_id_members_id_fk" FOREIGN KEY ("created_by_member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "first_access_links_token_uq" ON "first_access_links" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "first_access_links_member_idx" ON "first_access_links" USING btree ("family_id","member_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "invites_expected_phone_active_uq" ON "invites" USING btree ("expected_phone") WHERE "invites"."kind" = 'whatsapp' and "invites"."consumed_at" is null and "invites"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invites_family_idx" ON "invites" USING btree ("family_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invites_member_idx" ON "invites" USING btree ("member_id");--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_active_needs_auth" CHECK ("members"."access_state" <> 'active' or ("members"."appwrite_user_id" is not null and "members"."email" is not null and "members"."email_confirmed_at" is not null));--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_auth_only_active" CHECK ("members"."access_state" = 'active' or ("members"."appwrite_user_id" is null and "members"."email_confirmed_at" is null));--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_wa_needs_phone" CHECK ("members"."access_state" <> 'whatsapp_verified' or "members"."phone_verified" is not null);--> statement-breakpoint
ALTER TABLE "treatment_phases" ADD CONSTRAINT "treatment_phases_schedule" CHECK (("treatment_phases"."schedule_type" = 'interval' and coalesce("treatment_phases"."interval_hours" > 0, false) and "treatment_phases"."first_dose_time" is not null)
    or ("treatment_phases"."schedule_type" = 'fixed_times' and coalesce(array_length("treatment_phases"."times", 1), 0) > 0));