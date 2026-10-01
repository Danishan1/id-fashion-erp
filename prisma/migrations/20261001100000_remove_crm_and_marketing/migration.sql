-- Remove the CRM and Marketing modules entirely (2026-10-01).
-- They are being redesigned from scratch; see danishan-understanding.md.
--
-- 1. Unlink Sales Orders from Deals.
-- 2. Drop every crm_* / mkt_* / ad_* table and their enum types.
-- 3. Remove the CRM-only values from three shared enums
--    (RelatedModule: LEAD, DEAL, CRM_FOLLOWUP; DocumentType: LEAD, DEAL, CAMPAIGN;
--    ImportBatchType: LEAD, DEAL, CAMPAIGN_DAILY_METRIC), deleting the rows
--    that still reference them first (lead file attachments, CRM notifications,
--    LEAD/DEAL/CAMP numbering sequences, CRM CSV import history).
--    Inventory transactions and journals are never deleted: if one references a
--    removed value the migration stops with an error instead.
--
-- Data in these tables is permanently deleted. Uploaded lead files on disk
-- (FILE_STORAGE_ROOT) are not touched and become orphaned.

-- 1. Sales Order -> Deal link
ALTER TABLE "sales_orders" DROP CONSTRAINT IF EXISTS "sales_orders_originating_deal_id_fkey";
ALTER TABLE "sales_orders" DROP COLUMN IF EXISTS "originating_deal_id";

-- 2. CRM / Marketing tables and enum types
DROP TABLE IF EXISTS "crm_lead_contacts" CASCADE;
DROP TABLE IF EXISTS "crm_lead_product_interests" CASCADE;
DROP TABLE IF EXISTS "crm_assignment_history" CASCADE;
DROP TABLE IF EXISTS "crm_stage_history" CASCADE;
DROP TABLE IF EXISTS "crm_activities" CASCADE;
DROP TABLE IF EXISTS "crm_followups" CASCADE;
DROP TABLE IF EXISTS "crm_round_robin_state" CASCADE;
DROP TABLE IF EXISTS "crm_settings" CASCADE;
DROP TABLE IF EXISTS "mkt_campaign_alerts" CASCADE;
DROP TABLE IF EXISTS "mkt_campaign_attributions" CASCADE;
DROP TABLE IF EXISTS "ad_campaign_links" CASCADE;
DROP TABLE IF EXISTS "ad_account_connections" CASCADE;
DROP TABLE IF EXISTS "mkt_campaign_daily_metrics" CASCADE;
DROP TABLE IF EXISTS "crm_deals" CASCADE;
DROP TABLE IF EXISTS "crm_leads" CASCADE;
DROP TABLE IF EXISTS "mkt_campaigns" CASCADE;
DROP TABLE IF EXISTS "crm_pipeline_stages" CASCADE;
DROP TABLE IF EXISTS "crm_lead_sources" CASCADE;
DROP TABLE IF EXISTS "crm_lost_reasons" CASCADE;

DROP TYPE IF EXISTS "CrmPipeline";
DROP TYPE IF EXISTS "CrmStageKind";
DROP TYPE IF EXISTS "CrmBusinessType";
DROP TYPE IF EXISTS "CrmLeadPriority";
DROP TYPE IF EXISTS "LeadQuality";
DROP TYPE IF EXISTS "DealStage";
DROP TYPE IF EXISTS "CrmInteractionType";
DROP TYPE IF EXISTS "CrmFollowupStatus";
DROP TYPE IF EXISTS "CrmFollowupPriority";
DROP TYPE IF EXISTS "CampaignChannel";
DROP TYPE IF EXISTS "CampaignStatus";
DROP TYPE IF EXISTS "CampaignApprovalStatus";
DROP TYPE IF EXISTS "AdPlatform";
DROP TYPE IF EXISTS "AdConnectionStatus";
DROP TYPE IF EXISTS "CampaignAlertType";
DROP TYPE IF EXISTS "CampaignAlertPriority";
DROP TYPE IF EXISTS "CampaignAlertStatus";

-- 3a. Safety check: never delete stock or accounting history
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "inventory_transactions" WHERE "reference_module"::text IN ('LEAD', 'DEAL', 'CRM_FOLLOWUP'))
     OR EXISTS (SELECT 1 FROM "journals" WHERE "source_module"::text IN ('LEAD', 'DEAL', 'CRM_FOLLOWUP')) THEN
    RAISE EXCEPTION 'inventory_transactions/journals reference a CRM module (LEAD/DEAL/CRM_FOLLOWUP); resolve these rows before removing the CRM module.';
  END IF;
END $$;

-- 3b. Delete rows that still use the removed enum values
DELETE FROM "attachments" WHERE "related_module"::text IN ('LEAD', 'DEAL', 'CRM_FOLLOWUP');
DELETE FROM "notifications" WHERE "related_module"::text IN ('LEAD', 'DEAL', 'CRM_FOLLOWUP');
DELETE FROM "document_sequences" WHERE "document_type"::text IN ('LEAD', 'DEAL', 'CAMPAIGN');
DELETE FROM "import_batch_records" WHERE "import_batch_id" IN (
  SELECT "id" FROM "import_batches" WHERE "import_type"::text IN ('LEAD', 'DEAL', 'CAMPAIGN_DAILY_METRIC')
);
DELETE FROM "import_batches" WHERE "import_type"::text IN ('LEAD', 'DEAL', 'CAMPAIGN_DAILY_METRIC');

-- 3c. Recreate the shared enums without the removed values
ALTER TYPE "RelatedModule" RENAME TO "RelatedModule_old";
CREATE TYPE "RelatedModule" AS ENUM ('SAMPLE_REQUEST', 'BUYER_ENQUIRY', 'SALES_ORDER', 'PURCHASE_ORDER', 'MATERIAL_REQUEST', 'SALES_INVOICE', 'PURCHASE_INVOICE', 'QC_INSPECTION', 'DISPATCH', 'PAYMENT', 'GOODS_RECEIPT', 'PRODUCTION_ORDER', 'EXPENSE', 'CUSTOMER', 'SUPPLIER', 'EMPLOYEE', 'PRODUCT', 'STOCK_MOVEMENT', 'JOB_WORK_ORDER', 'LEAVE_REQUEST', 'ATTENDANCE_CORRECTION', 'EMPLOYEE_ADVANCE_SETTLEMENT', 'IMPORT_BATCH', 'AI_GARMENT_PROJECT', 'AI_DESIGNER_PROJECT', 'REPLICATE_DESIGN_PROJECT');
ALTER TABLE "attachments" ALTER COLUMN "related_module" TYPE "RelatedModule" USING ("related_module"::text::"RelatedModule");
ALTER TABLE "inventory_transactions" ALTER COLUMN "reference_module" TYPE "RelatedModule" USING ("reference_module"::text::"RelatedModule");
ALTER TABLE "journals" ALTER COLUMN "source_module" TYPE "RelatedModule" USING ("source_module"::text::"RelatedModule");
ALTER TABLE "notifications" ALTER COLUMN "related_module" TYPE "RelatedModule" USING ("related_module"::text::"RelatedModule");
DROP TYPE "RelatedModule_old";

ALTER TYPE "DocumentType" RENAME TO "DocumentType_old";
CREATE TYPE "DocumentType" AS ENUM ('SAMPLE_REQUEST', 'BUYER_ENQUIRY', 'SALES_ORDER', 'PRODUCTION_ORDER', 'SALES_INVOICE', 'PURCHASE_INVOICE', 'PURCHASE_ORDER', 'MATERIAL_REQUEST', 'GOODS_RECEIPT', 'DISPATCH', 'PAYMENT', 'EXPENSE', 'STOCK_MOVEMENT', 'JOURNAL', 'CUSTOMER', 'SUPPLIER', 'EMPLOYEE', 'STYLE', 'MATERIAL', 'CONTRACTOR', 'JOB_WORK_ORDER', 'JOB_WORK_RECEIPT', 'CUSTOM_INVOICE_CREDIT_NOTE', 'INTERNAL_TRANSFER', 'EMPLOYEE_ADVANCE', 'EMPLOYEE_ADVANCE_SETTLEMENT', 'AI_GARMENT_PROJECT', 'AI_DESIGNER_PROJECT', 'REPLICATE_DESIGN_PROJECT', 'FABRIC_ROLL', 'SKU');
ALTER TABLE "document_sequences" ALTER COLUMN "document_type" TYPE "DocumentType" USING ("document_type"::text::"DocumentType");
DROP TYPE "DocumentType_old";

ALTER TYPE "ImportBatchType" RENAME TO "ImportBatchType_old";
CREATE TYPE "ImportBatchType" AS ENUM ('CUSTOMER', 'SUPPLIER', 'PRODUCT', 'PRODUCT_VARIANT', 'OPENING_STOCK', 'CHART_OF_ACCOUNT', 'COLOR', 'SIZE', 'UNIT', 'BRAND', 'SEASON', 'PRODUCT_FITTING', 'PRODUCT_TYPE', 'DESIGN', 'DESIGN_PATTERN', 'PATTERN', 'SUPPLIER_CATEGORY', 'FABRIC_GSM', 'FABRIC_DYE_TYPE', 'FABRIC_WEAVE_TYPE', 'FABRIC_COMPOSITION', 'EMPLOYEE_CATEGORY', 'COST_MASTER', 'PAYMENT_TYPE', 'DEPARTMENT', 'CATEGORY', 'FABRIC_DYE', 'FABRIC_WIDTH', 'DESIGNATION', 'SHIFT_MASTER', 'HOLIDAY_MASTER', 'PRODUCTION_STAGE', 'PRODUCTION_LINE', 'MACHINE', 'SALES_AGENT', 'BANK_ACCOUNT', 'MATERIAL', 'WAREHOUSE', 'WAREHOUSE_LOCATION', 'EMPLOYEE');
ALTER TABLE "import_batches" ALTER COLUMN "import_type" TYPE "ImportBatchType" USING ("import_type"::text::"ImportBatchType");
DROP TYPE "ImportBatchType_old";
