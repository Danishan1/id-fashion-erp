
-- DropForeignKey
ALTER TABLE "ai_garment_design_directions" DROP CONSTRAINT "ai_garment_design_directions_development_brief_run_id_fkey";

-- AlterTable
ALTER TABLE "ai_garment_design_directions" ADD COLUMN     "fabric_development_run_id" UUID,
ALTER COLUMN "development_brief_run_id" DROP NOT NULL;

-- CreateTable
CREATE TABLE "ai_garment_fabric_development_runs" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "fabric_analysis_id" UUID NOT NULL,
    "product_suitability_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "prompt_version" TEXT NOT NULL,
    "requested_direction_count" INTEGER NOT NULL,
    "design_balance" "AiGarmentDesignBalance" NOT NULL,
    "context_snapshot_json" JSONB NOT NULL,
    "status" "AiGarmentAnalysisRunStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "error_category" TEXT,
    "error_message" TEXT,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "created_by_user_id" UUID NOT NULL,

    CONSTRAINT "ai_garment_fabric_development_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_garment_fabric_development_runs_project_id_status_idx" ON "ai_garment_fabric_development_runs"("project_id", "status");

-- AddForeignKey
ALTER TABLE "ai_garment_design_directions" ADD CONSTRAINT "ai_garment_design_directions_development_brief_run_id_fkey" FOREIGN KEY ("development_brief_run_id") REFERENCES "ai_garment_development_brief_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_design_directions" ADD CONSTRAINT "ai_garment_design_directions_fabric_development_run_id_fkey" FOREIGN KEY ("fabric_development_run_id") REFERENCES "ai_garment_fabric_development_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_fabric_development_runs" ADD CONSTRAINT "ai_garment_fabric_development_runs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_fabric_development_runs" ADD CONSTRAINT "ai_garment_fabric_development_runs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "ai_garment_projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_fabric_development_runs" ADD CONSTRAINT "ai_garment_fabric_development_runs_fabric_analysis_id_fkey" FOREIGN KEY ("fabric_analysis_id") REFERENCES "ai_garment_fabric_analyses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_fabric_development_runs" ADD CONSTRAINT "ai_garment_fabric_development_runs_product_suitability_id_fkey" FOREIGN KEY ("product_suitability_id") REFERENCES "ai_garment_product_suitabilities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_fabric_development_runs" ADD CONSTRAINT "ai_garment_fabric_development_runs_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- CheckConstraint: exactly one of developmentBriefRunId/fabricDevelopmentRunId
-- is ever set -- same two-nullable-FK XOR shape already proven by
-- payment_allocations_exactly_one_invoice_check /
-- purchase_invoice_items_exactly_one_source_check.
ALTER TABLE "ai_garment_design_directions" ADD CONSTRAINT "ai_garment_design_directions_exactly_one_source_check"
  CHECK (("development_brief_run_id" IS NOT NULL) != ("fabric_development_run_id" IS NOT NULL));
