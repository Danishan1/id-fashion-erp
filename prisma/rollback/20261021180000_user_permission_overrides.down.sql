-- Rollback for 20261021180000_user_permission_overrides.
-- Every per-user grant/deny is removed; users fall back to their roles only.
DROP TABLE IF EXISTS "user_permission_overrides";
DROP TYPE IF EXISTS "PermissionOverrideEffect";

DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261021180000_user_permission_overrides';
