-- Phase 22 (2026-10-15): outgoing webhook subscriptions.
-- See docs/crm/PHASE_22_SETTINGS_INTEGRATIONS.md.
--
-- crm_webhook_subscriptions  an external HTTPS URL + the CRM event types it
--                            receives; signing secret stored encrypted (shown
--                            once at creation / rotation, never again).
-- crm_webhook_deliveries     one row per (subscription, event): attempts,
--                            back-off schedule, response status, error — the
--                            delivery log. Unique per (subscription, event) so
--                            an event is queued once per subscription.

CREATE TABLE "crm_webhook_subscriptions" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "url" TEXT NOT NULL,
    "event_types" TEXT[],
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "active_since" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "secret_encrypted" TEXT NOT NULL,
    "secret_rotated_at" TIMESTAMP(3),
    "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
    "last_delivery_at" TIMESTAMP(3),
    "last_delivery_status" TEXT,
    "last_success_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_by_user_id" UUID NOT NULL,
    "updated_by_user_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_webhook_subscriptions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "crm_webhook_subscriptions_url_https_check" CHECK ("url" ~* '^https?://')
);

CREATE TABLE "crm_webhook_deliveries" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "subscription_id" UUID NOT NULL,
    "event_id" UUID,
    "event_type" TEXT NOT NULL,
    "is_test" BOOLEAN NOT NULL DEFAULT false,
    "payload" JSONB,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_at" TIMESTAMP(3),
    "lock_token" UUID,
    "response_status" INTEGER,
    "duration_ms" INTEGER,
    "error_code" TEXT,
    "error_message" TEXT,
    "last_attempt_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_webhook_deliveries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "crm_webhook_deliveries_status_check" CHECK ("status" IN ('PENDING', 'RETRYING', 'SUCCEEDED', 'FAILED', 'CANCELLED'))
);

CREATE UNIQUE INDEX "crm_webhook_subscriptions_company_id_name_key" ON "crm_webhook_subscriptions"("company_id", "name");
CREATE INDEX "crm_webhook_subscriptions_is_active_idx" ON "crm_webhook_subscriptions"("is_active");
CREATE UNIQUE INDEX "crm_webhook_deliveries_subscription_id_event_id_key" ON "crm_webhook_deliveries"("subscription_id", "event_id");
CREATE INDEX "crm_webhook_deliveries_status_next_attempt_at_idx" ON "crm_webhook_deliveries"("status", "next_attempt_at");
CREATE INDEX "crm_webhook_deliveries_subscription_id_created_at_idx" ON "crm_webhook_deliveries"("subscription_id", "created_at");

ALTER TABLE "crm_webhook_subscriptions" ADD CONSTRAINT "crm_webhook_subscriptions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crm_webhook_deliveries" ADD CONSTRAINT "crm_webhook_deliveries_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crm_webhook_deliveries" ADD CONSTRAINT "crm_webhook_deliveries_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "crm_webhook_subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
