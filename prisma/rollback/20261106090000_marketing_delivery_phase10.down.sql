-- Rollback for 20261106090000_marketing_delivery_phase10. Run before the Phase 09 down script.
-- Loses provider connections (and their encrypted secrets), campaign channels,
-- delivery runs, per-recipient delivery records and provider events. Campaigns,
-- segments, CRM contacts, consents and message templates are untouched.
BEGIN;
DROP TABLE IF EXISTS "marketing_delivery_events";
DROP TABLE IF EXISTS "marketing_deliveries";
DROP TABLE IF EXISTS "marketing_delivery_runs";
DROP TABLE IF EXISTS "marketing_campaign_channels";
DROP TABLE IF EXISTS "marketing_channel_connections";
DROP TYPE IF EXISTS "MarketingDeliveryStatus";
DROP TYPE IF EXISTS "MarketingDeliveryRunStatus";
DROP TYPE IF EXISTS "MarketingConnectionStatus";
DROP TYPE IF EXISTS "MarketingProviderKey";
DROP TYPE IF EXISTS "MarketingChannelType";
DELETE FROM "permissions" WHERE "module" = 'marketing_delivery';
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261106090000_marketing_delivery_phase10';
COMMIT;
