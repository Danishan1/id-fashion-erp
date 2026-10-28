-- Remove the legacy standalone Marketing module (2026-10-28). It is replaced by
-- the new Sales & Marketing module (see 20261028250000_sales_marketing_foundation).
-- Per the user's decision, campaign data is permanently deleted (no backfill).
--
-- 1. Rows that still use the removed enum values.
DELETE FROM "import_batch_records" WHERE "import_batch_id" IN (
  SELECT "id" FROM "import_batches" WHERE "import_type"::text = 'CAMPAIGN_DAILY_METRIC'
);
DELETE FROM "import_batches" WHERE "import_type"::text = 'CAMPAIGN_DAILY_METRIC';
DELETE FROM "document_sequences" WHERE "document_type"::text = 'CAMPAIGN';

-- 2. CRM Lead -> Campaign link (the free-text UTM / campaign source fields stay).
ALTER TABLE "crm_leads" DROP CONSTRAINT IF EXISTS "crm_leads_campaign_id_fkey";
DROP INDEX IF EXISTS "crm_leads_company_id_campaign_id_idx";
ALTER TABLE "crm_leads" DROP COLUMN IF EXISTS "campaign_id";

-- 3. Marketing tables and their enum types.
DROP TABLE IF EXISTS "mkt_campaign_alerts" CASCADE;
DROP TABLE IF EXISTS "mkt_campaign_attributions" CASCADE;
DROP TABLE IF EXISTS "ad_campaign_links" CASCADE;
DROP TABLE IF EXISTS "ad_account_connections" CASCADE;
DROP TABLE IF EXISTS "mkt_campaign_daily_metrics" CASCADE;
DROP TABLE IF EXISTS "mkt_campaigns" CASCADE;

DROP TYPE IF EXISTS "CampaignAlertStatus";
DROP TYPE IF EXISTS "CampaignAlertPriority";
DROP TYPE IF EXISTS "CampaignAlertType";
DROP TYPE IF EXISTS "AdConnectionStatus";
DROP TYPE IF EXISTS "AdPlatform";
DROP TYPE IF EXISTS "CampaignApprovalStatus";
DROP TYPE IF EXISTS "CampaignStatus";
DROP TYPE IF EXISTS "CampaignChannel";

-- 4. Shared enums without the Marketing values.
ALTER TYPE "DocumentType" RENAME TO "DocumentType_old";
CREATE TYPE "DocumentType" AS ENUM ('SAMPLE_REQUEST', 'SUPPORT_TICKET', 'BUYER_ENQUIRY', 'SALES_ORDER', 'PRODUCTION_ORDER', 'SALES_INVOICE', 'PURCHASE_INVOICE', 'PURCHASE_ORDER', 'MATERIAL_REQUEST', 'GOODS_RECEIPT', 'DISPATCH', 'PAYMENT', 'EXPENSE', 'STOCK_MOVEMENT', 'JOURNAL', 'CUSTOMER', 'SUPPLIER', 'EMPLOYEE', 'STYLE', 'MATERIAL', 'CONTRACTOR', 'JOB_WORK_ORDER', 'JOB_WORK_RECEIPT', 'CUSTOM_INVOICE_CREDIT_NOTE', 'INTERNAL_TRANSFER', 'EMPLOYEE_ADVANCE', 'EMPLOYEE_ADVANCE_SETTLEMENT', 'EXPENSE_PAYMENT', 'AI_GARMENT_PROJECT', 'AI_DESIGNER_PROJECT', 'REPLICATE_DESIGN_PROJECT', 'FABRIC_ROLL', 'SKU', 'CRM_LEAD', 'CRM_OPPORTUNITY', 'FORWARDER', 'FG_RECEIPT', 'FG_PUTAWAY', 'PRODUCT_UNIT', 'CUSTOMER_RETURN', 'PAYMENT_REQUEST');
ALTER TABLE "document_sequences" ALTER COLUMN "document_type" TYPE "DocumentType" USING ("document_type"::text::"DocumentType");
DROP TYPE "DocumentType_old";

ALTER TYPE "ImportBatchType" RENAME TO "ImportBatchType_old";
CREATE TYPE "ImportBatchType" AS ENUM ('CUSTOMER', 'SUPPLIER', 'PRODUCT', 'PRODUCT_VARIANT', 'OPENING_STOCK', 'CHART_OF_ACCOUNT', 'COLOR', 'SIZE', 'UNIT', 'BRAND', 'SEASON', 'PRODUCT_FITTING', 'PRODUCT_TYPE', 'DESIGN', 'DESIGN_PATTERN', 'PATTERN', 'SUPPLIER_CATEGORY', 'FABRIC_GSM', 'FABRIC_DYE_TYPE', 'FABRIC_WEAVE_TYPE', 'FABRIC_COMPOSITION', 'EMPLOYEE_CATEGORY', 'COST_MASTER', 'PAYMENT_TYPE', 'DEPARTMENT', 'CATEGORY', 'FABRIC_DYE', 'FABRIC_WIDTH', 'DESIGNATION', 'SHIFT_MASTER', 'HOLIDAY_MASTER', 'PRODUCTION_STAGE', 'PRODUCTION_LINE', 'MACHINE', 'SALES_AGENT', 'BANK_ACCOUNT', 'MATERIAL', 'WAREHOUSE', 'WAREHOUSE_LOCATION', 'EMPLOYEE');
ALTER TABLE "import_batches" ALTER COLUMN "import_type" TYPE "ImportBatchType" USING ("import_type"::text::"ImportBatchType");
DROP TYPE "ImportBatchType_old";

-- 5. The "marketing" permission module (role grants and user overrides cascade).
DELETE FROM "permissions" WHERE "module" = 'marketing';
