-- Sales & Marketing Phase 10: marketing channels, provider connections and
-- delivery runs (docs/sales-marketing/PHASE_10_DELIVERY.md). Adds the
-- "marketing_delivery" permission module.

CREATE TYPE "MarketingChannelType" AS ENUM ('EMAIL', 'SMS', 'WHATSAPP');
CREATE TYPE "MarketingProviderKey" AS ENUM ('SMTP', 'BREVO', 'MSG91', 'WHATSAPP_CLOUD');
CREATE TYPE "MarketingConnectionStatus" AS ENUM ('ACTIVE', 'DISABLED');
CREATE TYPE "MarketingDeliveryRunStatus" AS ENUM ('PREPARING', 'SCHEDULED', 'QUEUED', 'RUNNING', 'COMPLETED', 'PARTIALLY_COMPLETED', 'FAILED', 'CANCELLED');
CREATE TYPE "MarketingDeliveryStatus" AS ENUM ('PENDING', 'SUBMITTING', 'ACCEPTED', 'SENT', 'DELIVERED', 'BOUNCED', 'REJECTED', 'FAILED', 'SUPPRESSED', 'CANCELLED', 'UNKNOWN');

CREATE TABLE "marketing_channel_connections" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "channel_type" "MarketingChannelType" NOT NULL,
    "provider_key" "MarketingProviderKey" NOT NULL,
    "status" "MarketingConnectionStatus" NOT NULL DEFAULT 'ACTIVE',
    "config" JSONB NOT NULL DEFAULT '{}',
    "secrets_encrypted" TEXT,
    "secret_hints" JSONB NOT NULL DEFAULT '{}',
    "webhook_token" TEXT NOT NULL,
    "consent_policy" TEXT NOT NULL DEFAULT 'OPT_OUT',
    "rate_per_minute" INTEGER NOT NULL DEFAULT 60,
    "batch_size" INTEGER NOT NULL DEFAULT 50,
    "last_tested_at" TIMESTAMP(3),
    "last_test_status" TEXT,
    "last_test_message" TEXT,
    "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
    "circuit_open_until" TIMESTAMP(3),
    "last_send_at" TIMESTAMP(3),
    "created_by_user_id" UUID NOT NULL,
    "updated_by_user_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "marketing_channel_connections_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "marketing_channel_connections_consent_policy_check" CHECK ("consent_policy" IN ('OPT_OUT', 'OPT_IN')),
    CONSTRAINT "marketing_channel_connections_limits_check" CHECK ("rate_per_minute" BETWEEN 1 AND 6000 AND "batch_size" BETWEEN 1 AND 500)
);
CREATE UNIQUE INDEX "marketing_channel_connections_webhook_token_key" ON "marketing_channel_connections"("webhook_token");
CREATE UNIQUE INDEX "marketing_channel_connections_company_id_code_key" ON "marketing_channel_connections"("company_id", "code");
CREATE INDEX "marketing_channel_connections_company_id_channel_type_status_idx" ON "marketing_channel_connections"("company_id", "channel_type", "status");
ALTER TABLE "marketing_channel_connections" ADD CONSTRAINT "marketing_channel_connections_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "marketing_channel_connections" ADD CONSTRAINT "marketing_channel_connections_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "marketing_campaign_channels" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "connection_id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "marketing_campaign_channels_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "marketing_campaign_channels_campaign_id_connection_id_template_id_key" ON "marketing_campaign_channels"("campaign_id", "connection_id", "template_id");
CREATE INDEX "marketing_campaign_channels_company_id_campaign_id_idx" ON "marketing_campaign_channels"("company_id", "campaign_id");
ALTER TABLE "marketing_campaign_channels" ADD CONSTRAINT "marketing_campaign_channels_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "marketing_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "marketing_campaign_channels" ADD CONSTRAINT "marketing_campaign_channels_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "marketing_channel_connections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "marketing_campaign_channels" ADD CONSTRAINT "marketing_campaign_channels_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "crm_message_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "marketing_delivery_runs" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "campaign_channel_id" UUID NOT NULL,
    "connection_id" UUID NOT NULL,
    "run_number" INTEGER NOT NULL,
    "channel_type" "MarketingChannelType" NOT NULL,
    "provider_key" "MarketingProviderKey" NOT NULL,
    "template_id" UUID NOT NULL,
    "template_version_id" UUID NOT NULL,
    "audience_json" JSONB NOT NULL DEFAULT '{}',
    "exclusion_summary" JSONB NOT NULL DEFAULT '{}',
    "status" "MarketingDeliveryRunStatus" NOT NULL DEFAULT 'PREPARING',
    "scheduled_for" TIMESTAMP(3),
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "idempotency_key" TEXT,
    "initiated_by_user_id" UUID NOT NULL,
    "planned_count" INTEGER NOT NULL DEFAULT 0,
    "cancel_requested_at" TIMESTAMP(3),
    "cancelled_by_user_id" UUID,
    "cancel_reason" TEXT,
    "prepared_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "lock_token" TEXT,
    "locked_at" TIMESTAMP(3),
    "next_dispatch_at" TIMESTAMP(3),
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "marketing_delivery_runs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "marketing_delivery_runs_campaign_id_run_number_key" ON "marketing_delivery_runs"("campaign_id", "run_number");
CREATE UNIQUE INDEX "marketing_delivery_runs_company_id_idempotency_key_key" ON "marketing_delivery_runs"("company_id", "idempotency_key");
CREATE INDEX "marketing_delivery_runs_company_id_status_idx" ON "marketing_delivery_runs"("company_id", "status");
CREATE INDEX "marketing_delivery_runs_status_next_dispatch_at_idx" ON "marketing_delivery_runs"("status", "next_dispatch_at");
-- At most one run of a campaign channel in flight at a time.
CREATE UNIQUE INDEX "marketing_delivery_runs_one_open_per_channel" ON "marketing_delivery_runs"("campaign_channel_id") WHERE "status" IN ('PREPARING', 'SCHEDULED', 'QUEUED', 'RUNNING');
ALTER TABLE "marketing_delivery_runs" ADD CONSTRAINT "marketing_delivery_runs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "marketing_delivery_runs" ADD CONSTRAINT "marketing_delivery_runs_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "marketing_campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "marketing_delivery_runs" ADD CONSTRAINT "marketing_delivery_runs_campaign_channel_id_fkey" FOREIGN KEY ("campaign_channel_id") REFERENCES "marketing_campaign_channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "marketing_delivery_runs" ADD CONSTRAINT "marketing_delivery_runs_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "marketing_channel_connections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "marketing_delivery_runs" ADD CONSTRAINT "marketing_delivery_runs_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "crm_message_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "marketing_delivery_runs" ADD CONSTRAINT "marketing_delivery_runs_template_version_id_fkey" FOREIGN KEY ("template_version_id") REFERENCES "crm_message_template_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "marketing_delivery_runs" ADD CONSTRAINT "marketing_delivery_runs_initiated_by_user_id_fkey" FOREIGN KEY ("initiated_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "marketing_deliveries" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "connection_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "destination" TEXT,
    "status" "MarketingDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "skip_reason" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_attempt_at" TIMESTAMP(3),
    "next_attempt_at" TIMESTAMP(3),
    "lock_token" TEXT,
    "provider_message_id" TEXT,
    "provider_status" TEXT,
    "error_code" TEXT,
    "error_message" TEXT,
    "accepted_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "failed_at" TIMESTAMP(3),
    "status_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "marketing_deliveries_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "marketing_deliveries_run_id_contact_id_key" ON "marketing_deliveries"("run_id", "contact_id");
CREATE INDEX "marketing_deliveries_run_id_status_next_attempt_at_idx" ON "marketing_deliveries"("run_id", "status", "next_attempt_at");
CREATE INDEX "marketing_deliveries_connection_id_provider_message_id_idx" ON "marketing_deliveries"("connection_id", "provider_message_id");
CREATE INDEX "marketing_deliveries_company_id_contact_id_idx" ON "marketing_deliveries"("company_id", "contact_id");
ALTER TABLE "marketing_deliveries" ADD CONSTRAINT "marketing_deliveries_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "marketing_delivery_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "marketing_deliveries" ADD CONSTRAINT "marketing_deliveries_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "marketing_channel_connections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "marketing_deliveries" ADD CONSTRAINT "marketing_deliveries_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "crm_contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "marketing_delivery_events" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "connection_id" UUID NOT NULL,
    "delivery_id" UUID,
    "source" TEXT NOT NULL DEFAULT 'PROVIDER',
    "event_key" TEXT NOT NULL,
    "provider_message_id" TEXT,
    "correlation_id" TEXT,
    "event_type" TEXT NOT NULL,
    "normalized_status" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),
    "result" TEXT,
    "error_code" TEXT,
    "detail" TEXT,
    CONSTRAINT "marketing_delivery_events_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "marketing_delivery_events_connection_id_event_key_key" ON "marketing_delivery_events"("connection_id", "event_key");
CREATE INDEX "marketing_delivery_events_delivery_id_occurred_at_idx" ON "marketing_delivery_events"("delivery_id", "occurred_at");
CREATE INDEX "marketing_delivery_events_processed_at_received_at_idx" ON "marketing_delivery_events"("processed_at", "received_at");
ALTER TABLE "marketing_delivery_events" ADD CONSTRAINT "marketing_delivery_events_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "marketing_channel_connections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "marketing_delivery_events" ADD CONSTRAINT "marketing_delivery_events_delivery_id_fkey" FOREIGN KEY ("delivery_id") REFERENCES "marketing_deliveries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Permission module "marketing_delivery" (every catalog action).
WITH actions(action) AS (
  VALUES ('view'), ('create'), ('edit'), ('delete'), ('approve'), ('reject'), ('post'),
         ('cancel'), ('export'), ('print'), ('override'), ('scan'), ('view_all')
)
INSERT INTO "permissions" ("id", "key", "module", "description", "created_at")
SELECT gen_random_uuid(), 'marketing_delivery.' || a.action, 'marketing_delivery', a.action || ' access for marketing_delivery', now()
FROM actions a
ON CONFLICT ("key") DO NOTHING;

-- Same roles as src/config/rbac.ts: SUPER_ADMIN everything; MANAGEMENT
-- view/view_all/create/edit/cancel/export; MERCHANDISER view/create/edit/cancel; VIEWER view.
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at")
SELECT gen_random_uuid(), r."id", p."id", now()
FROM "roles" r
JOIN "permissions" p ON p."module" = 'marketing_delivery'
WHERE r."is_system_role" AND (
     r."name" = 'SUPER_ADMIN'
  OR (r."name" = 'MANAGEMENT' AND p."key" IN ('marketing_delivery.view', 'marketing_delivery.view_all', 'marketing_delivery.create', 'marketing_delivery.edit', 'marketing_delivery.cancel', 'marketing_delivery.export'))
  OR (r."name" = 'MERCHANDISER' AND p."key" IN ('marketing_delivery.view', 'marketing_delivery.create', 'marketing_delivery.edit', 'marketing_delivery.cancel'))
  OR (r."name" = 'VIEWER' AND p."key" = 'marketing_delivery.view')
)
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
