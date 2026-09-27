-- CRM Lead-to-Customer upgrade, slice 1 (2026-09-27).
-- Replaces crm_leads.status (fixed LeadStatus enum) and crm_leads.source
-- (EnquirySource enum) with FKs to new, company-configurable masters, adds
-- append-only stage/assignment history, and expands the lead with garment
-- business fields. Hand-authored (not raw `migrate diff` output) so existing
-- leads are backfilled before the NOT NULL / drop steps. The diff's unrelated
-- `contractors.updated_at DROP DEFAULT` drift is deliberately excluded.

-- Enums
CREATE TYPE "CrmPipeline" AS ENUM ('LEAD', 'OPPORTUNITY');
CREATE TYPE "CrmStageKind" AS ENUM ('OPEN', 'WON', 'LOST', 'DORMANT');
CREATE TYPE "CrmBusinessType" AS ENUM ('BRAND', 'RETAILER', 'WHOLESALER', 'IMPORTER', 'BUYING_HOUSE', 'BUYING_AGENT', 'DESIGNER', 'ECOMMERCE_BRAND', 'DEPARTMENT_STORE', 'DISTRIBUTOR', 'MANUFACTURER', 'OTHER');
CREATE TYPE "CrmLeadPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');
CREATE TYPE "LeadQuality" AS ENUM ('COLD', 'WARM', 'HOT');

-- Master tables
CREATE TABLE "crm_pipeline_stages" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "pipeline" "CrmPipeline" NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "CrmStageKind" NOT NULL DEFAULT 'OPEN',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "crm_pipeline_stages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "crm_lead_sources" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "crm_lead_sources_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "crm_lost_reasons" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "crm_lost_reasons_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "crm_stage_history" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "related_module" "RelatedModule" NOT NULL,
    "related_record_id" UUID NOT NULL,
    "from_stage_id" UUID,
    "to_stage_id" UUID NOT NULL,
    "comment" TEXT,
    "changed_by_user_id" UUID NOT NULL,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "crm_stage_history_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "crm_assignment_history" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "related_module" "RelatedModule" NOT NULL,
    "related_record_id" UUID NOT NULL,
    "from_user_id" UUID,
    "to_user_id" UUID,
    "assigned_by_user_id" UUID NOT NULL,
    "reason" TEXT,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "crm_assignment_history_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "crm_lead_product_interests" (
    "lead_id" UUID NOT NULL,
    "product_type_id" UUID NOT NULL,
    CONSTRAINT "crm_lead_product_interests_pkey" PRIMARY KEY ("lead_id","product_type_id")
);

CREATE INDEX "crm_pipeline_stages_company_id_pipeline_sort_order_idx" ON "crm_pipeline_stages"("company_id", "pipeline", "sort_order");
CREATE UNIQUE INDEX "crm_pipeline_stages_company_id_pipeline_code_key" ON "crm_pipeline_stages"("company_id", "pipeline", "code");
CREATE UNIQUE INDEX "crm_lead_sources_company_id_code_key" ON "crm_lead_sources"("company_id", "code");
CREATE UNIQUE INDEX "crm_lost_reasons_company_id_code_key" ON "crm_lost_reasons"("company_id", "code");
CREATE INDEX "crm_stage_history_company_id_related_module_related_record__idx" ON "crm_stage_history"("company_id", "related_module", "related_record_id");
CREATE INDEX "crm_assignment_history_company_id_related_module_related_re_idx" ON "crm_assignment_history"("company_id", "related_module", "related_record_id");

-- Seed defaults for every existing company (kept in sync by hand with
-- src/modules/crm/crm-defaults.ts, which lazily seeds any company created later).
INSERT INTO "crm_pipeline_stages" ("id", "company_id", "pipeline", "code", "name", "kind", "sort_order", "updated_at")
SELECT gen_random_uuid(), c."id", 'LEAD', v.code, v.name, v.kind::"CrmStageKind", v.sort_order, CURRENT_TIMESTAMP
FROM "companies" c
CROSS JOIN (VALUES
  ('NEW_LEAD', 'New Lead', 'OPEN', 10),
  ('CONTACT_ATTEMPTED', 'Contact Attempted', 'OPEN', 20),
  ('CONTACTED', 'Contacted', 'OPEN', 30),
  ('QUALIFICATION', 'Qualification', 'OPEN', 40),
  ('REQUIREMENT_RECEIVED', 'Requirement Received', 'OPEN', 50),
  ('SAMPLE_DEVELOPMENT', 'Sample / Development', 'OPEN', 60),
  ('QUOTATION_SENT', 'Quotation Sent', 'OPEN', 70),
  ('NEGOTIATION', 'Negotiation', 'OPEN', 80),
  ('HOT_DECISION_PENDING', 'Hot / Decision Pending', 'OPEN', 90),
  ('WON', 'Won', 'WON', 100),
  ('LOST', 'Lost', 'LOST', 110),
  ('DORMANT', 'Dormant / Follow Later', 'DORMANT', 120)
) AS v(code, name, kind, sort_order);

INSERT INTO "crm_lead_sources" ("id", "company_id", "code", "name", "sort_order", "updated_at")
SELECT gen_random_uuid(), c."id", v.code, v.name, v.sort_order, CURRENT_TIMESTAMP
FROM "companies" c
CROSS JOIN (VALUES
  ('WEBSITE', 'Website', 10), ('WHATSAPP', 'WhatsApp', 20), ('EMAIL', 'Email', 30), ('PHONE', 'Phone', 40),
  ('REFERRAL', 'Referral', 50), ('EXISTING_CUSTOMER', 'Existing Customer', 60), ('TRADE_FAIR', 'Trade Fair', 70),
  ('EXHIBITION', 'Exhibition', 80), ('INDIAMART', 'IndiaMART', 90), ('TRADEINDIA', 'TradeIndia', 100),
  ('LINKEDIN', 'LinkedIn', 110), ('INSTAGRAM', 'Instagram', 120), ('FACEBOOK', 'Facebook', 130),
  ('GOOGLE_ADS', 'Google Ads', 140), ('EXPORT_BUYER_PLATFORM', 'Export Buyer Platform', 150),
  ('BUYING_AGENT', 'Buying Agent', 160), ('SALESPERSON', 'Salesperson', 170), ('WALK_IN', 'Walk-In', 180),
  ('MANUAL_ENTRY', 'Manual Entry', 190), ('CSV_IMPORT', 'CSV Import', 200), ('API_WEBHOOK', 'API / Webhook', 210),
  ('OTHER', 'Other', 220)
) AS v(code, name, sort_order);

INSERT INTO "crm_lost_reasons" ("id", "company_id", "code", "name", "sort_order", "updated_at")
SELECT gen_random_uuid(), c."id", v.code, v.name, v.sort_order, CURRENT_TIMESTAMP
FROM "companies" c
CROSS JOIN (VALUES
  ('PRICE_TOO_HIGH', 'Price Too High', 10), ('MOQ', 'MOQ', 20), ('DELIVERY_TIME', 'Delivery Time', 30),
  ('QUALITY_PRODUCT', 'Quality / Product', 40), ('COMPETITOR', 'Competitor', 50), ('NO_RESPONSE', 'No Response', 60),
  ('BUYER_CANCELLED', 'Buyer Cancelled Requirement', 70), ('BUDGET', 'Budget', 80), ('PAYMENT_TERMS', 'Payment Terms', 90),
  ('SAMPLING_ISSUE', 'Sampling Issue', 100), ('NOT_QUALIFIED', 'Not Qualified', 110), ('DUPLICATE', 'Duplicate', 120),
  ('OTHER', 'Other', 130)
) AS v(code, name, sort_order);

-- Lead columns (stage_id added nullable first, filled, then made NOT NULL)
ALTER TABLE "crm_leads"
ADD COLUMN "address" TEXT,
ADD COLUMN "alternative_phone" TEXT,
ADD COLUMN "assigned_at" TIMESTAMP(3),
ADD COLUMN "business_type" "CrmBusinessType",
ADD COLUMN "city" TEXT,
ADD COLUMN "country" TEXT,
ADD COLUMN "currency_code" CHAR(3),
ADD COLUMN "designation" TEXT,
ADD COLUMN "expected_quantity" INTEGER,
ADD COLUMN "lost_at" TIMESTAMP(3),
ADD COLUMN "lost_can_revisit" BOOLEAN,
ADD COLUMN "lost_comment" TEXT,
ADD COLUMN "lost_competitor" TEXT,
ADD COLUMN "lost_reason_id" UUID,
ADD COLUMN "market" TEXT,
ADD COLUMN "moq_requirement" TEXT,
ADD COLUMN "priority" "CrmLeadPriority" NOT NULL DEFAULT 'MEDIUM',
ADD COLUMN "product_category_id" UUID,
ADD COLUMN "reference_image_available" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "required_delivery_date" DATE,
ADD COLUMN "sampling_required" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "season_id" UUID,
ADD COLUMN "source_id" UUID,
ADD COLUMN "stage_changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "stage_id" UUID,
ADD COLUMN "state" TEXT,
ADD COLUMN "target_price" DECIMAL(15,2),
ADD COLUMN "tech_pack_available" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "website" TEXT,
ADD COLUMN "whatsapp_number" TEXT,
ADD COLUMN "won_at" TIMESTAMP(3);

-- Backfill stage from the old status value
UPDATE "crm_leads" l
SET "stage_id" = s."id",
    "stage_changed_at" = l."updated_at",
    "won_at" = CASE WHEN l."status" = 'WON' THEN l."updated_at" END,
    "lost_at" = CASE WHEN l."status" = 'LOST' THEN l."updated_at" END
FROM "crm_pipeline_stages" s
WHERE s."company_id" = l."company_id"
  AND s."pipeline" = 'LEAD'
  AND s."code" = CASE l."status"::text
    WHEN 'NEW' THEN 'NEW_LEAD'
    WHEN 'CONTACTED' THEN 'CONTACTED'
    WHEN 'QUALIFIED' THEN 'QUALIFICATION'
    WHEN 'PROPOSAL' THEN 'QUOTATION_SENT'
    WHEN 'NEGOTIATION' THEN 'NEGOTIATION'
    WHEN 'WON' THEN 'WON'
    WHEN 'LOST' THEN 'LOST'
  END;

-- Backfill source from the old EnquirySource value (TRADE_SHOW -> TRADE_FAIR)
UPDATE "crm_leads" l
SET "source_id" = src."id"
FROM "crm_lead_sources" src
WHERE src."company_id" = l."company_id"
  AND src."code" = CASE l."source"::text WHEN 'TRADE_SHOW' THEN 'TRADE_FAIR' ELSE l."source"::text END;

-- Backfill assignment timestamp
UPDATE "crm_leads" SET "assigned_at" = "created_at" WHERE "assigned_to_user_id" IS NOT NULL;

-- Initial history rows so every existing lead has a traceable starting point
INSERT INTO "crm_stage_history" ("id", "company_id", "related_module", "related_record_id", "from_stage_id", "to_stage_id", "comment", "changed_by_user_id", "changed_at")
SELECT gen_random_uuid(), l."company_id", 'LEAD', l."id", NULL, l."stage_id",
       'Backfilled at CRM upgrade (original status: ' || l."status"::text || ')', l."created_by_user_id", l."created_at"
FROM "crm_leads" l;

INSERT INTO "crm_assignment_history" ("id", "company_id", "related_module", "related_record_id", "from_user_id", "to_user_id", "assigned_by_user_id", "reason", "assigned_at")
SELECT gen_random_uuid(), l."company_id", 'LEAD', l."id", NULL, l."assigned_to_user_id", l."created_by_user_id",
       'Backfilled at CRM upgrade', l."created_at"
FROM "crm_leads" l
WHERE l."assigned_to_user_id" IS NOT NULL;

ALTER TABLE "crm_leads" ALTER COLUMN "stage_id" SET NOT NULL;

DROP INDEX "crm_leads_company_id_status_idx";
ALTER TABLE "crm_leads" DROP COLUMN "source", DROP COLUMN "status";
DROP TYPE "LeadPriority";
DROP TYPE "LeadStatus";

CREATE INDEX "crm_leads_company_id_stage_id_idx" ON "crm_leads"("company_id", "stage_id");
CREATE INDEX "crm_leads_company_id_source_id_idx" ON "crm_leads"("company_id", "source_id");

-- Foreign keys
ALTER TABLE "crm_leads" ADD CONSTRAINT "crm_leads_stage_id_fkey" FOREIGN KEY ("stage_id") REFERENCES "crm_pipeline_stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crm_leads" ADD CONSTRAINT "crm_leads_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "crm_lead_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_leads" ADD CONSTRAINT "crm_leads_lost_reason_id_fkey" FOREIGN KEY ("lost_reason_id") REFERENCES "crm_lost_reasons"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_leads" ADD CONSTRAINT "crm_leads_product_category_id_fkey" FOREIGN KEY ("product_category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_leads" ADD CONSTRAINT "crm_leads_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "seasons"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_pipeline_stages" ADD CONSTRAINT "crm_pipeline_stages_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crm_lead_sources" ADD CONSTRAINT "crm_lead_sources_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crm_lost_reasons" ADD CONSTRAINT "crm_lost_reasons_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crm_stage_history" ADD CONSTRAINT "crm_stage_history_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crm_stage_history" ADD CONSTRAINT "crm_stage_history_from_stage_id_fkey" FOREIGN KEY ("from_stage_id") REFERENCES "crm_pipeline_stages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_stage_history" ADD CONSTRAINT "crm_stage_history_to_stage_id_fkey" FOREIGN KEY ("to_stage_id") REFERENCES "crm_pipeline_stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crm_stage_history" ADD CONSTRAINT "crm_stage_history_changed_by_user_id_fkey" FOREIGN KEY ("changed_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crm_assignment_history" ADD CONSTRAINT "crm_assignment_history_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crm_assignment_history" ADD CONSTRAINT "crm_assignment_history_from_user_id_fkey" FOREIGN KEY ("from_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_assignment_history" ADD CONSTRAINT "crm_assignment_history_to_user_id_fkey" FOREIGN KEY ("to_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_assignment_history" ADD CONSTRAINT "crm_assignment_history_assigned_by_user_id_fkey" FOREIGN KEY ("assigned_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crm_lead_product_interests" ADD CONSTRAINT "crm_lead_product_interests_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "crm_leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_lead_product_interests" ADD CONSTRAINT "crm_lead_product_interests_product_type_id_fkey" FOREIGN KEY ("product_type_id") REFERENCES "product_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
