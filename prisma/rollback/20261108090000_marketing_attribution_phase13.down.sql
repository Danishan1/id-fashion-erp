-- Rollback of Sales & Marketing Phase 13 (attribution & ROI).
DELETE FROM "role_permissions" WHERE "permission_id" IN (SELECT "id" FROM "permissions" WHERE "module" = 'marketing_attribution');
DELETE FROM "permissions" WHERE "module" = 'marketing_attribution';
DROP TRIGGER IF EXISTS "marketing_attribution_credits_immutable" ON "marketing_attribution_credits";
DROP TRIGGER IF EXISTS "marketing_attribution_results_immutable" ON "marketing_attribution_results";
DROP TRIGGER IF EXISTS "marketing_attribution_versions_frozen" ON "marketing_attribution_model_versions";
DROP FUNCTION IF EXISTS marketing_attribution_immutable();
DROP FUNCTION IF EXISTS marketing_attribution_version_frozen();
DROP TABLE IF EXISTS "marketing_attribution_checkpoints";
DROP TABLE IF EXISTS "marketing_attribution_credits";
DROP TABLE IF EXISTS "marketing_attribution_results";
DROP TABLE IF EXISTS "marketing_attribution_runs";
DROP TABLE IF EXISTS "marketing_conversions";
DROP TABLE IF EXISTS "marketing_touchpoints";
ALTER TABLE "marketing_attribution_models" DROP CONSTRAINT IF EXISTS "marketing_attribution_models_approved_version_id_fkey";
DROP TABLE IF EXISTS "marketing_attribution_model_versions";
DROP TABLE IF EXISTS "marketing_attribution_models";
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261108090000_marketing_attribution_phase13';
