-- Sales & Marketing Phase 13: campaign attribution & ROI.
-- Touchpoints and conversions are references to authoritative records; attribution
-- results are per run and never edited (a recalculation is a new run).

-- ── Models ─────────────────────────────────────────────────────────
CREATE TABLE "marketing_attribution_models" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "current_version_number" INTEGER NOT NULL DEFAULT 1,
    "approved_version_id" UUID,
    "owner_user_id" UUID NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "updated_by_user_id" UUID,
    "retired_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "marketing_attribution_models_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "marketing_attribution_models_code_check" CHECK ("code" ~ '^[A-Z0-9][A-Z0-9_-]{1,29}$'),
    CONSTRAINT "marketing_attribution_models_status_check" CHECK ("status" IN ('DRAFT', 'ACTIVE', 'RETIRED')),
    CONSTRAINT "marketing_attribution_models_active_check" CHECK ("status" <> 'ACTIVE' OR "approved_version_id" IS NOT NULL),
    CONSTRAINT "marketing_attribution_models_default_check" CHECK (NOT "is_default" OR "status" = 'ACTIVE')
);
CREATE UNIQUE INDEX "marketing_attribution_models_company_id_code_key" ON "marketing_attribution_models"("company_id", "code");
CREATE UNIQUE INDEX "marketing_attribution_models_approved_version_id_key" ON "marketing_attribution_models"("approved_version_id");
CREATE INDEX "marketing_attribution_models_company_id_status_idx" ON "marketing_attribution_models"("company_id", "status");
CREATE UNIQUE INDEX "marketing_attribution_models_one_default" ON "marketing_attribution_models"("company_id") WHERE "is_default";

CREATE TABLE "marketing_attribution_model_versions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "model_id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "model_type" TEXT NOT NULL,
    "window_days" INTEGER NOT NULL,
    "touchpoint_types" TEXT[] NOT NULL,
    "channel_types" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "conversion_types" TEXT[] NOT NULL,
    "collapse_repeats" BOOLEAN NOT NULL DEFAULT true,
    "first_touch_percent" DECIMAL(5,2),
    "last_touch_percent" DECIMAL(5,2),
    "half_life_days" DECIMAL(8,2),
    "change_note" TEXT,
    "created_by_user_id" UUID NOT NULL,
    "updated_by_user_id" UUID,
    "submitted_by_user_id" UUID,
    "submitted_at" TIMESTAMP(3),
    "decided_by_user_id" UUID,
    "decided_at" TIMESTAMP(3),
    "decision_comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "marketing_attribution_model_versions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "marketing_attribution_versions_status_check" CHECK ("status" IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SUPERSEDED', 'REJECTED')),
    CONSTRAINT "marketing_attribution_versions_type_check" CHECK ("model_type" IN ('FIRST_TOUCH', 'LAST_TOUCH', 'LINEAR', 'POSITION_BASED', 'TIME_DECAY')),
    CONSTRAINT "marketing_attribution_versions_window_check" CHECK ("window_days" BETWEEN 1 AND 730),
    CONSTRAINT "marketing_attribution_versions_touch_check" CHECK (cardinality("touchpoint_types") > 0 AND "touchpoint_types" <@ ARRAY['MESSAGE_SENT', 'MESSAGE_DELIVERED', 'CAMPAIGN_RESPONSE']::TEXT[]),
    CONSTRAINT "marketing_attribution_versions_channel_check" CHECK ("channel_types" <@ ARRAY['EMAIL', 'SMS', 'WHATSAPP']::TEXT[]),
    CONSTRAINT "marketing_attribution_versions_conversion_check" CHECK (cardinality("conversion_types") > 0 AND "conversion_types" <@ ARRAY['LEAD_CREATED', 'ENQUIRY_CREATED', 'QUOTATION_ACCEPTED', 'SALES_ORDER_BOOKED']::TEXT[]),
    CONSTRAINT "marketing_attribution_versions_position_check" CHECK (
        "model_type" <> 'POSITION_BASED'
        OR ("first_touch_percent" BETWEEN 0 AND 100 AND "last_touch_percent" BETWEEN 0 AND 100 AND "first_touch_percent" + "last_touch_percent" <= 100)),
    CONSTRAINT "marketing_attribution_versions_decay_check" CHECK ("model_type" <> 'TIME_DECAY' OR "half_life_days" > 0),
    CONSTRAINT "marketing_attribution_versions_decision_check" CHECK ("decided_by_user_id" IS NULL OR ("decided_by_user_id" <> "created_by_user_id" AND "decided_by_user_id" IS DISTINCT FROM "submitted_by_user_id"))
);
CREATE UNIQUE INDEX "marketing_attribution_model_versions_model_id_version_number_key" ON "marketing_attribution_model_versions"("model_id", "version_number");
CREATE UNIQUE INDEX "marketing_attribution_versions_one_open" ON "marketing_attribution_model_versions"("model_id") WHERE "status" IN ('DRAFT', 'PENDING_APPROVAL');

-- ── Touchpoints & conversions ──────────────────────────────────────
CREATE TABLE "marketing_touchpoints" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_id" UUID NOT NULL,
    "dedup_key" TEXT NOT NULL,
    "touchpoint_type" TEXT NOT NULL,
    "campaign_id" UUID NOT NULL,
    "channel_type" TEXT,
    "provider_key" TEXT,
    "identity_keys" TEXT[] NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'VALID',
    "excluded_reason" TEXT,
    "ingested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "marketing_touchpoints_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "marketing_touchpoints_source_check" CHECK ("source_type" IN ('DELIVERY', 'LEAD', 'ENQUIRY', 'QUOTATION', 'SALES_ORDER')),
    CONSTRAINT "marketing_touchpoints_type_check" CHECK ("touchpoint_type" IN ('MESSAGE_SENT', 'MESSAGE_DELIVERED', 'CAMPAIGN_RESPONSE')),
    CONSTRAINT "marketing_touchpoints_status_check" CHECK ("status" IN ('VALID', 'EXCLUDED'))
);
CREATE UNIQUE INDEX "marketing_touchpoints_company_id_dedup_key_key" ON "marketing_touchpoints"("company_id", "dedup_key");
CREATE INDEX "marketing_touchpoints_company_id_occurred_at_idx" ON "marketing_touchpoints"("company_id", "occurred_at");
CREATE INDEX "marketing_touchpoints_campaign_id_idx" ON "marketing_touchpoints"("campaign_id");
CREATE INDEX "marketing_touchpoints_company_id_updated_at_idx" ON "marketing_touchpoints"("company_id", "updated_at");
CREATE INDEX "marketing_touchpoints_identity_keys_idx" ON "marketing_touchpoints" USING GIN ("identity_keys");

CREATE TABLE "marketing_conversions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "conversion_type" TEXT NOT NULL,
    "source_id" UUID NOT NULL,
    "source_revision_id" UUID,
    "reference" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "business_date" DATE NOT NULL,
    "identity_keys" TEXT[] NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "status_reason" TEXT,
    "quoted_value" DECIMAL(18,2),
    "order_value" DECIMAL(18,2),
    "invoiced_value" DECIMAL(18,2),
    "currency_code" CHAR(3) NOT NULL DEFAULT 'INR',
    "ingested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "marketing_conversions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "marketing_conversions_type_check" CHECK ("conversion_type" IN ('LEAD_CREATED', 'ENQUIRY_CREATED', 'QUOTATION_ACCEPTED', 'SALES_ORDER_BOOKED')),
    CONSTRAINT "marketing_conversions_status_check" CHECK ("status" IN ('ACTIVE', 'REVERSED', 'REMOVED')),
    CONSTRAINT "marketing_conversions_values_check" CHECK (COALESCE("quoted_value", 0) >= 0 AND COALESCE("order_value", 0) >= 0 AND COALESCE("invoiced_value", 0) >= 0)
);
CREATE UNIQUE INDEX "marketing_conversions_company_id_conversion_type_source_id_key" ON "marketing_conversions"("company_id", "conversion_type", "source_id");
CREATE INDEX "marketing_conversions_company_id_occurred_at_idx" ON "marketing_conversions"("company_id", "occurred_at");
CREATE INDEX "marketing_conversions_company_id_updated_at_idx" ON "marketing_conversions"("company_id", "updated_at");

-- ── Runs, results, credits ─────────────────────────────────────────
CREATE TABLE "marketing_attribution_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "model_id" UUID NOT NULL,
    "model_version_id" UUID NOT NULL,
    "period_from" DATE NOT NULL,
    "period_to" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "trigger" TEXT NOT NULL DEFAULT 'MANUAL',
    "requested_by_user_id" UUID,
    "idempotency_key" TEXT,
    "sources_synced_at" TIMESTAMP(3),
    "conversions" INTEGER NOT NULL DEFAULT 0,
    "attributed" INTEGER NOT NULL DEFAULT 0,
    "unattributed" INTEGER NOT NULL DEFAULT 0,
    "excluded" INTEGER NOT NULL DEFAULT 0,
    "summary" JSONB NOT NULL DEFAULT '{}',
    "error" TEXT,
    "queued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "results_purged_at" TIMESTAMP(3),
    CONSTRAINT "marketing_attribution_runs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "marketing_attribution_runs_status_check" CHECK ("status" IN ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'PURGED')),
    CONSTRAINT "marketing_attribution_runs_trigger_check" CHECK ("trigger" IN ('MANUAL', 'SCHEDULED')),
    CONSTRAINT "marketing_attribution_runs_period_check" CHECK ("period_to" >= "period_from" AND "period_to" - "period_from" <= 731)
);
CREATE UNIQUE INDEX "marketing_attribution_runs_company_id_idempotency_key_key" ON "marketing_attribution_runs"("company_id", "idempotency_key");
CREATE INDEX "marketing_attribution_runs_model_version_id_status_finished_at_idx" ON "marketing_attribution_runs"("model_version_id", "status", "finished_at");
CREATE INDEX "marketing_attribution_runs_company_id_status_idx" ON "marketing_attribution_runs"("company_id", "status");
-- One queued or running calculation per model version.
CREATE UNIQUE INDEX "marketing_attribution_runs_one_active" ON "marketing_attribution_runs"("model_version_id") WHERE "status" IN ('QUEUED', 'RUNNING');

CREATE TABLE "marketing_attribution_results" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "conversion_id" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "reason" TEXT,
    "touchpoint_count" INTEGER NOT NULL DEFAULT 0,
    "conversion_at" TIMESTAMP(3) NOT NULL,
    "window_start" TIMESTAMP(3) NOT NULL,
    "quoted_value" DECIMAL(18,2),
    "order_value" DECIMAL(18,2),
    "invoiced_value" DECIMAL(18,2),
    CONSTRAINT "marketing_attribution_results_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "marketing_attribution_results_status_check" CHECK ("status" IN ('ATTRIBUTED', 'UNATTRIBUTED', 'EXCLUDED'))
);
CREATE UNIQUE INDEX "marketing_attribution_results_run_id_conversion_id_key" ON "marketing_attribution_results"("run_id", "conversion_id");
CREATE INDEX "marketing_attribution_results_run_id_status_idx" ON "marketing_attribution_results"("run_id", "status");

CREATE TABLE "marketing_attribution_credits" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "result_id" UUID NOT NULL,
    "touchpoint_id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "touchpoint_type" TEXT NOT NULL,
    "channel_type" TEXT,
    "position" INTEGER NOT NULL,
    "weight" DECIMAL(12,10) NOT NULL,
    "quoted_credit" DECIMAL(18,2),
    "order_credit" DECIMAL(18,2),
    "invoiced_credit" DECIMAL(18,2),
    CONSTRAINT "marketing_attribution_credits_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "marketing_attribution_credits_weight_check" CHECK ("weight" > 0 AND "weight" <= 1)
);
CREATE UNIQUE INDEX "marketing_attribution_credits_result_id_touchpoint_id_key" ON "marketing_attribution_credits"("result_id", "touchpoint_id");
CREATE INDEX "marketing_attribution_credits_run_id_campaign_id_idx" ON "marketing_attribution_credits"("run_id", "campaign_id");

CREATE TABLE "marketing_attribution_checkpoints" (
    "company_id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "synced_up_to" TIMESTAMP(3) NOT NULL,
    "last_sync_at" TIMESTAMP(3) NOT NULL,
    "processed" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "marketing_attribution_checkpoints_pkey" PRIMARY KEY ("company_id", "source")
);

-- ── Foreign keys ───────────────────────────────────────────────────
ALTER TABLE "marketing_attribution_models" ADD CONSTRAINT "marketing_attribution_models_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "marketing_attribution_models" ADD CONSTRAINT "marketing_attribution_models_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "marketing_attribution_models" ADD CONSTRAINT "marketing_attribution_models_created_by_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "marketing_attribution_models" ADD CONSTRAINT "marketing_attribution_models_approved_version_id_fkey" FOREIGN KEY ("approved_version_id") REFERENCES "marketing_attribution_model_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "marketing_attribution_model_versions" ADD CONSTRAINT "marketing_attribution_model_versions_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "marketing_attribution_models"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "marketing_attribution_model_versions" ADD CONSTRAINT "marketing_attribution_versions_created_by_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "marketing_attribution_model_versions" ADD CONSTRAINT "marketing_attribution_versions_decided_by_fkey" FOREIGN KEY ("decided_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "marketing_touchpoints" ADD CONSTRAINT "marketing_touchpoints_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "marketing_touchpoints" ADD CONSTRAINT "marketing_touchpoints_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "marketing_campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "marketing_conversions" ADD CONSTRAINT "marketing_conversions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "marketing_attribution_runs" ADD CONSTRAINT "marketing_attribution_runs_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "marketing_attribution_models"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "marketing_attribution_runs" ADD CONSTRAINT "marketing_attribution_runs_model_version_id_fkey" FOREIGN KEY ("model_version_id") REFERENCES "marketing_attribution_model_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "marketing_attribution_runs" ADD CONSTRAINT "marketing_attribution_runs_requested_by_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "marketing_attribution_results" ADD CONSTRAINT "marketing_attribution_results_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "marketing_attribution_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "marketing_attribution_results" ADD CONSTRAINT "marketing_attribution_results_conversion_id_fkey" FOREIGN KEY ("conversion_id") REFERENCES "marketing_conversions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "marketing_attribution_credits" ADD CONSTRAINT "marketing_attribution_credits_result_id_fkey" FOREIGN KEY ("result_id") REFERENCES "marketing_attribution_results"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "marketing_attribution_credits" ADD CONSTRAINT "marketing_attribution_credits_touchpoint_id_fkey" FOREIGN KEY ("touchpoint_id") REFERENCES "marketing_touchpoints"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "marketing_attribution_credits" ADD CONSTRAINT "marketing_attribution_credits_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "marketing_campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "marketing_attribution_checkpoints" ADD CONSTRAINT "marketing_attribution_checkpoints_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Integrity triggers ─────────────────────────────────────────────
-- A decided model version never changes, except APPROVED → SUPERSEDED with everything else equal.
CREATE OR REPLACE FUNCTION marketing_attribution_version_frozen() RETURNS trigger AS $$
BEGIN
  IF OLD."status" IN ('APPROVED', 'SUPERSEDED', 'REJECTED') THEN
    IF NOT (OLD."status" = 'APPROVED' AND NEW."status" = 'SUPERSEDED'
            AND (to_jsonb(NEW) - 'status' - 'updated_at') = (to_jsonb(OLD) - 'status' - 'updated_at')) THEN
      RAISE EXCEPTION 'A decided attribution model version can''t be changed — create a new version' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "marketing_attribution_versions_frozen" BEFORE UPDATE ON "marketing_attribution_model_versions" FOR EACH ROW EXECUTE FUNCTION marketing_attribution_version_frozen();

-- Results and credits are written once by their run (deletion only via run retention).
CREATE OR REPLACE FUNCTION marketing_attribution_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Attribution results can''t be edited — recalculate instead' USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "marketing_attribution_results_immutable" BEFORE UPDATE ON "marketing_attribution_results" FOR EACH ROW EXECUTE FUNCTION marketing_attribution_immutable();
CREATE TRIGGER "marketing_attribution_credits_immutable" BEFORE UPDATE ON "marketing_attribution_credits" FOR EACH ROW EXECUTE FUNCTION marketing_attribution_immutable();

-- ── Permission module "marketing_attribution" ──────────────────────
WITH actions(action) AS (
  VALUES ('view'), ('create'), ('edit'), ('delete'), ('approve'), ('reject'), ('post'),
         ('cancel'), ('export'), ('print'), ('override'), ('scan'), ('view_all')
)
INSERT INTO "permissions" ("id", "key", "module", "description", "created_at")
SELECT gen_random_uuid(), 'marketing_attribution.' || a.action, 'marketing_attribution', a.action || ' access for marketing_attribution', now()
FROM actions a
ON CONFLICT ("key") DO NOTHING;

-- Same roles as src/config/rbac.ts: SUPER_ADMIN everything; MANAGEMENT
-- view/create/edit/approve/reject/export; MERCHANDISER view/export; VIEWER view.
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at")
SELECT gen_random_uuid(), r."id", p."id", now()
FROM "roles" r
JOIN "permissions" p ON p."module" = 'marketing_attribution'
WHERE r."is_system_role" AND (
     r."name" = 'SUPER_ADMIN'
  OR (r."name" = 'MANAGEMENT' AND p."key" IN ('marketing_attribution.view', 'marketing_attribution.create', 'marketing_attribution.edit', 'marketing_attribution.approve', 'marketing_attribution.reject', 'marketing_attribution.export'))
  OR (r."name" = 'MERCHANDISER' AND p."key" IN ('marketing_attribution.view', 'marketing_attribution.export'))
  OR (r."name" = 'VIEWER' AND p."key" = 'marketing_attribution.view')
)
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
