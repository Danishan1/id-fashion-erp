-- CRM Phase 18 (2026-10-13): Workflow Automation Engine.
-- See docs/crm/PHASE_18_WORKFLOW_AUTOMATION.md.
--
-- crm_workflows                  one row per workflow (name, lifecycle status,
--                                pointers to its published + draft versions,
--                                the user it runs as).
-- crm_workflow_versions          the graph (trigger, nodes, settings) as JSON.
--                                A PUBLISHED / SUPERSEDED version is immutable
--                                (trigger below); editing creates a new DRAFT.
-- crm_workflow_executions        one run of a version for one record; the
--                                persistent state the scheduler resumes.
-- crm_workflow_execution_steps   one row per node visited (input, output,
--                                result, error) — the execution trace.
-- crm_workflow_event_log         which crm_events the trigger dispatcher has
--                                already evaluated (exactly-once start).

-- Phase 18: a workflow's own history (workflow.* events).
ALTER TYPE "CrmEntityType" ADD VALUE IF NOT EXISTS 'WORKFLOW';

CREATE TYPE "CrmWorkflowStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'PAUSED', 'DISABLED', 'ARCHIVED');
CREATE TYPE "CrmWorkflowVersionStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'SUPERSEDED');
CREATE TYPE "CrmWorkflowExecutionStatus" AS ENUM ('QUEUED', 'RUNNING', 'WAITING', 'PAUSED', 'COMPLETED', 'FAILED', 'CANCELLED', 'EXITED');

CREATE TABLE "crm_workflows" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "CrmWorkflowStatus" NOT NULL DEFAULT 'DRAFT',
    "trigger_type" TEXT,
    "published_version_id" UUID,
    "draft_version_id" UUID,
    "run_as_user_id" UUID,
    "webhook_secret_enc" TEXT,
    "last_triggered_at" TIMESTAMP(3),
    "published_at" TIMESTAMP(3),
    "published_by_user_id" UUID,
    "paused_at" TIMESTAMP(3),
    "disabled_at" TIMESTAMP(3),
    "archived_at" TIMESTAMP(3),
    "created_by_user_id" UUID NOT NULL,
    "updated_by_user_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "crm_workflows_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "crm_workflows_company_id_status_trigger_type_idx" ON "crm_workflows"("company_id", "status", "trigger_type");
CREATE UNIQUE INDEX "crm_workflows_published_version_id_key" ON "crm_workflows"("published_version_id");
CREATE UNIQUE INDEX "crm_workflows_draft_version_id_key" ON "crm_workflows"("draft_version_id");

CREATE TABLE "crm_workflow_versions" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "workflow_id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL,
    "status" "CrmWorkflowVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "trigger_type" TEXT,
    "definition" JSONB NOT NULL,
    "definition_hash" TEXT NOT NULL,
    "change_note" TEXT,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "published_at" TIMESTAMP(3),
    "published_by_user_id" UUID,
    CONSTRAINT "crm_workflow_versions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "crm_workflow_versions_workflow_id_version_number_key" ON "crm_workflow_versions"("workflow_id", "version_number");
CREATE INDEX "crm_workflow_versions_company_id_status_trigger_type_idx" ON "crm_workflow_versions"("company_id", "status", "trigger_type");
-- At most one editable draft and one live version per workflow.
CREATE UNIQUE INDEX "crm_workflow_versions_one_draft" ON "crm_workflow_versions"("workflow_id") WHERE "status" = 'DRAFT';
CREATE UNIQUE INDEX "crm_workflow_versions_one_published" ON "crm_workflow_versions"("workflow_id") WHERE "status" = 'PUBLISHED';

CREATE TABLE "crm_workflow_executions" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "workflow_id" UUID NOT NULL,
    "workflow_version_id" UUID NOT NULL,
    "status" "CrmWorkflowExecutionStatus" NOT NULL DEFAULT 'QUEUED',
    "mode" TEXT NOT NULL DEFAULT 'LIVE',
    "trigger_type" TEXT NOT NULL,
    "trigger_event_id" UUID,
    "entity_type" "CrmEntityType",
    "entity_id" UUID,
    "idempotency_key" TEXT NOT NULL,
    "parent_execution_id" UUID,
    "depth" INTEGER NOT NULL DEFAULT 0,
    "current_node_id" TEXT,
    "context" JSONB NOT NULL DEFAULT '{}',
    "next_run_at" TIMESTAMP(3),
    "locked_at" TIMESTAMP(3),
    "lock_token" UUID,
    "step_count" INTEGER NOT NULL DEFAULT 0,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "outcome" TEXT,
    "exit_reason" TEXT,
    "error_code" TEXT,
    "error_message" TEXT,
    "run_as_user_id" UUID,
    "started_by_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "crm_workflow_executions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "crm_workflow_executions_mode_check" CHECK ("mode" IN ('LIVE', 'TEST')),
    CONSTRAINT "crm_workflow_executions_depth_check" CHECK ("depth" >= 0)
);
CREATE UNIQUE INDEX "crm_workflow_executions_company_id_idempotency_key_key" ON "crm_workflow_executions"("company_id", "idempotency_key");
CREATE INDEX "crm_workflow_executions_company_id_workflow_id_created_at_idx" ON "crm_workflow_executions"("company_id", "workflow_id", "created_at");
CREATE INDEX "crm_workflow_executions_status_next_run_at_idx" ON "crm_workflow_executions"("status", "next_run_at");
CREATE INDEX "crm_workflow_executions_company_id_entity_type_entity_id_idx" ON "crm_workflow_executions"("company_id", "entity_type", "entity_id");
CREATE INDEX "crm_workflow_executions_workflow_id_entity_id_status_idx" ON "crm_workflow_executions"("workflow_id", "entity_id", "status");

CREATE TABLE "crm_workflow_execution_steps" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "execution_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "node_id" TEXT NOT NULL,
    "node_type" TEXT NOT NULL,
    "action_key" TEXT,
    "status" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "idempotency_key" TEXT NOT NULL,
    "input" JSONB,
    "output" JSONB,
    "branch" TEXT,
    "error_code" TEXT,
    "error_message" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    CONSTRAINT "crm_workflow_execution_steps_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "crm_workflow_execution_steps_status_check" CHECK ("status" IN ('RUNNING', 'COMPLETED', 'FAILED', 'SKIPPED', 'WAITING', 'SIMULATED'))
);
CREATE UNIQUE INDEX "crm_workflow_execution_steps_execution_id_sequence_key" ON "crm_workflow_execution_steps"("execution_id", "sequence");
CREATE UNIQUE INDEX "crm_workflow_execution_steps_idempotency_key_key" ON "crm_workflow_execution_steps"("idempotency_key");
CREATE INDEX "crm_workflow_execution_steps_company_id_action_key_idx" ON "crm_workflow_execution_steps"("company_id", "action_key");

CREATE TABLE "crm_workflow_event_log" (
    "event_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "matched" INTEGER NOT NULL DEFAULT 0,
    "started" INTEGER NOT NULL DEFAULT 0,
    "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "crm_workflow_event_log_pkey" PRIMARY KEY ("event_id")
);
CREATE INDEX "crm_workflow_event_log_processed_at_idx" ON "crm_workflow_event_log"("processed_at");

ALTER TABLE "crm_workflows" ADD CONSTRAINT "crm_workflows_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crm_workflows" ADD CONSTRAINT "crm_workflows_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crm_workflows" ADD CONSTRAINT "crm_workflows_run_as_user_id_fkey" FOREIGN KEY ("run_as_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_workflows" ADD CONSTRAINT "crm_workflows_published_version_id_fkey" FOREIGN KEY ("published_version_id") REFERENCES "crm_workflow_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_workflows" ADD CONSTRAINT "crm_workflows_draft_version_id_fkey" FOREIGN KEY ("draft_version_id") REFERENCES "crm_workflow_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_workflow_versions" ADD CONSTRAINT "crm_workflow_versions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crm_workflow_versions" ADD CONSTRAINT "crm_workflow_versions_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "crm_workflows"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crm_workflow_versions" ADD CONSTRAINT "crm_workflow_versions_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crm_workflow_executions" ADD CONSTRAINT "crm_workflow_executions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crm_workflow_executions" ADD CONSTRAINT "crm_workflow_executions_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "crm_workflows"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crm_workflow_executions" ADD CONSTRAINT "crm_workflow_executions_workflow_version_id_fkey" FOREIGN KEY ("workflow_version_id") REFERENCES "crm_workflow_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crm_workflow_executions" ADD CONSTRAINT "crm_workflow_executions_parent_execution_id_fkey" FOREIGN KEY ("parent_execution_id") REFERENCES "crm_workflow_executions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_workflow_execution_steps" ADD CONSTRAINT "crm_workflow_execution_steps_execution_id_fkey" FOREIGN KEY ("execution_id") REFERENCES "crm_workflow_executions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A published (or superseded) version is a frozen record of what ran:
-- its graph can never change and it can never be deleted. Only the status
-- (PUBLISHED → SUPERSEDED) and publish bookkeeping may move.
CREATE FUNCTION crm_workflow_versions_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'crm_workflow_versions: published version % cannot be deleted', OLD.id;
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status <> 'DRAFT' THEN
    IF NEW.definition IS DISTINCT FROM OLD.definition
       OR NEW.definition_hash IS DISTINCT FROM OLD.definition_hash
       OR NEW.trigger_type IS DISTINCT FROM OLD.trigger_type
       OR NEW.version_number IS DISTINCT FROM OLD.version_number
       OR NEW.workflow_id IS DISTINCT FROM OLD.workflow_id
       OR NEW.company_id IS DISTINCT FROM OLD.company_id THEN
      RAISE EXCEPTION 'crm_workflow_versions: published version % is immutable', OLD.id;
    END IF;
    IF NEW.status = 'DRAFT' THEN
      RAISE EXCEPTION 'crm_workflow_versions: published version % cannot return to draft', OLD.id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER crm_workflow_versions_guard
BEFORE UPDATE OR DELETE ON "crm_workflow_versions"
FOR EACH ROW EXECUTE FUNCTION crm_workflow_versions_guard();
