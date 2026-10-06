-- CRM Phase 06 — Opportunities. Additive only; existing (Phase 02 lead
-- conversion) opportunities are back-filled into a default "Sales" pipeline.
-- ERP documents are only referenced (crm_opportunity_erp_links), never copied.

-- AlterEnum (the new value is not used inside this migration)
ALTER TYPE "RelatedModule" ADD VALUE 'CRM_OPPORTUNITY';

-- AlterTable
ALTER TABLE "crm_opportunities" ADD COLUMN "name_key" TEXT NOT NULL DEFAULT '',
ADD COLUMN "pipeline_id" UUID,
ADD COLUMN "stage_id" UUID,
ADD COLUMN "stage_changed_at" TIMESTAMP(3),
ADD COLUMN "probability" INTEGER,
ADD COLUMN "closed_at" TIMESTAMP(3),
ADD COLUMN "closed_by_user_id" UUID,
ADD COLUMN "close_reason" TEXT,
ADD COLUMN "search_text" TEXT NOT NULL DEFAULT '',
ADD COLUMN "last_activity_at" TIMESTAMP(3),
ADD COLUMN "archived_by_user_id" UUID,
ADD COLUMN "updated_by_user_id" UUID,
ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "crm_opportunities" ADD CONSTRAINT "crm_opportunities_probability_check" CHECK ("probability" IS NULL OR ("probability" >= 0 AND "probability" <= 100));

-- CreateTable
CREATE TABLE "crm_pipelines" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_pipelines_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "crm_pipeline_stages" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "pipeline_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "probability" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_pipeline_stages_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "crm_pipeline_stages_probability_check" CHECK ("probability" IS NULL OR ("probability" >= 0 AND "probability" <= 100))
);

CREATE TABLE "crm_opportunity_erp_links" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "opportunity_id" UUID NOT NULL,
    "doc_type" TEXT NOT NULL,
    "doc_id" UUID NOT NULL,
    "doc_number" TEXT NOT NULL,
    "linked_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_opportunity_erp_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "crm_opportunities_company_id_archived_at_created_at_idx" ON "crm_opportunities"("company_id", "archived_at", "created_at");
CREATE INDEX "crm_opportunities_company_id_crm_company_id_idx" ON "crm_opportunities"("company_id", "crm_company_id");
CREATE INDEX "crm_opportunities_company_id_crm_contact_id_idx" ON "crm_opportunities"("company_id", "crm_contact_id");
CREATE INDEX "crm_opportunities_company_id_pipeline_id_stage_id_idx" ON "crm_opportunities"("company_id", "pipeline_id", "stage_id");
CREATE INDEX "crm_opportunities_company_id_owner_user_id_idx" ON "crm_opportunities"("company_id", "owner_user_id");
CREATE INDEX "crm_opportunities_company_id_expected_close_date_idx" ON "crm_opportunities"("company_id", "expected_close_date");
CREATE INDEX "crm_opportunities_company_id_last_activity_at_idx" ON "crm_opportunities"("company_id", "last_activity_at");
CREATE INDEX "crm_opportunities_company_id_name_key_idx" ON "crm_opportunities"("company_id", "name_key");
CREATE UNIQUE INDEX "crm_pipelines_company_id_key_key" ON "crm_pipelines"("company_id", "key");
CREATE INDEX "crm_pipelines_company_id_sort_order_idx" ON "crm_pipelines"("company_id", "sort_order");
CREATE UNIQUE INDEX "crm_pipeline_stages_pipeline_id_key_key" ON "crm_pipeline_stages"("pipeline_id", "key");
CREATE INDEX "crm_pipeline_stages_company_id_pipeline_id_sort_order_idx" ON "crm_pipeline_stages"("company_id", "pipeline_id", "sort_order");
CREATE UNIQUE INDEX "crm_opportunity_erp_links_opportunity_id_doc_type_doc_id_key" ON "crm_opportunity_erp_links"("opportunity_id", "doc_type", "doc_id");
CREATE INDEX "crm_opportunity_erp_links_company_id_doc_type_doc_id_idx" ON "crm_opportunity_erp_links"("company_id", "doc_type", "doc_id");

-- AddForeignKey
ALTER TABLE "crm_opportunities" ADD CONSTRAINT "crm_opportunities_pipeline_id_fkey" FOREIGN KEY ("pipeline_id") REFERENCES "crm_pipelines"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_opportunities" ADD CONSTRAINT "crm_opportunities_stage_id_fkey" FOREIGN KEY ("stage_id") REFERENCES "crm_pipeline_stages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_pipelines" ADD CONSTRAINT "crm_pipelines_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crm_pipeline_stages" ADD CONSTRAINT "crm_pipeline_stages_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crm_pipeline_stages" ADD CONSTRAINT "crm_pipeline_stages_pipeline_id_fkey" FOREIGN KEY ("pipeline_id") REFERENCES "crm_pipelines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crm_opportunity_erp_links" ADD CONSTRAINT "crm_opportunity_erp_links_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crm_opportunity_erp_links" ADD CONSTRAINT "crm_opportunity_erp_links_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "crm_opportunities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Back-fill ----------------------------------------------------------------

-- Default "Sales" pipeline for every tenant that already has opportunities
-- (the application creates it lazily for everyone else).
INSERT INTO "crm_pipelines" ("id", "company_id", "key", "name", "is_default", "sort_order", "updated_at")
SELECT gen_random_uuid(), t."company_id", 'sales', 'Sales', true, 10, CURRENT_TIMESTAMP
FROM (SELECT DISTINCT "company_id" FROM "crm_opportunities") t
ON CONFLICT ("company_id", "key") DO NOTHING;

INSERT INTO "crm_pipeline_stages" ("id", "company_id", "pipeline_id", "key", "name", "probability", "sort_order", "updated_at")
SELECT gen_random_uuid(), p."company_id", p."id", s."key", s."name", s."probability", s."sort_order", CURRENT_TIMESTAMP
FROM "crm_pipelines" p
CROSS JOIN (VALUES
  ('new', 'New', 10, 10),
  ('qualified', 'Qualified', 25, 20),
  ('proposal', 'Proposal', 50, 30),
  ('negotiation', 'Negotiation', 75, 40),
  ('closing', 'Closing', 90, 50)
) AS s("key", "name", "probability", "sort_order")
WHERE p."key" = 'sales'
ON CONFLICT ("pipeline_id", "key") DO NOTHING;

-- Existing opportunities start in the first stage of the default pipeline.
UPDATE "crm_opportunities" o SET
  "pipeline_id" = p."id",
  "stage_id" = s."id",
  "probability" = COALESCE(o."probability", s."probability"),
  "stage_changed_at" = o."created_at"
FROM "crm_pipelines" p
JOIN "crm_pipeline_stages" s ON s."pipeline_id" = p."id" AND s."key" = 'new'
WHERE p."company_id" = o."company_id" AND p."key" = 'sales' AND o."pipeline_id" IS NULL;

-- Keys (same rules as nameKey / buildSearchText in src/modules/crm/core/crm-normalize.ts).
UPDATE "crm_opportunities" SET
  "name_key" = lower(regexp_replace(btrim("name"), '\s+', ' ', 'g')),
  "search_text" = lower(concat_ws(' ', "opportunity_number", btrim("name"))),
  "closed_at" = CASE WHEN "status" <> 'OPEN' THEN "updated_at" ELSE NULL END;

UPDATE "crm_opportunities" o SET
  "last_activity_at" = COALESCE((SELECT max(e."occurred_at") FROM "crm_events" e WHERE e."entity_type" = 'OPPORTUNITY' AND e."entity_id" = o."id"), o."updated_at");
