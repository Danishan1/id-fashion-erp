-- Rollback of 20261106120000_marketing_content_phase11. Files under FILE_STORAGE_ROOT are not removed.
DELETE FROM "role_permissions" WHERE "permission_id" IN (SELECT "id" FROM "permissions" WHERE "module" = 'marketing_content');
DELETE FROM "permissions" WHERE "module" = 'marketing_content';
ALTER TABLE "marketing_delivery_runs" DROP CONSTRAINT IF EXISTS "marketing_delivery_runs_content_version_id_fkey";
ALTER TABLE "marketing_delivery_runs" DROP COLUMN IF EXISTS "content_version_id", DROP COLUMN IF EXISTS "locale";
-- Channels that send campaign content can't survive the rollback.
DELETE FROM "marketing_campaign_channels" WHERE "content_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "marketing_delivery_runs" r WHERE r."campaign_channel_id" = "marketing_campaign_channels"."id");
DROP INDEX IF EXISTS "marketing_campaign_channels_template_key";
DROP INDEX IF EXISTS "marketing_campaign_channels_content_key";
ALTER TABLE "marketing_campaign_channels" DROP CONSTRAINT IF EXISTS "marketing_campaign_channels_content_id_fkey";
ALTER TABLE "marketing_campaign_channels" DROP COLUMN IF EXISTS "content_id";
CREATE UNIQUE INDEX IF NOT EXISTS "marketing_campaign_channels_campaign_id_connection_id_template_id_key" ON "marketing_campaign_channels"("campaign_id", "connection_id", "template_id");
DROP TABLE IF EXISTS "marketing_content_version_assets";
ALTER TABLE IF EXISTS "marketing_campaign_contents" DROP CONSTRAINT IF EXISTS "marketing_campaign_contents_current_version_id_fkey", DROP CONSTRAINT IF EXISTS "marketing_campaign_contents_approved_version_id_fkey";
DROP TABLE IF EXISTS "marketing_campaign_content_versions";
DROP TABLE IF EXISTS "marketing_campaign_contents";
DROP TABLE IF EXISTS "marketing_content_review_events";
DROP TABLE IF EXISTS "marketing_content_reviews";
ALTER TABLE IF EXISTS "marketing_assets" DROP CONSTRAINT IF EXISTS "marketing_assets_current_version_id_fkey", DROP CONSTRAINT IF EXISTS "marketing_assets_approved_version_id_fkey";
DROP TABLE IF EXISTS "marketing_asset_versions";
DROP TABLE IF EXISTS "marketing_assets";
DROP FUNCTION IF EXISTS marketing_content_immutable();
DROP FUNCTION IF EXISTS marketing_review_final();
