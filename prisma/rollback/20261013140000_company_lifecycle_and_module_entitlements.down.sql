-- Rollback of 20261013140000_company_lifecycle_and_module_entitlements (Platform SaaS Phase 3).
-- DATA LOSS: per-company module on/off settings and the suspension reason /
-- date / operator. companies.is_active (the actual suspension switch) predates
-- this migration and is kept, so a suspended company stays suspended.

DROP TABLE IF EXISTS "company_module_entitlements";

ALTER TABLE "companies" DROP CONSTRAINT IF EXISTS "companies_suspended_by_platform_user_id_fkey";
ALTER TABLE "companies"
  DROP COLUMN IF EXISTS "suspended_at",
  DROP COLUMN IF EXISTS "suspended_by_platform_user_id",
  DROP COLUMN IF EXISTS "suspension_reason";

DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261013140000_company_lifecycle_and_module_entitlements';
