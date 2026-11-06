-- Rollback for 20261112090000_sm_analytics_phase17 (run manually, then delete
-- the _prisma_migrations row). Delivered files in storage are not removed.
DELETE FROM "role_permissions" WHERE "permission_id" IN (SELECT "id" FROM "permissions" WHERE "module" = 'sales_analytics');
DELETE FROM "permissions" WHERE "module" = 'sales_analytics';
DROP TABLE IF EXISTS "sm_analytics_deliveries";
DROP TABLE IF EXISTS "sm_analytics_runs";
DROP TABLE IF EXISTS "sm_analytics_report_versions";
DROP TABLE IF EXISTS "sm_analytics_reports";
