-- CreateEnum
CREATE TYPE "AiGarmentCostImpactDirection" AS ENUM ('LOWER', 'SIMILAR', 'HIGHER');

-- CreateTable
CREATE TABLE "ai_garment_value_engineering_runs" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "prompt_version" TEXT NOT NULL,
    "prompt_text" TEXT NOT NULL,
    "status" "AiGarmentAnalysisRunStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "error_category" TEXT,
    "error_message" TEXT,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "created_by_user_id" UUID NOT NULL,

    CONSTRAINT "ai_garment_value_engineering_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_garment_value_engineering_analyses" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "overall_summary" TEXT NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_garment_value_engineering_analyses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_garment_value_engineering_suggestions" (
    "id" UUID NOT NULL,
    "analysis_id" UUID NOT NULL,
    "material_description" TEXT NOT NULL,
    "suggested_change" TEXT NOT NULL,
    "cost_impact_direction" "AiGarmentCostImpactDirection" NOT NULL,
    "quality_risk_notes" TEXT NOT NULL,
    "reasoning" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_garment_value_engineering_suggestions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_garment_value_engineering_runs_project_id_status_idx" ON "ai_garment_value_engineering_runs"("project_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ai_garment_value_engineering_analyses_run_id_key" ON "ai_garment_value_engineering_analyses"("run_id");

-- CreateIndex
CREATE INDEX "ai_garment_value_engineering_analyses_project_id_idx" ON "ai_garment_value_engineering_analyses"("project_id");

-- AddForeignKey
ALTER TABLE "ai_garment_value_engineering_runs" ADD CONSTRAINT "ai_garment_value_engineering_runs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_value_engineering_runs" ADD CONSTRAINT "ai_garment_value_engineering_runs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "ai_garment_projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_value_engineering_runs" ADD CONSTRAINT "ai_garment_value_engineering_runs_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_value_engineering_analyses" ADD CONSTRAINT "ai_garment_value_engineering_analyses_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_value_engineering_analyses" ADD CONSTRAINT "ai_garment_value_engineering_analyses_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "ai_garment_projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_value_engineering_analyses" ADD CONSTRAINT "ai_garment_value_engineering_analyses_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "ai_garment_value_engineering_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_value_engineering_analyses" ADD CONSTRAINT "ai_garment_value_engineering_analyses_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_value_engineering_suggestions" ADD CONSTRAINT "ai_garment_value_engineering_suggestions_analysis_id_fkey" FOREIGN KEY ("analysis_id") REFERENCES "ai_garment_value_engineering_analyses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
