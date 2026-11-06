-- Sales & Marketing Phase 16 — external integrations, webhooks and API (2026-11-06).
-- Reuses crm_api_keys, crm_webhook_subscriptions / crm_webhook_deliveries and the
-- Phase 10 delivery connections. Rollback: prisma/rollback/20261111090000_sm_integrations_phase16.down.sql

-- Scoped S&M API keys share the CRM key table (one hashing / revocation scheme).
ALTER TABLE "crm_api_keys"
  ADD COLUMN "purpose" TEXT NOT NULL DEFAULT 'CRM_CAPTURE',
  ADD COLUMN "description" TEXT,
  ADD COLUMN "rate_limit_per_minute" INTEGER,
  ADD COLUMN "rotated_from_id" UUID,
  ADD CONSTRAINT "crm_api_keys_purpose_check" CHECK ("purpose" IN ('CRM_CAPTURE', 'SALES_MARKETING_API')),
  ADD CONSTRAINT "crm_api_keys_rate_check" CHECK ("rate_limit_per_minute" IS NULL OR "rate_limit_per_minute" BETWEEN 1 AND 600);

-- One webhook engine: subscriptions are CRM- or S&M-scoped; deliveries say which outbox their event is in.
ALTER TABLE "crm_webhook_subscriptions"
  ADD COLUMN "scope" TEXT NOT NULL DEFAULT 'CRM',
  ADD COLUMN "payload_version" INTEGER NOT NULL DEFAULT 1,
  ADD CONSTRAINT "crm_webhook_subscriptions_scope_check" CHECK ("scope" IN ('CRM', 'SALES_MARKETING'));
CREATE INDEX "crm_webhook_subscriptions_company_scope_idx" ON "crm_webhook_subscriptions"("company_id", "scope");

ALTER TABLE "crm_webhook_deliveries"
  ADD COLUMN "event_source" TEXT NOT NULL DEFAULT 'CRM',
  ADD CONSTRAINT "crm_webhook_deliveries_event_source_check" CHECK ("event_source" IN ('CRM', 'INTEGRATION'));
CREATE INDEX "crm_webhook_deliveries_sub_status_idx" ON "crm_webhook_deliveries"("subscription_id", "status");

CREATE TABLE "integration_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL,
  "source" TEXT NOT NULL,
  "source_key" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "event_version" INTEGER NOT NULL DEFAULT 1,
  "entity_type" TEXT NOT NULL,
  "entity_id" UUID NOT NULL,
  "occurred_at" TIMESTAMP(3) NOT NULL,
  "correlation_id" TEXT,
  "payload" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "integration_events_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "integration_events_source_source_key_key" ON "integration_events"("source", "source_key");
CREATE INDEX "integration_events_company_id_occurred_at_idx" ON "integration_events"("company_id", "occurred_at");
CREATE INDEX "integration_events_company_id_event_type_occurred_at_idx" ON "integration_events"("company_id", "event_type", "occurred_at");

CREATE TABLE "integrations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL,
  "kind" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'CONFIGURED',
  "status_reason" TEXT,
  "status_changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "capabilities" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "auth_method" TEXT NOT NULL,
  "credential_ref" TEXT,
  "credential_rotated_at" TIMESTAMP(3),
  "config_schema_version" INTEGER NOT NULL DEFAULT 1,
  "managed_in" TEXT NOT NULL DEFAULT 'SALES_MARKETING',
  "resource_type" TEXT NOT NULL,
  "resource_id" UUID NOT NULL,
  "last_success_at" TIMESTAMP(3),
  "last_error_at" TIMESTAMP(3),
  "last_error" TEXT,
  "last_checked_at" TIMESTAMP(3),
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "integrations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "integrations_status_check" CHECK ("status" IN ('DRAFT', 'CONFIGURED', 'PENDING_VERIFICATION', 'CONNECTED', 'DEGRADED', 'DISABLED', 'REVOKED', 'FAILED')),
  CONSTRAINT "integrations_kind_check" CHECK ("kind" IN ('DELIVERY_PROVIDER', 'API_CLIENT', 'WEBHOOK_SUBSCRIPTION', 'CRM_CAPTURE_KEY', 'CRM_INBOUND_WEBHOOK', 'CRM_WEBHOOK_SUBSCRIPTION')),
  CONSTRAINT "integrations_managed_in_check" CHECK ("managed_in" IN ('SALES_MARKETING', 'CRM'))
);
CREATE UNIQUE INDEX "integrations_company_id_resource_type_resource_id_key" ON "integrations"("company_id", "resource_type", "resource_id");
CREATE INDEX "integrations_company_id_status_idx" ON "integrations"("company_id", "status");

CREATE TABLE "integration_external_refs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL,
  "integration_id" UUID,
  "system" TEXT NOT NULL,
  "external_type" TEXT NOT NULL,
  "external_id" TEXT NOT NULL,
  "entity_type" TEXT NOT NULL,
  "entity_id" UUID NOT NULL,
  "source_updated_at" TIMESTAMP(3),
  "last_values" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "integration_external_refs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "integration_external_refs_lengths_check" CHECK (length("system") BETWEEN 1 AND 40 AND length("external_id") BETWEEN 1 AND 120)
);
CREATE UNIQUE INDEX "integration_external_refs_company_id_system_external_type_external_id_key" ON "integration_external_refs"("company_id", "system", "external_type", "external_id");
CREATE INDEX "integration_external_refs_company_id_entity_type_entity_id_idx" ON "integration_external_refs"("company_id", "entity_type", "entity_id");

CREATE TABLE "integration_sync_checkpoints" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL,
  "integration_id" UUID NOT NULL,
  "stream" TEXT NOT NULL,
  "last_source_at" TIMESTAMP(3),
  "last_run_at" TIMESTAMP(3),
  "created" INTEGER NOT NULL DEFAULT 0,
  "updated" INTEGER NOT NULL DEFAULT 0,
  "unchanged" INTEGER NOT NULL DEFAULT 0,
  "stale_ignored" INTEGER NOT NULL DEFAULT 0,
  "conflicts" INTEGER NOT NULL DEFAULT 0,
  "failed" INTEGER NOT NULL DEFAULT 0,
  "last_error" TEXT,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "integration_sync_checkpoints_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "integration_sync_checkpoints_integration_id_stream_key" ON "integration_sync_checkpoints"("integration_id", "stream");
CREATE INDEX "integration_sync_checkpoints_company_id_idx" ON "integration_sync_checkpoints"("company_id");

CREATE TABLE "integration_conflicts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL,
  "integration_id" UUID,
  "external_ref_id" UUID NOT NULL,
  "entity_type" TEXT NOT NULL,
  "entity_id" UUID NOT NULL,
  "field" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "erp_value" JSONB,
  "external_value" JSONB,
  "source_updated_at" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "resolution_note" TEXT,
  "resolved_by_user_id" UUID,
  "resolved_at" TIMESTAMP(3),
  "detected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "integration_conflicts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "integration_conflicts_external_ref_id_fkey" FOREIGN KEY ("external_ref_id") REFERENCES "integration_external_refs"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "integration_conflicts_status_check" CHECK ("status" IN ('OPEN', 'KEPT_ERP', 'APPLIED_EXTERNAL', 'DISMISSED')),
  CONSTRAINT "integration_conflicts_reason_check" CHECK ("reason" IN ('ERP_CHANGED', 'RECORD_ADVANCED', 'NOT_UPDATABLE')),
  CONSTRAINT "integration_conflicts_resolved_check" CHECK (("status" = 'OPEN') = ("resolved_at" IS NULL))
);
CREATE UNIQUE INDEX "integration_conflicts_one_open" ON "integration_conflicts"("external_ref_id", "field") WHERE "status" = 'OPEN';
CREATE INDEX "integration_conflicts_company_id_status_detected_at_idx" ON "integration_conflicts"("company_id", "status", "detected_at");
CREATE INDEX "integration_conflicts_entity_type_entity_id_idx" ON "integration_conflicts"("entity_type", "entity_id");

CREATE TABLE "integration_api_usage" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL,
  "api_key_id" UUID NOT NULL,
  "endpoint" TEXT NOT NULL,
  "hour" TIMESTAMP(3) NOT NULL,
  "requests" INTEGER NOT NULL DEFAULT 0,
  "errors" INTEGER NOT NULL DEFAULT 0,
  "rate_limited" INTEGER NOT NULL DEFAULT 0,
  "denied" INTEGER NOT NULL DEFAULT 0,
  "last_status" INTEGER,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "integration_api_usage_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "integration_api_usage_api_key_id_endpoint_hour_key" ON "integration_api_usage"("api_key_id", "endpoint", "hour");
CREATE INDEX "integration_api_usage_company_id_hour_idx" ON "integration_api_usage"("company_id", "hour");

CREATE TABLE "integration_idempotency" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL,
  "api_key_id" UUID NOT NULL,
  "key" TEXT NOT NULL,
  "request_hash" TEXT NOT NULL,
  "status" INTEGER,
  "response" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "integration_idempotency_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "integration_idempotency_api_key_id_key_key" ON "integration_idempotency"("api_key_id", "key");
CREATE INDEX "integration_idempotency_created_at_idx" ON "integration_idempotency"("created_at");

-- Permissions (same roles as src/config/rbac.ts: SUPER_ADMIN all; MANAGEMENT view/edit/approve; VIEWER view).
WITH actions(action) AS (VALUES ('view'), ('edit'), ('approve'))
INSERT INTO "permissions" ("id", "key", "module", "description", "created_at")
SELECT gen_random_uuid(), 'sales_integrations.' || a.action, 'sales_integrations', a.action || ' access for sales_integrations', now()
FROM actions a
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at")
SELECT gen_random_uuid(), r."id", p."id", now()
FROM "roles" r
JOIN "permissions" p ON p."module" = 'sales_integrations'
WHERE r."is_system_role" AND (
     r."name" = 'SUPER_ADMIN'
  OR (r."name" = 'MANAGEMENT' AND p."key" IN ('sales_integrations.view', 'sales_integrations.edit', 'sales_integrations.approve'))
  OR (r."name" = 'VIEWER' AND p."key" = 'sales_integrations.view')
)
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
