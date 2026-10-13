-- Platform SaaS Phase 2 (PLAT-008..015): customer-approved support access.
-- Purely additive.

-- CreateEnum
CREATE TYPE "SupportAccessRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'CANCELLED', 'LOCKED');

-- CreateEnum
CREATE TYPE "SupportAccessMode" AS ENUM ('READ_ONLY', 'READ_WRITE');

-- CreateEnum
CREATE TYPE "SupportWriteRequestStatus" AS ENUM ('NONE', 'PENDING', 'APPROVED', 'REJECTED', 'LOCKED');

-- CreateEnum
CREATE TYPE "SupportEventActorType" AS ENUM ('PLATFORM_USER', 'TENANT_USER', 'SYSTEM');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "support_for_platform_user_id" UUID;

-- CreateTable
CREATE TABLE "support_access_requests" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "platform_user_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "status" "SupportAccessRequestStatus" NOT NULL DEFAULT 'PENDING',
    "code_hash" TEXT NOT NULL,
    "code_expires_at" TIMESTAMP(3) NOT NULL,
    "failed_attempts" INTEGER NOT NULL DEFAULT 0,
    "decided_by_user_id" UUID,
    "decided_at" TIMESTAMP(3),
    "rejection_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "support_access_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_access_sessions" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "platform_user_id" UUID NOT NULL,
    "proxy_user_id" UUID NOT NULL,
    "mode" "SupportAccessMode" NOT NULL DEFAULT 'READ_ONLY',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "revoked_by_user_id" UUID,
    "ended_at" TIMESTAMP(3),
    "write_status" "SupportWriteRequestStatus" NOT NULL DEFAULT 'NONE',
    "write_justification" TEXT,
    "write_code_hash" TEXT,
    "write_code_expires_at" TIMESTAMP(3),
    "write_failed_attempts" INTEGER NOT NULL DEFAULT 0,
    "write_requested_at" TIMESTAMP(3),
    "write_decided_at" TIMESTAMP(3),
    "write_decided_by_user_id" UUID,
    "exchange_token_hash" TEXT,
    "exchange_token_expires_at" TIMESTAMP(3),
    "last_accessed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "support_access_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_access_events" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "event_type" TEXT NOT NULL,
    "actor_type" "SupportEventActorType" NOT NULL,
    "actor_id" UUID,
    "method" TEXT,
    "path" TEXT,
    "detail" JSONB,
    "prev_hash" TEXT,
    "hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_access_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "support_access_requests_company_id_status_idx" ON "support_access_requests"("company_id", "status");

-- CreateIndex
CREATE INDEX "support_access_requests_platform_user_id_created_at_idx" ON "support_access_requests"("platform_user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "support_access_sessions_request_id_key" ON "support_access_sessions"("request_id");

-- CreateIndex
CREATE UNIQUE INDEX "support_access_sessions_exchange_token_hash_key" ON "support_access_sessions"("exchange_token_hash");

-- CreateIndex
CREATE INDEX "support_access_sessions_proxy_user_id_expires_at_idx" ON "support_access_sessions"("proxy_user_id", "expires_at");

-- CreateIndex
CREATE INDEX "support_access_sessions_company_id_expires_at_idx" ON "support_access_sessions"("company_id", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "support_access_events_request_id_seq_key" ON "support_access_events"("request_id", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "users_company_id_support_for_platform_user_id_key" ON "users"("company_id", "support_for_platform_user_id");

-- AddForeignKey
ALTER TABLE "support_access_requests" ADD CONSTRAINT "support_access_requests_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_access_requests" ADD CONSTRAINT "support_access_requests_platform_user_id_fkey" FOREIGN KEY ("platform_user_id") REFERENCES "platform_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_access_requests" ADD CONSTRAINT "support_access_requests_decided_by_user_id_fkey" FOREIGN KEY ("decided_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_access_sessions" ADD CONSTRAINT "support_access_sessions_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "support_access_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_access_sessions" ADD CONSTRAINT "support_access_sessions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_access_sessions" ADD CONSTRAINT "support_access_sessions_platform_user_id_fkey" FOREIGN KEY ("platform_user_id") REFERENCES "platform_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_access_sessions" ADD CONSTRAINT "support_access_sessions_proxy_user_id_fkey" FOREIGN KEY ("proxy_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_access_sessions" ADD CONSTRAINT "support_access_sessions_revoked_by_user_id_fkey" FOREIGN KEY ("revoked_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_access_sessions" ADD CONSTRAINT "support_access_sessions_write_decided_by_user_id_fkey" FOREIGN KEY ("write_decided_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_access_events" ADD CONSTRAINT "support_access_events_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "support_access_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_support_for_platform_user_id_fkey" FOREIGN KEY ("support_for_platform_user_id") REFERENCES "platform_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The support event log is append-only: reject any UPDATE or DELETE, so the
-- hash chain can't be rewritten in place (PLAT-015).
CREATE OR REPLACE FUNCTION support_access_events_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'support_access_events is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER support_access_events_no_update_delete
BEFORE UPDATE OR DELETE ON "support_access_events"
FOR EACH ROW EXECUTE FUNCTION support_access_events_append_only();
