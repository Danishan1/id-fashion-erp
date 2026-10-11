-- CRM Phase 12 — Message Templates.
-- Reusable, provider-neutral templates with immutable versions. Categories
-- reuse crm_option_values (list_key 'template_category'); events reuse
-- crm_events (entity TEMPLATE); audit reuses audit_logs. Outbound messages
-- record the template + exact version they were written from.

ALTER TYPE "CrmEntityType" ADD VALUE IF NOT EXISTS 'TEMPLATE';

-- Templates -------------------------------------------------------------------
CREATE TABLE "crm_message_templates" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "name_key" TEXT NOT NULL,
    "channel_type" TEXT NOT NULL,
    "category_id" UUID,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "current_version_id" UUID,
    "current_version_number" INTEGER NOT NULL DEFAULT 0,
    "search_text" TEXT NOT NULL DEFAULT '',
    "duplicated_from_id" UUID,
    "activated_at" TIMESTAMP(3),
    "activated_by_user_id" UUID,
    "archived_at" TIMESTAMP(3),
    "archived_by_user_id" UUID,
    "created_by_user_id" UUID NOT NULL,
    "updated_by_user_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_message_templates_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "crm_message_templates_channel_check" CHECK ("channel_type" IN ('EMAIL', 'SMS', 'WHATSAPP', 'FACEBOOK_MESSENGER', 'INSTAGRAM', 'WEB_CHAT', 'OTHER')),
    CONSTRAINT "crm_message_templates_status_check" CHECK ("status" IN ('DRAFT', 'ACTIVE', 'ARCHIVED')),
    CONSTRAINT "crm_message_templates_archived_check" CHECK (("status" = 'ARCHIVED') = ("archived_at" IS NOT NULL)),
    CONSTRAINT "crm_message_templates_active_version_check" CHECK ("status" <> 'ACTIVE' OR "current_version_id" IS NOT NULL),
    CONSTRAINT "crm_message_templates_version_number_check" CHECK ("current_version_number" >= 0),
    CONSTRAINT "crm_message_templates_name_check" CHECK (length(btrim("name")) > 0)
);

CREATE UNIQUE INDEX "crm_message_templates_current_version_id_key" ON "crm_message_templates"("current_version_id");
CREATE INDEX "crm_message_templates_company_id_status_updated_at_idx" ON "crm_message_templates"("company_id", "status", "updated_at");
CREATE INDEX "crm_message_templates_company_id_channel_type_status_idx" ON "crm_message_templates"("company_id", "channel_type", "status");
CREATE INDEX "crm_message_templates_company_id_category_id_idx" ON "crm_message_templates"("company_id", "category_id");
CREATE INDEX "crm_message_templates_company_id_created_at_idx" ON "crm_message_templates"("company_id", "created_at");
-- One live template per name; archived ones keep their name for history.
CREATE UNIQUE INDEX "crm_message_templates_active_name_key" ON "crm_message_templates"("company_id", "name_key") WHERE "status" <> 'ARCHIVED';

-- Versions (immutable) ----------------------------------------------------------
CREATE TABLE "crm_message_template_versions" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "variables" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "provider_metadata" JSONB NOT NULL DEFAULT '{}',
    "change_note" TEXT,
    "restored_from_id" UUID,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_message_template_versions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "crm_message_template_versions_number_check" CHECK ("version_number" >= 1)
);

CREATE UNIQUE INDEX "crm_message_template_versions_template_id_version_number_key" ON "crm_message_template_versions"("template_id", "version_number");

-- History can't be rewritten: a version is never updated or deleted.
CREATE FUNCTION "crm_message_template_versions_immutable"() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'crm_message_template_versions rows are immutable (%), add a new version instead', TG_OP
        USING ERRCODE = 'integrity_constraint_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "crm_message_template_versions_no_update"
    BEFORE UPDATE OR DELETE ON "crm_message_template_versions"
    FOR EACH ROW EXECUTE FUNCTION "crm_message_template_versions_immutable"();

-- Messages remember the template + version -------------------------------------
ALTER TABLE "crm_messages" ADD COLUMN "template_id" UUID;
ALTER TABLE "crm_messages" ADD COLUMN "template_version_id" UUID;
ALTER TABLE "crm_messages" ADD CONSTRAINT "crm_messages_template_pair_check" CHECK (("template_id" IS NULL) = ("template_version_id" IS NULL));
ALTER TABLE "crm_messages" ADD CONSTRAINT "crm_messages_template_direction_check" CHECK ("template_id" IS NULL OR "direction" = 'OUTBOUND');
-- Template usage (count + last used) without scanning all messages.
CREATE INDEX "crm_messages_template_usage_idx" ON "crm_messages"("template_id", "occurred_at") WHERE "template_id" IS NOT NULL;
CREATE INDEX "crm_messages_template_version_usage_idx" ON "crm_messages"("template_version_id") WHERE "template_version_id" IS NOT NULL;

-- Foreign keys ------------------------------------------------------------------
ALTER TABLE "crm_message_templates" ADD CONSTRAINT "crm_message_templates_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crm_message_templates" ADD CONSTRAINT "crm_message_templates_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "crm_option_values"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_message_templates" ADD CONSTRAINT "crm_message_templates_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crm_message_templates" ADD CONSTRAINT "crm_message_templates_current_version_id_fkey" FOREIGN KEY ("current_version_id") REFERENCES "crm_message_template_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_message_template_versions" ADD CONSTRAINT "crm_message_template_versions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crm_message_template_versions" ADD CONSTRAINT "crm_message_template_versions_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "crm_message_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crm_message_template_versions" ADD CONSTRAINT "crm_message_template_versions_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crm_messages" ADD CONSTRAINT "crm_messages_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "crm_message_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crm_messages" ADD CONSTRAINT "crm_messages_template_version_id_fkey" FOREIGN KEY ("template_version_id") REFERENCES "crm_message_template_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
