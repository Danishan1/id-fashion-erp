-- CRM Phase 02 - Leads (2026-10-01).
-- Leads with configurable statuses/sources, reusable tags, notes, custom-field
-- definitions, saved views, duplicate-rule settings, and lean Company /
-- Contact / Opportunity tables used by lead conversion (extended in Phases 04-07).
-- Also adds the crm.view_all action and the crm_settings module to the
-- permission catalog and grants them (SUPER_ADMIN: all, MANAGEMENT: view_all +
-- settings view/edit) so existing databases don't need a re-seed.

-- AlterEnum
ALTER TYPE "DocumentType" ADD VALUE 'CRM_LEAD';
ALTER TYPE "DocumentType" ADD VALUE 'CRM_OPPORTUNITY';

-- CreateEnum
CREATE TYPE "CrmLeadStatusKind" AS ENUM ('OPEN', 'CONVERTED', 'LOST');
CREATE TYPE "CrmLeadTemperature" AS ENUM ('COLD', 'WARM', 'HOT');
CREATE TYPE "CrmCustomFieldType" AS ENUM ('TEXT', 'TEXTAREA', 'NUMBER', 'DECIMAL', 'CURRENCY', 'DATE', 'DATETIME', 'BOOLEAN', 'DROPDOWN', 'MULTI_SELECT', 'PHONE', 'EMAIL', 'URL');
CREATE TYPE "CrmOpportunityStatus" AS ENUM ('OPEN', 'WON', 'LOST', 'ABANDONED');
CREATE TYPE "CrmSavedViewVisibility" AS ENUM ('PRIVATE', 'SHARED');

-- CreateTable
CREATE TABLE "crm_lead_statuses" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "CrmLeadStatusKind" NOT NULL DEFAULT 'OPEN',
    "color" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "crm_lead_statuses_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "crm_lead_sources" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "crm_lead_sources_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "crm_leads" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "branch_id" UUID,
    "lead_number" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT,
    "full_name" TEXT NOT NULL,
    "company_name" TEXT,
    "designation" TEXT,
    "crm_company_id" UUID,
    "crm_contact_id" UUID,
    "email" TEXT,
    "alternate_email" TEXT,
    "phone" TEXT,
    "mobile" TEXT,
    "whatsapp" TEXT,
    "email_keys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "phone_keys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "search_text" TEXT NOT NULL DEFAULT '',
    "status_id" UUID NOT NULL,
    "source_id" UUID,
    "owner_user_id" UUID,
    "score" INTEGER NOT NULL DEFAULT 0,
    "temperature" "CrmLeadTemperature",
    "industry" TEXT,
    "city" TEXT,
    "state" TEXT,
    "country" TEXT,
    "requirement" TEXT,
    "estimated_value" DECIMAL(15,2),
    "currency_code" CHAR(3),
    "utm_source" TEXT,
    "utm_medium" TEXT,
    "utm_campaign" TEXT,
    "utm_term" TEXT,
    "utm_content" TEXT,
    "campaign_source" TEXT,
    "referral_source" TEXT,
    "custom_fields" JSONB NOT NULL DEFAULT '{}',
    "last_contacted_at" TIMESTAMP(3),
    "next_follow_up_at" TIMESTAMP(3),
    "converted_at" TIMESTAMP(3),
    "converted_by_user_id" UUID,
    "converted_opportunity_id" UUID,
    "archived_at" TIMESTAMP(3),
    "archived_by_user_id" UUID,
    "created_by_user_id" UUID NOT NULL,
    "updated_by_user_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "crm_leads_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "crm_companies" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "name_key" TEXT NOT NULL,
    "website" TEXT,
    "industry" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "city" TEXT,
    "state" TEXT,
    "country" TEXT,
    "customer_id" UUID,
    "owner_user_id" UUID,
    "custom_fields" JSONB NOT NULL DEFAULT '{}',
    "archived_at" TIMESTAMP(3),
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "crm_companies_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "crm_contacts" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "crm_company_id" UUID,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT,
    "full_name" TEXT NOT NULL,
    "designation" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "mobile" TEXT,
    "whatsapp" TEXT,
    "email_keys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "phone_keys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "owner_user_id" UUID,
    "custom_fields" JSONB NOT NULL DEFAULT '{}',
    "archived_at" TIMESTAMP(3),
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "crm_contacts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "crm_opportunities" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "opportunity_number" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "lead_id" UUID,
    "crm_contact_id" UUID,
    "crm_company_id" UUID,
    "source_id" UUID,
    "owner_user_id" UUID,
    "status" "CrmOpportunityStatus" NOT NULL DEFAULT 'OPEN',
    "amount" DECIMAL(15,2),
    "currency_code" CHAR(3),
    "expected_close_date" DATE,
    "description" TEXT,
    "custom_fields" JSONB NOT NULL DEFAULT '{}',
    "archived_at" TIMESTAMP(3),
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "crm_opportunities_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "crm_tags" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "name_key" TEXT NOT NULL,
    "color" TEXT,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "crm_tags_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "crm_entity_tags" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "tag_id" UUID NOT NULL,
    "entity_type" "CrmEntityType" NOT NULL,
    "entity_id" UUID NOT NULL,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "crm_entity_tags_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "crm_notes" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "entity_type" "CrmEntityType" NOT NULL,
    "entity_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "updated_by_user_id" UUID,
    "edited_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "deleted_by_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "crm_notes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "crm_custom_field_definitions" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "entity_type" "CrmEntityType" NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "field_type" "CrmCustomFieldType" NOT NULL,
    "description" TEXT,
    "options" JSONB,
    "is_required" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "crm_custom_field_definitions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "crm_settings" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "lead_duplicate_rules" JSONB NOT NULL,
    "updated_by_user_id" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "crm_settings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "crm_saved_views" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "entity_type" "CrmEntityType" NOT NULL,
    "name" TEXT NOT NULL,
    "filters" JSONB NOT NULL DEFAULT '{}',
    "sort" JSONB,
    "columns" JSONB,
    "visibility" "CrmSavedViewVisibility" NOT NULL DEFAULT 'PRIVATE',
    "owner_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "crm_saved_views_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "crm_lead_statuses_company_id_key_key" ON "crm_lead_statuses"("company_id", "key");
CREATE INDEX "crm_lead_statuses_company_id_sort_order_idx" ON "crm_lead_statuses"("company_id", "sort_order");
CREATE UNIQUE INDEX "crm_lead_sources_company_id_key_key" ON "crm_lead_sources"("company_id", "key");
CREATE INDEX "crm_lead_sources_company_id_sort_order_idx" ON "crm_lead_sources"("company_id", "sort_order");
CREATE UNIQUE INDEX "crm_leads_company_id_lead_number_key" ON "crm_leads"("company_id", "lead_number");
CREATE INDEX "crm_leads_company_id_archived_at_created_at_idx" ON "crm_leads"("company_id", "archived_at", "created_at");
CREATE INDEX "crm_leads_company_id_status_id_idx" ON "crm_leads"("company_id", "status_id");
CREATE INDEX "crm_leads_company_id_owner_user_id_idx" ON "crm_leads"("company_id", "owner_user_id");
CREATE INDEX "crm_leads_company_id_source_id_idx" ON "crm_leads"("company_id", "source_id");
CREATE INDEX "crm_leads_company_id_next_follow_up_at_idx" ON "crm_leads"("company_id", "next_follow_up_at");
CREATE INDEX "crm_leads_email_keys_idx" ON "crm_leads" USING GIN ("email_keys");
CREATE INDEX "crm_leads_phone_keys_idx" ON "crm_leads" USING GIN ("phone_keys");
CREATE UNIQUE INDEX "crm_companies_customer_id_key" ON "crm_companies"("customer_id");
CREATE INDEX "crm_companies_company_id_name_key_idx" ON "crm_companies"("company_id", "name_key");
CREATE INDEX "crm_contacts_company_id_crm_company_id_idx" ON "crm_contacts"("company_id", "crm_company_id");
CREATE INDEX "crm_contacts_email_keys_idx" ON "crm_contacts" USING GIN ("email_keys");
CREATE INDEX "crm_contacts_phone_keys_idx" ON "crm_contacts" USING GIN ("phone_keys");
CREATE UNIQUE INDEX "crm_opportunities_company_id_opportunity_number_key" ON "crm_opportunities"("company_id", "opportunity_number");
CREATE INDEX "crm_opportunities_company_id_status_idx" ON "crm_opportunities"("company_id", "status");
CREATE INDEX "crm_opportunities_company_id_lead_id_idx" ON "crm_opportunities"("company_id", "lead_id");
CREATE UNIQUE INDEX "crm_tags_company_id_name_key_key" ON "crm_tags"("company_id", "name_key");
CREATE UNIQUE INDEX "crm_entity_tags_tag_id_entity_type_entity_id_key" ON "crm_entity_tags"("tag_id", "entity_type", "entity_id");
CREATE INDEX "crm_entity_tags_company_id_entity_type_entity_id_idx" ON "crm_entity_tags"("company_id", "entity_type", "entity_id");
CREATE INDEX "crm_notes_company_id_entity_type_entity_id_created_at_idx" ON "crm_notes"("company_id", "entity_type", "entity_id", "created_at");
CREATE UNIQUE INDEX "crm_custom_field_definitions_company_id_entity_type_key_key" ON "crm_custom_field_definitions"("company_id", "entity_type", "key");
CREATE INDEX "crm_custom_field_definitions_company_id_entity_type_sort_or_idx" ON "crm_custom_field_definitions"("company_id", "entity_type", "sort_order");
CREATE UNIQUE INDEX "crm_settings_company_id_key" ON "crm_settings"("company_id");
CREATE INDEX "crm_saved_views_company_id_entity_type_owner_user_id_idx" ON "crm_saved_views"("company_id", "entity_type", "owner_user_id");

-- AddForeignKey
ALTER TABLE "crm_lead_statuses" ADD CONSTRAINT "crm_lead_statuses_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crm_lead_sources" ADD CONSTRAINT "crm_lead_sources_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crm_leads" ADD CONSTRAINT "crm_leads_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crm_leads" ADD CONSTRAINT "crm_leads_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_leads" ADD CONSTRAINT "crm_leads_status_id_fkey" FOREIGN KEY ("status_id") REFERENCES "crm_lead_statuses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crm_leads" ADD CONSTRAINT "crm_leads_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "crm_lead_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_leads" ADD CONSTRAINT "crm_leads_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_leads" ADD CONSTRAINT "crm_leads_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crm_leads" ADD CONSTRAINT "crm_leads_crm_company_id_fkey" FOREIGN KEY ("crm_company_id") REFERENCES "crm_companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_leads" ADD CONSTRAINT "crm_leads_crm_contact_id_fkey" FOREIGN KEY ("crm_contact_id") REFERENCES "crm_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_leads" ADD CONSTRAINT "crm_leads_converted_opportunity_id_fkey" FOREIGN KEY ("converted_opportunity_id") REFERENCES "crm_opportunities"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_companies" ADD CONSTRAINT "crm_companies_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crm_companies" ADD CONSTRAINT "crm_companies_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_companies" ADD CONSTRAINT "crm_companies_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_companies" ADD CONSTRAINT "crm_companies_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crm_contacts" ADD CONSTRAINT "crm_contacts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crm_contacts" ADD CONSTRAINT "crm_contacts_crm_company_id_fkey" FOREIGN KEY ("crm_company_id") REFERENCES "crm_companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_contacts" ADD CONSTRAINT "crm_contacts_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_contacts" ADD CONSTRAINT "crm_contacts_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crm_opportunities" ADD CONSTRAINT "crm_opportunities_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crm_opportunities" ADD CONSTRAINT "crm_opportunities_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "crm_leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_opportunities" ADD CONSTRAINT "crm_opportunities_crm_contact_id_fkey" FOREIGN KEY ("crm_contact_id") REFERENCES "crm_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_opportunities" ADD CONSTRAINT "crm_opportunities_crm_company_id_fkey" FOREIGN KEY ("crm_company_id") REFERENCES "crm_companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_opportunities" ADD CONSTRAINT "crm_opportunities_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "crm_lead_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_opportunities" ADD CONSTRAINT "crm_opportunities_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_opportunities" ADD CONSTRAINT "crm_opportunities_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crm_tags" ADD CONSTRAINT "crm_tags_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crm_entity_tags" ADD CONSTRAINT "crm_entity_tags_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crm_entity_tags" ADD CONSTRAINT "crm_entity_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "crm_tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_notes" ADD CONSTRAINT "crm_notes_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crm_notes" ADD CONSTRAINT "crm_notes_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crm_custom_field_definitions" ADD CONSTRAINT "crm_custom_field_definitions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crm_settings" ADD CONSTRAINT "crm_settings_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crm_saved_views" ADD CONSTRAINT "crm_saved_views_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crm_saved_views" ADD CONSTRAINT "crm_saved_views_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Permission catalog (mirrors src/config/rbac.ts; prisma/seed.ts creates the
-- same rows with skipDuplicates on a fresh database).
INSERT INTO "permissions" ("id", "key", "module", "description", "created_at")
SELECT gen_random_uuid(), m."module" || '.view_all', m."module", 'view_all access for ' || m."module", CURRENT_TIMESTAMP
FROM (SELECT DISTINCT "module" FROM "permissions") m
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "permissions" ("id", "key", "module", "description", "created_at")
SELECT gen_random_uuid(), 'crm_settings.' || a."action", 'crm_settings', a."action" || ' access for crm_settings', CURRENT_TIMESTAMP
FROM (SELECT substring("key" FROM 5) AS "action" FROM "permissions" WHERE "module" = 'crm') a
ON CONFLICT ("key") DO NOTHING;

-- SUPER_ADMIN holds every action on every module.
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at")
SELECT gen_random_uuid(), r."id", p."id", CURRENT_TIMESTAMP
FROM "roles" r
JOIN "permissions" p ON p."key" LIKE '%.view_all' OR p."module" = 'crm_settings'
WHERE r."name" = 'SUPER_ADMIN'
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

-- MANAGEMENT sees every CRM record and manages CRM settings.
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at")
SELECT gen_random_uuid(), r."id", p."id", CURRENT_TIMESTAMP
FROM "roles" r
JOIN "permissions" p ON p."key" IN ('crm.view_all', 'crm_settings.view', 'crm_settings.edit')
WHERE r."name" = 'MANAGEMENT'
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
