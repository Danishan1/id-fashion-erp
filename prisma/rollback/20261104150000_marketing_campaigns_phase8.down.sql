-- Rollback for 20261104150000_marketing_campaigns_phase8. Run before the Phase 07 down script.
-- Loses campaigns, their revisions, metrics and type / objective lists, and the
-- campaign on leads, enquiries, quotations, orders and expenses (the records
-- themselves stay). CRM activities created on a campaign are deleted with their
-- links (they would point at a missing record). The CAMPAIGN value can't be
-- removed from the CrmEntityType enum (Postgres can't drop an enum value).
BEGIN;
DELETE FROM "crm_activity_links" WHERE "activity_id" IN (SELECT "id" FROM "crm_activities" WHERE "entity_type"::text = 'CAMPAIGN');
DELETE FROM "crm_activity_links" WHERE "entity_type"::text = 'CAMPAIGN';
DELETE FROM "crm_activities" WHERE "entity_type"::text = 'CAMPAIGN';
DELETE FROM "sales_performance_events" WHERE "entity_type" = 'CAMPAIGN';
ALTER TABLE "crm_leads" DROP CONSTRAINT IF EXISTS "crm_leads_campaign_id_fkey", DROP COLUMN IF EXISTS "campaign_id";
ALTER TABLE "buyer_enquiries" DROP CONSTRAINT IF EXISTS "buyer_enquiries_campaign_id_fkey", DROP COLUMN IF EXISTS "campaign_id";
ALTER TABLE "quotations" DROP CONSTRAINT IF EXISTS "quotations_campaign_id_fkey", DROP COLUMN IF EXISTS "campaign_id";
ALTER TABLE "sales_orders" DROP CONSTRAINT IF EXISTS "sales_orders_campaign_id_fkey", DROP COLUMN IF EXISTS "campaign_id";
ALTER TABLE "expenses" DROP CONSTRAINT IF EXISTS "expenses_campaign_id_fkey", DROP COLUMN IF EXISTS "campaign_id";
DROP TABLE IF EXISTS "marketing_campaign_metrics";
DROP TABLE IF EXISTS "marketing_campaign_revisions";
DROP TABLE IF EXISTS "marketing_campaigns";
DROP TABLE IF EXISTS "marketing_campaign_lookups";
DROP TYPE IF EXISTS "MarketingCampaignStatus";
DROP TYPE IF EXISTS "MarketingCampaignPriority";
DROP TYPE IF EXISTS "MarketingLookupKind";
DROP TYPE IF EXISTS "MarketingRevisionStatus";
DROP TYPE IF EXISTS "MarketingMetricSource";
ALTER TABLE "sales_marketing_settings" DROP COLUMN IF EXISTS "campaign_approval_required";
DELETE FROM "permissions" WHERE "module" = 'marketing_campaigns';
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261104150000_marketing_campaigns_phase8';
COMMIT;
