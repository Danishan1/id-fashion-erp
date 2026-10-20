-- Rollback for 20261021120000_user_must_change_password.
ALTER TABLE "users" DROP COLUMN IF EXISTS "must_change_password";

DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261021120000_user_must_change_password';
