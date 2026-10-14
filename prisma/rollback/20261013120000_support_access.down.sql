-- Rollback of 20261013120000_support_access (Platform SaaS Phase 2).
-- DATA LOSS: every support access request, session and the hash-chained event
-- log. Support proxy users are kept (other rows may reference them) but are
-- suspended; their password hash can never match a password anyway.

UPDATE "users" SET "status" = 'SUSPENDED' WHERE "support_for_platform_user_id" IS NOT NULL;

DROP TRIGGER IF EXISTS support_access_events_no_update_delete ON "support_access_events";
DROP FUNCTION IF EXISTS support_access_events_append_only();

DROP TABLE IF EXISTS "support_access_events";
DROP TABLE IF EXISTS "support_access_sessions";
DROP TABLE IF EXISTS "support_access_requests";

ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_support_for_platform_user_id_fkey";
DROP INDEX IF EXISTS "users_company_id_support_for_platform_user_id_key";
ALTER TABLE "users" DROP COLUMN IF EXISTS "support_for_platform_user_id";

DROP TYPE IF EXISTS "SupportAccessRequestStatus";
DROP TYPE IF EXISTS "SupportAccessMode";
DROP TYPE IF EXISTS "SupportWriteRequestStatus";
DROP TYPE IF EXISTS "SupportEventActorType";

DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261013120000_support_access';
