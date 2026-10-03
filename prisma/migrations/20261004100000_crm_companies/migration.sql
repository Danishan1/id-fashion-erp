-- CRM Phase 05 — Companies / Accounts. Additive only; existing Phase 02–04
-- CRM companies are back-filled (match keys, search text, status, source
-- lead, primary contact, last activity). ERP customers are never modified.

-- AlterEnum (the new value is not used inside this migration)
ALTER TYPE "RelatedModule" ADD VALUE 'CRM_COMPANY';

-- AlterTable
ALTER TABLE "crm_companies" ADD COLUMN "name_match_key" TEXT NOT NULL DEFAULT '',
ADD COLUMN "legal_name" TEXT,
ADD COLUMN "legal_match_key" TEXT,
ADD COLUMN "display_name" TEXT,
ADD COLUMN "company_type" TEXT,
ADD COLUMN "website_key" TEXT,
ADD COLUMN "mobile" TEXT,
ADD COLUMN "postal_code" TEXT,
ADD COLUMN "email_keys" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "phone_keys" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "search_text" TEXT NOT NULL DEFAULT '',
ADD COLUMN "status_id" UUID,
ADD COLUMN "source_id" UUID,
ADD COLUMN "source_lead_id" UUID,
ADD COLUMN "primary_contact_id" UUID,
ADD COLUMN "last_activity_at" TIMESTAMP(3),
ADD COLUMN "duplicate_flagged_at" TIMESTAMP(3),
ADD COLUMN "flagged_duplicate_ids" UUID[] DEFAULT ARRAY[]::UUID[],
ADD COLUMN "merged_into_id" UUID,
ADD COLUMN "merged_at" TIMESTAMP(3),
ADD COLUMN "merged_by_user_id" UUID,
ADD COLUMN "archived_by_user_id" UUID,
ADD COLUMN "updated_by_user_id" UUID,
ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "crm_settings" ADD COLUMN "company_duplicate_rules" JSONB;

-- CreateTable
CREATE TABLE "crm_company_statuses" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_company_statuses_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "crm_company_merges" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "survivor_id" UUID NOT NULL,
    "merged_id" UUID NOT NULL,
    "field_choices" JSONB NOT NULL DEFAULT '{}',
    "merged_snapshot" JSONB NOT NULL,
    "moved" JSONB NOT NULL DEFAULT '{}',
    "merged_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_company_merges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "crm_companies_company_id_name_match_key_idx" ON "crm_companies"("company_id", "name_match_key");
CREATE INDEX "crm_companies_company_id_legal_match_key_idx" ON "crm_companies"("company_id", "legal_match_key");
CREATE INDEX "crm_companies_company_id_website_key_idx" ON "crm_companies"("company_id", "website_key");
CREATE INDEX "crm_companies_company_id_archived_at_created_at_idx" ON "crm_companies"("company_id", "archived_at", "created_at");
CREATE INDEX "crm_companies_company_id_owner_user_id_idx" ON "crm_companies"("company_id", "owner_user_id");
CREATE INDEX "crm_companies_company_id_status_id_idx" ON "crm_companies"("company_id", "status_id");
CREATE INDEX "crm_companies_company_id_last_activity_at_idx" ON "crm_companies"("company_id", "last_activity_at");
CREATE INDEX "crm_companies_merged_into_id_idx" ON "crm_companies"("merged_into_id");
CREATE INDEX "crm_companies_email_keys_idx" ON "crm_companies" USING GIN ("email_keys");
CREATE INDEX "crm_companies_phone_keys_idx" ON "crm_companies" USING GIN ("phone_keys");
CREATE UNIQUE INDEX "crm_company_statuses_company_id_key_key" ON "crm_company_statuses"("company_id", "key");
CREATE INDEX "crm_company_statuses_company_id_sort_order_idx" ON "crm_company_statuses"("company_id", "sort_order");
CREATE UNIQUE INDEX "crm_company_merges_merged_id_key" ON "crm_company_merges"("merged_id");
CREATE INDEX "crm_company_merges_company_id_survivor_id_idx" ON "crm_company_merges"("company_id", "survivor_id");

-- AddForeignKey
ALTER TABLE "crm_companies" ADD CONSTRAINT "crm_companies_status_id_fkey" FOREIGN KEY ("status_id") REFERENCES "crm_company_statuses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_companies" ADD CONSTRAINT "crm_companies_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "crm_lead_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_companies" ADD CONSTRAINT "crm_companies_source_lead_id_fkey" FOREIGN KEY ("source_lead_id") REFERENCES "crm_leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_companies" ADD CONSTRAINT "crm_companies_primary_contact_id_fkey" FOREIGN KEY ("primary_contact_id") REFERENCES "crm_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_companies" ADD CONSTRAINT "crm_companies_merged_into_id_fkey" FOREIGN KEY ("merged_into_id") REFERENCES "crm_companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_company_statuses" ADD CONSTRAINT "crm_company_statuses_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crm_company_merges" ADD CONSTRAINT "crm_company_merges_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crm_company_merges" ADD CONSTRAINT "crm_company_merges_survivor_id_fkey" FOREIGN KEY ("survivor_id") REFERENCES "crm_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crm_company_merges" ADD CONSTRAINT "crm_company_merges_merged_id_fkey" FOREIGN KEY ("merged_id") REFERENCES "crm_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Back-fill ----------------------------------------------------------------

-- Default statuses for every tenant that already has CRM companies (the
-- application creates them lazily for everyone else — same as lead statuses).
INSERT INTO "crm_company_statuses" ("id", "company_id", "key", "name", "color", "is_default", "sort_order", "updated_at")
SELECT gen_random_uuid(), t."company_id", s."key", s."name", s."color", s."is_default", s."sort_order", CURRENT_TIMESTAMP
FROM (SELECT DISTINCT "company_id" FROM "crm_companies") t
CROSS JOIN (VALUES
  ('prospect', 'Prospect', 'indigo', true, 10),
  ('active_prospect', 'Active prospect', 'amber', false, 20),
  ('customer', 'Customer', 'green', false, 30),
  ('partner', 'Partner', 'indigo', false, 40),
  ('inactive', 'Inactive', 'neutral', false, 50),
  ('former_customer', 'Former customer', 'neutral', false, 60),
  ('lost', 'Lost', 'red', false, 70)
) AS s("key", "name", "color", "is_default", "sort_order")
ON CONFLICT ("company_id", "key") DO NOTHING;

-- Initial status only (one-time): companies already linked to an ERP customer
-- start as Customer, the rest as Prospect. Later ERP changes never move it.
UPDATE "crm_companies" c SET "status_id" = s."id"
FROM "crm_company_statuses" s
WHERE s."company_id" = c."company_id" AND s."key" = CASE WHEN c."customer_id" IS NULL THEN 'prospect' ELSE 'customer' END;

-- Match keys (same rules as src/modules/crm/companies/company-keys.ts).
UPDATE "crm_companies" SET
  "name_match_key" = btrim(regexp_replace(regexp_replace(regexp_replace(btrim(regexp_replace(replace(lower("name"), '&', ' and '), '[^[:alnum:]]+', ' ', 'g')), '^the ', ''), '( (pvt|private|ltd|limited|llp|llc|inc|co|corp|corporation|company|gmbh|plc))+$', ''), '\s+', ' ', 'g')),
  "website_key" = NULLIF(regexp_replace(regexp_replace(lower(btrim(COALESCE("website", ''))), '^(https?://)?(www\.)?', ''), '[/?#:].*$', ''), ''),
  "email_keys" = CASE WHEN "email" IS NULL OR btrim("email") = '' THEN ARRAY[]::TEXT[] ELSE ARRAY[lower(btrim("email"))] END,
  "phone_keys" = CASE WHEN length(regexp_replace(COALESCE("phone", ''), '\D', '', 'g')) >= 7 THEN ARRAY[right(regexp_replace("phone", '\D', '', 'g'), 10)] ELSE ARRAY[]::TEXT[] END;

UPDATE "crm_companies" c SET "search_text" = lower(concat_ws(' ', c."name", c."website", c."email", c."phone", c."city", c."state", c."country", c."industry",
    (SELECT cu."code" || ' ' || cu."name" FROM "customers" cu WHERE cu."id" = c."customer_id")));

UPDATE "crm_companies" c SET
  "last_activity_at" = COALESCE((SELECT max(e."occurred_at") FROM "crm_events" e WHERE e."entity_type" = 'COMPANY' AND e."entity_id" = c."id"), c."updated_at"),
  "primary_contact_id" = (SELECT ct."id" FROM "crm_contacts" ct WHERE ct."crm_company_id" = c."id" AND ct."archived_at" IS NULL AND ct."merged_into_id" IS NULL ORDER BY ct."created_at" ASC LIMIT 1);

-- The lead each existing company was converted from (earliest), and its source.
UPDATE "crm_companies" c SET "source_lead_id" = l."id", "source_id" = l."source_id"
FROM (
  SELECT DISTINCT ON ("crm_company_id") "crm_company_id", "id", "source_id"
  FROM "crm_leads"
  WHERE "crm_company_id" IS NOT NULL AND "converted_at" IS NOT NULL
  ORDER BY "crm_company_id", "converted_at" ASC
) l
WHERE l."crm_company_id" = c."id";
