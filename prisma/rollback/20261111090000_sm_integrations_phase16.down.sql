-- Rollback of 20261111090000_sm_integrations_phase16. S&M API keys, S&M webhook
-- subscriptions and their deliveries are removed first (they only work with this phase).
DELETE FROM "crm_webhook_subscriptions" WHERE "scope" = 'SALES_MARKETING';
DELETE FROM "crm_api_keys" WHERE "purpose" = 'SALES_MARKETING_API';
DELETE FROM "role_permissions" WHERE "permission_id" IN (SELECT "id" FROM "permissions" WHERE "module" = 'sales_integrations');
DELETE FROM "permissions" WHERE "module" = 'sales_integrations';
DROP TABLE IF EXISTS "integration_idempotency";
DROP TABLE IF EXISTS "integration_api_usage";
DROP TABLE IF EXISTS "integration_conflicts";
DROP TABLE IF EXISTS "integration_sync_checkpoints";
DROP TABLE IF EXISTS "integration_external_refs";
DROP TABLE IF EXISTS "integrations";
DROP TABLE IF EXISTS "integration_events";
DROP INDEX IF EXISTS "crm_webhook_deliveries_sub_status_idx";
ALTER TABLE "crm_webhook_deliveries" DROP CONSTRAINT IF EXISTS "crm_webhook_deliveries_event_source_check", DROP COLUMN IF EXISTS "event_source";
DROP INDEX IF EXISTS "crm_webhook_subscriptions_company_scope_idx";
ALTER TABLE "crm_webhook_subscriptions" DROP CONSTRAINT IF EXISTS "crm_webhook_subscriptions_scope_check", DROP COLUMN IF EXISTS "scope", DROP COLUMN IF EXISTS "payload_version";
ALTER TABLE "crm_api_keys" DROP CONSTRAINT IF EXISTS "crm_api_keys_purpose_check", DROP CONSTRAINT IF EXISTS "crm_api_keys_rate_check",
  DROP COLUMN IF EXISTS "purpose", DROP COLUMN IF EXISTS "description", DROP COLUMN IF EXISTS "rate_limit_per_minute", DROP COLUMN IF EXISTS "rotated_from_id";
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261111090000_sm_integrations_phase16';
