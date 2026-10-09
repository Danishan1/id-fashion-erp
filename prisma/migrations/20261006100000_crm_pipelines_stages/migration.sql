-- CRM Phase 07 — Pipelines & Stages.
-- Additive only: configurable pipelines/stages (description, default stage,
-- required fields, transition rules, archive), stage history, and whether an
-- opportunity's probability follows its stage or was set by hand.
-- Existing data is back-filled; no opportunity loses its pipeline or stage.

-- ── Pipelines ────────────────────────────────────────────────────
ALTER TABLE "crm_pipelines"
ADD COLUMN "name_key" TEXT NOT NULL DEFAULT '',
ADD COLUMN "description" TEXT,
ADD COLUMN "archived_at" TIMESTAMP(3),
ADD COLUMN "archived_by_user_id" UUID,
ADD COLUMN "updated_by_user_id" UUID,
ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "created_by_user_id" UUID;

UPDATE "crm_pipelines" SET "name_key" = lower(regexp_replace(btrim("name"), '\s+', ' ', 'g'));
UPDATE "crm_pipelines" SET "archived_at" = "updated_at" WHERE "is_active" = false;

-- One default per company: keep the first default (by order) if a tenant somehow has several …
UPDATE "crm_pipelines" p SET "is_default" = false
WHERE p."is_default" AND EXISTS (
  SELECT 1 FROM "crm_pipelines" q
  WHERE q."company_id" = p."company_id" AND q."is_default" AND (q."sort_order", q."created_at", q."id") < (p."sort_order", p."created_at", p."id")
);
-- … and give tenants without one their first active pipeline.
UPDATE "crm_pipelines" p SET "is_default" = true
WHERE p."id" IN (
  SELECT DISTINCT ON (x."company_id") x."id" FROM "crm_pipelines" x
  WHERE x."archived_at" IS NULL AND NOT EXISTS (SELECT 1 FROM "crm_pipelines" d WHERE d."company_id" = x."company_id" AND d."is_default")
  ORDER BY x."company_id", x."sort_order", x."created_at", x."id"
);

CREATE UNIQUE INDEX "crm_pipelines_one_default_per_company" ON "crm_pipelines"("company_id") WHERE "is_default";
CREATE UNIQUE INDEX "crm_pipelines_active_name_key" ON "crm_pipelines"("company_id", "name_key") WHERE "archived_at" IS NULL;
ALTER TABLE "crm_pipelines" ADD CONSTRAINT "crm_pipelines_default_not_archived_check" CHECK (NOT ("is_default" AND "archived_at" IS NOT NULL));

-- ── Stages ───────────────────────────────────────────────────────
ALTER TABLE "crm_pipeline_stages"
ADD COLUMN "name_key" TEXT NOT NULL DEFAULT '',
ADD COLUMN "description" TEXT,
ADD COLUMN "is_default" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "required_fields" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN "transition_mode" TEXT NOT NULL DEFAULT 'ANY',
ADD COLUMN "archived_at" TIMESTAMP(3),
ADD COLUMN "archived_by_user_id" UUID,
ADD COLUMN "updated_by_user_id" UUID,
ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

UPDATE "crm_pipeline_stages" SET "name_key" = lower(regexp_replace(btrim("name"), '\s+', ' ', 'g'));
UPDATE "crm_pipeline_stages" SET "archived_at" = "updated_at" WHERE "is_active" = false;
-- The first active stage of each pipeline becomes its default (where new opportunities start, as in Phase 06).
UPDATE "crm_pipeline_stages" s SET "is_default" = true
WHERE s."id" IN (
  SELECT DISTINCT ON (x."pipeline_id") x."id" FROM "crm_pipeline_stages" x
  WHERE x."archived_at" IS NULL
  ORDER BY x."pipeline_id", x."sort_order", x."created_at", x."id"
);

CREATE UNIQUE INDEX "crm_pipeline_stages_one_default_per_pipeline" ON "crm_pipeline_stages"("pipeline_id") WHERE "is_default";
CREATE UNIQUE INDEX "crm_pipeline_stages_active_name_key" ON "crm_pipeline_stages"("pipeline_id", "name_key") WHERE "archived_at" IS NULL;
ALTER TABLE "crm_pipeline_stages" ADD CONSTRAINT "crm_pipeline_stages_default_not_archived_check" CHECK (NOT ("is_default" AND "archived_at" IS NOT NULL));
ALTER TABLE "crm_pipeline_stages" ADD CONSTRAINT "crm_pipeline_stages_transition_mode_check" CHECK ("transition_mode" IN ('ANY', 'ONLY_LISTED'));
ALTER TABLE "crm_pipeline_stages" ADD CONSTRAINT "crm_pipeline_stages_required_fields_check" CHECK (jsonb_typeof("required_fields") = 'array');

-- ── Transition rules ─────────────────────────────────────────────
CREATE TABLE "crm_stage_transition_rules" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "pipeline_id" UUID NOT NULL,
    "from_stage_id" UUID NOT NULL,
    "to_stage_id" UUID NOT NULL,
    "allowed" BOOLEAN NOT NULL DEFAULT true,
    "required_fields" JSONB NOT NULL DEFAULT '[]',
    "message" TEXT,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_stage_transition_rules_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "crm_stage_transition_rules_distinct_check" CHECK ("from_stage_id" <> "to_stage_id"),
    CONSTRAINT "crm_stage_transition_rules_required_fields_check" CHECK (jsonb_typeof("required_fields") = 'array')
);
CREATE UNIQUE INDEX "crm_stage_transition_rules_from_stage_id_to_stage_id_key" ON "crm_stage_transition_rules"("from_stage_id", "to_stage_id");
CREATE INDEX "crm_stage_transition_rules_company_id_pipeline_id_idx" ON "crm_stage_transition_rules"("company_id", "pipeline_id");
ALTER TABLE "crm_stage_transition_rules" ADD CONSTRAINT "crm_stage_transition_rules_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crm_stage_transition_rules" ADD CONSTRAINT "crm_stage_transition_rules_pipeline_id_fkey" FOREIGN KEY ("pipeline_id") REFERENCES "crm_pipelines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crm_stage_transition_rules" ADD CONSTRAINT "crm_stage_transition_rules_from_stage_id_fkey" FOREIGN KEY ("from_stage_id") REFERENCES "crm_pipeline_stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crm_stage_transition_rules" ADD CONSTRAINT "crm_stage_transition_rules_to_stage_id_fkey" FOREIGN KEY ("to_stage_id") REFERENCES "crm_pipeline_stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Opportunities ────────────────────────────────────────────────
ALTER TABLE "crm_opportunities" ADD COLUMN "probability_source" TEXT;
ALTER TABLE "crm_opportunities" ADD CONSTRAINT "crm_opportunities_probability_source_check" CHECK ("probability_source" IS NULL OR "probability_source" IN ('STAGE', 'MANUAL'));
-- Phase 06 rule, made explicit: a probability equal to the stage default follows the stage.
UPDATE "crm_opportunities" o SET "probability_source" = CASE
    WHEN o."probability" IS NULL THEN NULL
    WHEN s."probability" IS NOT NULL AND o."probability" = s."probability" THEN 'STAGE'
    ELSE 'MANUAL' END
FROM "crm_pipeline_stages" s WHERE s."id" = o."stage_id";
UPDATE "crm_opportunities" SET "probability_source" = 'MANUAL' WHERE "stage_id" IS NULL AND "probability" IS NOT NULL;

-- A stage or pipeline can never be deleted out from under an opportunity (archive + reassign instead).
ALTER TABLE "crm_opportunities" DROP CONSTRAINT "crm_opportunities_pipeline_id_fkey";
ALTER TABLE "crm_opportunities" DROP CONSTRAINT "crm_opportunities_stage_id_fkey";
ALTER TABLE "crm_opportunities" ADD CONSTRAINT "crm_opportunities_pipeline_id_fkey" FOREIGN KEY ("pipeline_id") REFERENCES "crm_pipelines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crm_opportunities" ADD CONSTRAINT "crm_opportunities_stage_id_fkey" FOREIGN KEY ("stage_id") REFERENCES "crm_pipeline_stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Stage history ────────────────────────────────────────────────
CREATE TABLE "crm_opportunity_stage_history" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "opportunity_id" UUID NOT NULL,
    "change_type" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "from_pipeline_id" UUID,
    "to_pipeline_id" UUID NOT NULL,
    "from_stage_id" UUID,
    "to_stage_id" UUID NOT NULL,
    "from_stage_name" TEXT,
    "to_stage_name" TEXT NOT NULL,
    "from_probability" INTEGER,
    "to_probability" INTEGER,
    "probability_source" TEXT,
    "result" TEXT NOT NULL DEFAULT 'APPLIED',
    "reason" TEXT,
    "changed_by_user_id" UUID,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_opportunity_stage_history_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "crm_opp_stage_history_opportunity_idx" ON "crm_opportunity_stage_history"("company_id", "opportunity_id", "changed_at");
CREATE INDEX "crm_opp_stage_history_stage_idx" ON "crm_opportunity_stage_history"("company_id", "to_pipeline_id", "to_stage_id");
ALTER TABLE "crm_opportunity_stage_history" ADD CONSTRAINT "crm_opportunity_stage_history_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crm_opportunity_stage_history" ADD CONSTRAINT "crm_opportunity_stage_history_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "crm_opportunities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Back-fill from the Phase 06 timeline: where each opportunity started …
INSERT INTO "crm_opportunity_stage_history" ("id", "company_id", "opportunity_id", "change_type", "source", "to_pipeline_id", "to_stage_id", "to_stage_name", "to_probability", "changed_by_user_id", "changed_at")
SELECT gen_random_uuid(), o."company_id", o."id", 'INITIAL', 'BACKFILL', s."pipeline_id", s."id", s."name", NULL, o."created_by_user_id", o."created_at"
FROM "crm_opportunities" o
LEFT JOIN LATERAL (
  SELECT (e."payload"->>'stageId') AS sid FROM "crm_events" e
  WHERE e."entity_type" = 'OPPORTUNITY' AND e."entity_id" = o."id" AND e."event_type" = 'opportunity.created'
  ORDER BY e."occurred_at" LIMIT 1
) c ON true
JOIN "crm_pipeline_stages" s ON s."id" = COALESCE(
  (SELECT x."id" FROM "crm_pipeline_stages" x WHERE x."id"::text = c.sid),
  (SELECT x."id" FROM "crm_pipeline_stages" x WHERE x."id"::text = (
     SELECT e2."payload"->>'fromStageId' FROM "crm_events" e2
     WHERE e2."entity_type" = 'OPPORTUNITY' AND e2."entity_id" = o."id" AND e2."event_type" = 'opportunity.stage_changed'
     ORDER BY e2."occurred_at" LIMIT 1)),
  o."stage_id")
WHERE o."stage_id" IS NOT NULL;

-- … and every stage change since.
INSERT INTO "crm_opportunity_stage_history" ("id", "company_id", "opportunity_id", "change_type", "source", "from_pipeline_id", "to_pipeline_id", "from_stage_id", "to_stage_id", "from_stage_name", "to_stage_name", "from_probability", "to_probability", "changed_by_user_id", "changed_at")
SELECT gen_random_uuid(), e."company_id", e."entity_id",
  CASE WHEN fs."pipeline_id" IS DISTINCT FROM ts."pipeline_id" AND fs."id" IS NOT NULL THEN 'PIPELINE_TRANSFER' ELSE 'STAGE_CHANGE' END,
  'BACKFILL', fs."pipeline_id", ts."pipeline_id", fs."id", ts."id",
  COALESCE(e."payload"->>'fromStage', fs."name"), COALESCE(e."payload"->>'toStage', ts."name"),
  CASE WHEN jsonb_typeof(e."payload"->'fromProbability') = 'number' THEN (e."payload"->>'fromProbability')::int END,
  CASE WHEN jsonb_typeof(e."payload"->'toProbability') = 'number' THEN (e."payload"->>'toProbability')::int END,
  e."actor_user_id", e."occurred_at"
FROM "crm_events" e
JOIN "crm_opportunities" o ON o."id" = e."entity_id"
JOIN "crm_pipeline_stages" ts ON ts."id"::text = e."payload"->>'toStageId'
LEFT JOIN "crm_pipeline_stages" fs ON fs."id"::text = e."payload"->>'fromStageId'
WHERE e."entity_type" = 'OPPORTUNITY' AND e."event_type" = 'opportunity.stage_changed';
