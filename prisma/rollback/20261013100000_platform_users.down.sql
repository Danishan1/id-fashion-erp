-- Rollback of 20261013100000_platform_users (Platform SaaS Phase 1).
-- Roll back every later SaaS migration first (they reference platform_users).
-- DATA LOSS: platform operator accounts, and the platform-operator attribution
-- on audit rows (the audit rows themselves are kept).
-- The pre-Phase-1 code used users.is_platform_admin, which this migration never
-- removed, so the old platform-admin flag still works after rollback.

ALTER TABLE "audit_logs" DROP CONSTRAINT IF EXISTS "audit_logs_platform_user_id_fkey";
ALTER TABLE "audit_logs" DROP COLUMN IF EXISTS "platform_user_id";

DROP TABLE IF EXISTS "platform_users";
DROP TYPE IF EXISTS "PlatformUserRole";

DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261013100000_platform_users';
