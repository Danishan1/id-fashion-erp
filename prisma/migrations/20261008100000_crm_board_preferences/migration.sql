-- CRM Phase 08 — Opportunity Board + List.
-- Additive only: per-user CRM screen preferences (board card fields, list
-- columns, default saved view) and one index for board columns. No new
-- opportunity, pipeline, stage or history tables — the board and list read
-- the Phase 06 / 07 tables.

CREATE TABLE "crm_user_preferences" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_user_preferences_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "crm_user_preferences_user_id_key_key" ON "crm_user_preferences"("user_id", "key");
CREATE INDEX "crm_user_preferences_company_id_idx" ON "crm_user_preferences"("company_id");
ALTER TABLE "crm_user_preferences" ADD CONSTRAINT "crm_user_preferences_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crm_user_preferences" ADD CONSTRAINT "crm_user_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Board columns: one pipeline's opportunities per stage, newest stage entry first.
CREATE INDEX "crm_opportunities_board_idx" ON "crm_opportunities"("company_id", "pipeline_id", "stage_id", "stage_changed_at");
