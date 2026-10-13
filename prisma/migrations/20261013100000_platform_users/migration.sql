-- Platform SaaS Phase 1, PLAT-001: a separate identity table for platform
-- operators, with no company_id. Purely additive — users.is_platform_admin
-- is kept (now unused) rather than dropped.

-- CreateEnum
CREATE TYPE "PlatformUserRole" AS ENUM ('PLATFORM_SUPER_ADMIN', 'SUPPORT_AGENT', 'BILLING_ADMIN');

-- AlterTable
ALTER TABLE "audit_logs" ADD COLUMN     "platform_user_id" UUID;

-- CreateTable
CREATE TABLE "platform_users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "role" "PlatformUserRole" NOT NULL DEFAULT 'SUPPORT_AGENT',
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "last_login_at" TIMESTAMP(3),
    "password_changed_at" TIMESTAMP(3),
    "migrated_from_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_users_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "platform_users_email_key" ON "platform_users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "platform_users_migrated_from_user_id_key" ON "platform_users"("migrated_from_user_id");

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_platform_user_id_fkey" FOREIGN KEY ("platform_user_id") REFERENCES "platform_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: every existing platform admin gets a platform account with the
-- same email and password hash, so they can sign in at /platform/login with
-- their current password. Their tenant account is left untouched (it keeps
-- its own company roles). Idempotent on email.
INSERT INTO "platform_users" ("id", "email", "password_hash", "full_name", "role", "status", "migrated_from_user_id", "created_at", "updated_at")
SELECT gen_random_uuid(), u."email", u."password_hash", u."full_name", 'PLATFORM_SUPER_ADMIN', u."status", u."id", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "users" u
WHERE u."is_platform_admin" = true
ON CONFLICT ("email") DO NOTHING;
