
-- CreateEnum
CREATE TYPE "AiGarmentCommercialRank" AS ENUM ('FIRST_CHOICE', 'SECOND_CHOICE', 'THIRD_CHOICE', 'NOT_RANKED');

-- AlterTable
ALTER TABLE "ai_garment_projects" ADD COLUMN     "selected_design_at" TIMESTAMP(3),
ADD COLUMN     "selected_design_by_user_id" UUID,
ADD COLUMN     "selected_design_direction_id" UUID;

-- CreateTable
CREATE TABLE "ai_garment_commercial_evaluation_runs" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "compared_design_direction_ids" UUID[],
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "prompt_version" TEXT NOT NULL,
    "prompt_text" TEXT NOT NULL,
    "context_snapshot_json" JSONB NOT NULL,
    "status" "AiGarmentAnalysisRunStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "error_category" TEXT,
    "error_message" TEXT,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "created_by_user_id" UUID NOT NULL,

    CONSTRAINT "ai_garment_commercial_evaluation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_garment_commercial_evaluations" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "overall_ranking_rationale" TEXT NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_garment_commercial_evaluations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_garment_commercial_evaluation_items" (
    "id" UUID NOT NULL,
    "evaluation_id" UUID NOT NULL,
    "design_direction_id" UUID NOT NULL,
    "target_customer_fit_score" INTEGER NOT NULL,
    "buyer_fit_score" INTEGER NOT NULL,
    "fabric_suitability_score" INTEGER NOT NULL,
    "commercial_appeal_score" INTEGER NOT NULL,
    "manufacturing_simplicity_score" INTEGER NOT NULL,
    "fabric_consumption_efficiency_score" INTEGER NOT NULL,
    "pattern_making_complexity_score" INTEGER NOT NULL,
    "sewing_complexity_score" INTEGER NOT NULL,
    "trim_complexity_score" INTEGER NOT NULL,
    "target_price_compatibility_score" INTEGER NOT NULL,
    "bulk_production_scalability_score" INTEGER NOT NULL,
    "design_freshness_score" INTEGER NOT NULL,
    "commercial_development_score" INTEGER NOT NULL,
    "strengths" TEXT NOT NULL,
    "weaknesses" TEXT NOT NULL,
    "manufacturing_risks" TEXT NOT NULL,
    "potential_cost_risks" TEXT NOT NULL,
    "suggested_improvement" TEXT NOT NULL,
    "ai_rank" "AiGarmentCommercialRank" NOT NULL,
    "user_rank" "AiGarmentCommercialRank",

    CONSTRAINT "ai_garment_commercial_evaluation_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_garment_commercial_evaluation_runs_project_id_status_idx" ON "ai_garment_commercial_evaluation_runs"("project_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ai_garment_commercial_evaluations_run_id_key" ON "ai_garment_commercial_evaluations"("run_id");

-- CreateIndex
CREATE INDEX "ai_garment_commercial_evaluations_project_id_idx" ON "ai_garment_commercial_evaluations"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_garment_commercial_evaluation_items_evaluation_id_design_key" ON "ai_garment_commercial_evaluation_items"("evaluation_id", "design_direction_id");

-- AddForeignKey
ALTER TABLE "ai_garment_projects" ADD CONSTRAINT "ai_garment_projects_selected_design_direction_id_fkey" FOREIGN KEY ("selected_design_direction_id") REFERENCES "ai_garment_design_directions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_projects" ADD CONSTRAINT "ai_garment_projects_selected_design_by_user_id_fkey" FOREIGN KEY ("selected_design_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_commercial_evaluation_runs" ADD CONSTRAINT "ai_garment_commercial_evaluation_runs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_commercial_evaluation_runs" ADD CONSTRAINT "ai_garment_commercial_evaluation_runs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "ai_garment_projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_commercial_evaluation_runs" ADD CONSTRAINT "ai_garment_commercial_evaluation_runs_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_commercial_evaluations" ADD CONSTRAINT "ai_garment_commercial_evaluations_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_commercial_evaluations" ADD CONSTRAINT "ai_garment_commercial_evaluations_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "ai_garment_projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_commercial_evaluations" ADD CONSTRAINT "ai_garment_commercial_evaluations_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "ai_garment_commercial_evaluation_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_commercial_evaluations" ADD CONSTRAINT "ai_garment_commercial_evaluations_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_commercial_evaluation_items" ADD CONSTRAINT "ai_garment_commercial_evaluation_items_evaluation_id_fkey" FOREIGN KEY ("evaluation_id") REFERENCES "ai_garment_commercial_evaluations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_commercial_evaluation_items" ADD CONSTRAINT "ai_garment_commercial_evaluation_items_design_direction_id_fkey" FOREIGN KEY ("design_direction_id") REFERENCES "ai_garment_design_directions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

