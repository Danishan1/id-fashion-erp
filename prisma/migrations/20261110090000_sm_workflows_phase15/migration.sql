-- Sales & Marketing Phase 15: workflow integration. See docs/sales-marketing/PHASE_15_WORKFLOWS.md.

ALTER TYPE "CrmEntityType" ADD VALUE IF NOT EXISTS 'ENQUIRY';
ALTER TYPE "CrmEntityType" ADD VALUE IF NOT EXISTS 'QUOTATION';

CREATE TABLE "sm_workflow_definitions" (
  "id" UUID NOT NULL,
  "company_id" UUID NOT NULL,
  "workflow_key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'INACTIVE',
  "active_version_id" UUID,
  "run_as_user_id" UUID,
  "activated_at" TIMESTAMP(3),
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "sm_workflow_definitions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sm_workflow_definitions_status_check" CHECK ("status" IN ('INACTIVE', 'ACTIVE')),
  CONSTRAINT "sm_workflow_definitions_active_check" CHECK ("status" = 'INACTIVE' OR ("active_version_id" IS NOT NULL AND "run_as_user_id" IS NOT NULL))
);
CREATE UNIQUE INDEX "sm_workflow_definitions_company_id_workflow_key_key" ON "sm_workflow_definitions"("company_id", "workflow_key");
CREATE UNIQUE INDEX "sm_workflow_definitions_active_version_id_key" ON "sm_workflow_definitions"("active_version_id");

CREATE TABLE "sm_workflow_definition_versions" (
  "id" UUID NOT NULL,
  "company_id" UUID NOT NULL,
  "definition_id" UUID NOT NULL,
  "version_number" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "settings" JSONB NOT NULL DEFAULT '{}',
  "conditions" JSONB NOT NULL DEFAULT '{}',
  "change_note" TEXT,
  "created_by_user_id" UUID NOT NULL,
  "activated_at" TIMESTAMP(3),
  "activated_by_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sm_workflow_definition_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sm_workflow_definition_versions_status_check" CHECK ("status" IN ('DRAFT', 'ACTIVE', 'SUPERSEDED'))
);
CREATE UNIQUE INDEX "sm_workflow_definition_versions_definition_id_version_number_key" ON "sm_workflow_definition_versions"("definition_id", "version_number");
-- At most one draft and one active version per definition.
CREATE UNIQUE INDEX "sm_workflow_definition_versions_one_draft" ON "sm_workflow_definition_versions"("definition_id") WHERE "status" = 'DRAFT';
CREATE UNIQUE INDEX "sm_workflow_definition_versions_one_active" ON "sm_workflow_definition_versions"("definition_id") WHERE "status" = 'ACTIVE';

-- An activated version never changes (settings / conditions frozen; no way back to draft; never deleted).
CREATE OR REPLACE FUNCTION sm_workflow_version_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" <> 'DRAFT' THEN RAISE EXCEPTION 'An activated workflow version can''t be deleted'; END IF;
    RETURN OLD;
  END IF;
  IF OLD."status" <> 'DRAFT' THEN
    IF NEW."settings" IS DISTINCT FROM OLD."settings" OR NEW."conditions" IS DISTINCT FROM OLD."conditions" OR NEW."version_number" <> OLD."version_number" OR NEW."definition_id" <> OLD."definition_id" THEN
      RAISE EXCEPTION 'An activated workflow version is frozen';
    END IF;
    IF NEW."status" = 'DRAFT' THEN RAISE EXCEPTION 'An activated workflow version can''t return to draft'; END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER "sm_workflow_definition_versions_guard" BEFORE UPDATE OR DELETE ON "sm_workflow_definition_versions" FOR EACH ROW EXECUTE FUNCTION sm_workflow_version_guard();

CREATE TABLE "sm_workflow_instances" (
  "id" UUID NOT NULL,
  "company_id" UUID NOT NULL,
  "definition_id" UUID NOT NULL,
  "version_id" UUID NOT NULL,
  "workflow_key" TEXT NOT NULL,
  "entity_type" TEXT NOT NULL,
  "entity_id" UUID NOT NULL,
  "entity_label" TEXT,
  "status" TEXT NOT NULL DEFAULT 'RUNNING',
  "current_step" TEXT NOT NULL,
  "next_run_at" TIMESTAMP(3),
  "waiting_since" TIMESTAMP(3),
  "lock_token" UUID,
  "locked_at" TIMESTAMP(3),
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "trigger_source" TEXT NOT NULL,
  "trigger_event_key" TEXT,
  "correlation_id" TEXT NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "initiated_by_user_id" UUID,
  "context" JSONB NOT NULL DEFAULT '{}',
  "watch_keys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "outcome" TEXT,
  "outcome_message" TEXT,
  "error_code" TEXT,
  "error_message" TEXT,
  "compensation_status" TEXT NOT NULL DEFAULT 'NONE',
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "sm_workflow_instances_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sm_workflow_instances_status_check" CHECK ("status" IN ('RUNNING', 'WAITING_APPROVAL', 'WAITING_EVENT', 'SCHEDULED', 'RETRY_PENDING', 'NEEDS_ATTENTION', 'FAILED', 'COMPLETED', 'CANCELLED')),
  CONSTRAINT "sm_workflow_instances_trigger_check" CHECK ("trigger_source" IN ('EVENT', 'MANUAL')),
  CONSTRAINT "sm_workflow_instances_compensation_check" CHECK ("compensation_status" IN ('NONE', 'DONE', 'FAILED')),
  CONSTRAINT "sm_workflow_instances_completed_check" CHECK (("status" IN ('COMPLETED', 'CANCELLED')) = ("completed_at" IS NOT NULL))
);
CREATE UNIQUE INDEX "sm_workflow_instances_company_id_idempotency_key_key" ON "sm_workflow_instances"("company_id", "idempotency_key");
-- One live instance per workflow and record (a second trigger wakes it instead).
CREATE UNIQUE INDEX "sm_workflow_instances_one_live" ON "sm_workflow_instances"("definition_id", "entity_type", "entity_id") WHERE "status" NOT IN ('COMPLETED', 'CANCELLED');
CREATE INDEX "sm_workflow_instances_status_next_run_at_idx" ON "sm_workflow_instances"("status", "next_run_at");
CREATE INDEX "sm_workflow_instances_company_id_workflow_key_status_idx" ON "sm_workflow_instances"("company_id", "workflow_key", "status");
CREATE INDEX "sm_workflow_instances_company_id_entity_type_entity_id_idx" ON "sm_workflow_instances"("company_id", "entity_type", "entity_id");
CREATE INDEX "sm_workflow_instances_watch_keys_idx" ON "sm_workflow_instances" USING GIN ("watch_keys");

CREATE TABLE "sm_workflow_step_runs" (
  "id" UUID NOT NULL,
  "company_id" UUID NOT NULL,
  "instance_id" UUID NOT NULL,
  "sequence" INTEGER NOT NULL,
  "step_key" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "attempt" INTEGER NOT NULL DEFAULT 1,
  "checks" INTEGER NOT NULL DEFAULT 0,
  "summary" TEXT,
  "result" JSONB,
  "error_code" TEXT,
  "error_message" TEXT,
  "actor_user_id" UUID,
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_check_at" TIMESTAMP(3),
  "finished_at" TIMESTAMP(3),
  CONSTRAINT "sm_workflow_step_runs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sm_workflow_step_runs_status_check" CHECK ("status" IN ('RUNNING', 'DONE', 'WAITING', 'FAILED', 'SKIPPED', 'COMPENSATED', 'COMPENSATION_FAILED'))
);
CREATE UNIQUE INDEX "sm_workflow_step_runs_instance_id_sequence_key" ON "sm_workflow_step_runs"("instance_id", "sequence");
CREATE INDEX "sm_workflow_step_runs_instance_id_step_key_idx" ON "sm_workflow_step_runs"("instance_id", "step_key");

CREATE TABLE "sm_workflow_event_log" (
  "id" UUID NOT NULL,
  "company_id" UUID NOT NULL,
  "source" TEXT NOT NULL,
  "source_key" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "entity_type" TEXT NOT NULL,
  "entity_id" UUID NOT NULL,
  "occurred_at" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL,
  "started_instances" INTEGER NOT NULL DEFAULT 0,
  "woken_instances" INTEGER NOT NULL DEFAULT 0,
  "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sm_workflow_event_log_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "sm_workflow_event_log_source_source_key_key" ON "sm_workflow_event_log"("source", "source_key");
CREATE INDEX "sm_workflow_event_log_company_id_processed_at_idx" ON "sm_workflow_event_log"("company_id", "processed_at");

CREATE TABLE "sm_workflow_checkpoints" (
  "source" TEXT NOT NULL,
  "last_seen_at" TIMESTAMP(3) NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "sm_workflow_checkpoints_pkey" PRIMARY KEY ("source")
);

ALTER TABLE "sm_workflow_definitions" ADD CONSTRAINT "sm_workflow_definitions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sm_workflow_definitions" ADD CONSTRAINT "sm_workflow_definitions_active_version_id_fkey" FOREIGN KEY ("active_version_id") REFERENCES "sm_workflow_definition_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sm_workflow_definition_versions" ADD CONSTRAINT "sm_workflow_definition_versions_definition_id_fkey" FOREIGN KEY ("definition_id") REFERENCES "sm_workflow_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sm_workflow_instances" ADD CONSTRAINT "sm_workflow_instances_definition_id_fkey" FOREIGN KEY ("definition_id") REFERENCES "sm_workflow_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sm_workflow_instances" ADD CONSTRAINT "sm_workflow_instances_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "sm_workflow_definition_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sm_workflow_step_runs" ADD CONSTRAINT "sm_workflow_step_runs_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "sm_workflow_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Permission module "sales_workflows" ────────────────────────────
WITH actions(action) AS (
  VALUES ('view'), ('create'), ('edit'), ('delete'), ('approve'), ('reject'), ('post'),
         ('cancel'), ('export'), ('print'), ('override'), ('scan'), ('view_all')
)
INSERT INTO "permissions" ("id", "key", "module", "description", "created_at")
SELECT gen_random_uuid(), 'sales_workflows.' || a.action, 'sales_workflows', a.action || ' access for sales_workflows', now()
FROM actions a
ON CONFLICT ("key") DO NOTHING;

-- Same roles as src/config/rbac.ts: SUPER_ADMIN everything; MANAGEMENT view/edit/approve;
-- VIEWER view. (Not MERCHANDISER: instances name records across owners — monitoring is a manager's view.)
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at")
SELECT gen_random_uuid(), r."id", p."id", now()
FROM "roles" r
JOIN "permissions" p ON p."module" = 'sales_workflows'
WHERE r."is_system_role" AND (
     r."name" = 'SUPER_ADMIN'
  OR (r."name" = 'MANAGEMENT' AND p."key" IN ('sales_workflows.view', 'sales_workflows.edit', 'sales_workflows.approve'))
  OR (r."name" = 'VIEWER' AND p."key" = 'sales_workflows.view')
)
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
