-- CreateEnum
CREATE TYPE "AiGarmentBomSuggestionDecision" AS ENUM ('PENDING', 'ADDED', 'DISMISSED');

-- CreateTable
CREATE TABLE "ai_garment_bom_suggestion_runs" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "design_direction_id" UUID NOT NULL,
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

    CONSTRAINT "ai_garment_bom_suggestion_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_garment_bom_suggestions" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "design_direction_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "material_description" TEXT NOT NULL,
    "material_category" "MaterialCategory" NOT NULL,
    "suggested_quantity_per_unit" DECIMAL(18,4) NOT NULL,
    "suggested_uom" TEXT NOT NULL,
    "suggested_wastage_percentage" DECIMAL(5,2) NOT NULL,
    "color_note" TEXT,
    "reasoning" TEXT NOT NULL,
    "decision" "AiGarmentBomSuggestionDecision" NOT NULL DEFAULT 'PENDING',
    "resolved_bom_item_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_garment_bom_suggestions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_garment_bom_suggestion_runs_design_direction_id_status_idx" ON "ai_garment_bom_suggestion_runs"("design_direction_id", "status");

-- CreateIndex
CREATE INDEX "ai_garment_bom_suggestions_design_direction_id_decision_idx" ON "ai_garment_bom_suggestions"("design_direction_id", "decision");

-- AddForeignKey
ALTER TABLE "ai_garment_bom_suggestion_runs" ADD CONSTRAINT "ai_garment_bom_suggestion_runs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_bom_suggestion_runs" ADD CONSTRAINT "ai_garment_bom_suggestion_runs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "ai_garment_projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_bom_suggestion_runs" ADD CONSTRAINT "ai_garment_bom_suggestion_runs_design_direction_id_fkey" FOREIGN KEY ("design_direction_id") REFERENCES "ai_garment_design_directions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_bom_suggestion_runs" ADD CONSTRAINT "ai_garment_bom_suggestion_runs_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_bom_suggestions" ADD CONSTRAINT "ai_garment_bom_suggestions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_bom_suggestions" ADD CONSTRAINT "ai_garment_bom_suggestions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "ai_garment_projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_bom_suggestions" ADD CONSTRAINT "ai_garment_bom_suggestions_design_direction_id_fkey" FOREIGN KEY ("design_direction_id") REFERENCES "ai_garment_design_directions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_bom_suggestions" ADD CONSTRAINT "ai_garment_bom_suggestions_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "ai_garment_bom_suggestion_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

