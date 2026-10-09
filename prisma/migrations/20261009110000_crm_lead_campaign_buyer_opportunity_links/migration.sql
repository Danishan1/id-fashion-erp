-- CRM Replacement, Phase 1 step 3 (2026-10-09): additive integration
-- fields on top of the new CRM, confirmed by AskUserQuestion before being
-- built --
--   1. CrmLead.campaignId: a real FK back into Marketing's Campaign (the
--      new CRM only had free-text UTM fields; Marketing's dashboard needs a
--      real join to count leads/revenue per campaign).
--   2. CrmContact.buyerId: a soft, optional link to a specific Buyer under
--      the Customer the contact's CrmCompany is linked to.
--   3. SalesOrder.originatingOpportunityId: the Opportunity equivalent of
--      the removed legacy SalesOrder.originatingDealId.
--   4. DocumentType gains CRM_LEAD/CRM_OPPORTUNITY -- generateDocumentNumber()
--      is already called with these two values by lead.service.ts /
--      crm-opportunities.service.ts, but no prior migration on the adopted
--      crm-build-v5 branch ever added them to the enum; without this, every
--      real Lead/Opportunity creation would fail at runtime.
--
-- Excludes one unrelated line from this migration's own auto-generated diff
-- (`ALTER TABLE "sample_requests" DROP COLUMN "color"`) -- a pre-existing,
-- already-documented schema/DB drift unconnected to this change (see
-- CLAUDE.md), not something this migration should touch.

-- 1. DocumentType gains CRM_LEAD / CRM_OPPORTUNITY
BEGIN;
CREATE TYPE "DocumentType_new" AS ENUM ('SAMPLE_REQUEST', 'BUYER_ENQUIRY', 'SALES_ORDER', 'PRODUCTION_ORDER', 'SALES_INVOICE', 'PURCHASE_INVOICE', 'PURCHASE_ORDER', 'MATERIAL_REQUEST', 'GOODS_RECEIPT', 'DISPATCH', 'PAYMENT', 'EXPENSE', 'STOCK_MOVEMENT', 'JOURNAL', 'CUSTOMER', 'SUPPLIER', 'EMPLOYEE', 'STYLE', 'MATERIAL', 'CONTRACTOR', 'JOB_WORK_ORDER', 'JOB_WORK_RECEIPT', 'CUSTOM_INVOICE_CREDIT_NOTE', 'INTERNAL_TRANSFER', 'EMPLOYEE_ADVANCE', 'EMPLOYEE_ADVANCE_SETTLEMENT', 'AI_GARMENT_PROJECT', 'AI_DESIGNER_PROJECT', 'REPLICATE_DESIGN_PROJECT', 'FABRIC_ROLL', 'SKU', 'CAMPAIGN', 'CRM_LEAD', 'CRM_OPPORTUNITY');
ALTER TABLE "document_sequences" ALTER COLUMN "document_type" TYPE "DocumentType_new" USING ("document_type"::text::"DocumentType_new");
ALTER TYPE "DocumentType" RENAME TO "DocumentType_old";
ALTER TYPE "DocumentType_new" RENAME TO "DocumentType";
DROP TYPE "public"."DocumentType_old";
COMMIT;

-- 2. New additive columns
ALTER TABLE "crm_contacts" ADD COLUMN "buyer_id" UUID;
ALTER TABLE "crm_leads" ADD COLUMN "campaign_id" UUID;
ALTER TABLE "sales_orders" ADD COLUMN "originating_opportunity_id" UUID;

-- 3. Index + foreign keys
CREATE INDEX "crm_leads_company_id_campaign_id_idx" ON "crm_leads"("company_id", "campaign_id");

ALTER TABLE "mkt_campaign_attributions" ADD CONSTRAINT "mkt_campaign_attributions_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "crm_leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_originating_opportunity_id_fkey" FOREIGN KEY ("originating_opportunity_id") REFERENCES "crm_opportunities"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_leads" ADD CONSTRAINT "crm_leads_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "mkt_campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_contacts" ADD CONSTRAINT "crm_contacts_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "buyers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
