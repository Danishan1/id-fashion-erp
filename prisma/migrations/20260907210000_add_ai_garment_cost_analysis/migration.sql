
-- AlterTable
ALTER TABLE "ai_garment_projects" ADD COLUMN     "costing_completed_at" TIMESTAMP(3),
ADD COLUMN     "costing_completed_by_user_id" UUID;

-- CreateTable
CREATE TABLE "ai_garment_cost_analysis_runs" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
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

    CONSTRAINT "ai_garment_cost_analysis_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_garment_cost_analyses" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "estimated_cost_per_unit_low" DECIMAL(18,2) NOT NULL,
    "estimated_cost_per_unit_high" DECIMAL(18,2) NOT NULL,
    "cost_breakdown_commentary" TEXT NOT NULL,
    "price_positioning_commentary" TEXT NOT NULL,
    "margin_feasibility_commentary" TEXT NOT NULL,
    "risk_notes" TEXT NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_garment_cost_analyses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_garment_cost_analysis_runs_project_id_status_idx" ON "ai_garment_cost_analysis_runs"("project_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ai_garment_cost_analyses_run_id_key" ON "ai_garment_cost_analyses"("run_id");

-- CreateIndex
CREATE INDEX "ai_garment_cost_analyses_project_id_idx" ON "ai_garment_cost_analyses"("project_id");

-- AddForeignKey
ALTER TABLE "ai_garment_projects" ADD CONSTRAINT "ai_garment_projects_costing_completed_by_user_id_fkey" FOREIGN KEY ("costing_completed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_cost_analysis_runs" ADD CONSTRAINT "ai_garment_cost_analysis_runs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_cost_analysis_runs" ADD CONSTRAINT "ai_garment_cost_analysis_runs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "ai_garment_projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_cost_analysis_runs" ADD CONSTRAINT "ai_garment_cost_analysis_runs_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_cost_analyses" ADD CONSTRAINT "ai_garment_cost_analyses_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_cost_analyses" ADD CONSTRAINT "ai_garment_cost_analyses_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "ai_garment_projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_cost_analyses" ADD CONSTRAINT "ai_garment_cost_analyses_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "ai_garment_cost_analysis_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_cost_analyses" ADD CONSTRAINT "ai_garment_cost_analyses_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

