-- CreateEnum
CREATE TYPE "AiGarmentTechnicalFlatDecision" AS ENUM ('PENDING', 'APPROVED');

-- AlterTable
ALTER TABLE "ai_garment_projects" ADD COLUMN     "approved_technical_flat_at" TIMESTAMP(3),
ADD COLUMN     "approved_technical_flat_by_user_id" UUID,
ADD COLUMN     "approved_technical_flat_id" UUID;

-- CreateTable
CREATE TABLE "ai_garment_technical_flat_runs" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "design_direction_id" UUID NOT NULL,
    "base_image_attachment_id" UUID NOT NULL,
    "additional_notes" TEXT,
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

    CONSTRAINT "ai_garment_technical_flat_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_garment_technical_flats" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "design_direction_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "base_image_attachment_id" UUID NOT NULL,
    "result_image_attachment_id" UUID NOT NULL,
    "additional_notes" TEXT,
    "decision" "AiGarmentTechnicalFlatDecision" NOT NULL DEFAULT 'PENDING',
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_garment_technical_flats_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_garment_technical_flat_runs_design_direction_id_status_idx" ON "ai_garment_technical_flat_runs"("design_direction_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ai_garment_technical_flats_run_id_key" ON "ai_garment_technical_flats"("run_id");

-- CreateIndex
CREATE INDEX "ai_garment_technical_flats_design_direction_id_decision_idx" ON "ai_garment_technical_flats"("design_direction_id", "decision");

-- AddForeignKey
ALTER TABLE "ai_garment_projects" ADD CONSTRAINT "ai_garment_projects_approved_technical_flat_id_fkey" FOREIGN KEY ("approved_technical_flat_id") REFERENCES "ai_garment_technical_flats"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_projects" ADD CONSTRAINT "ai_garment_projects_approved_technical_flat_by_user_id_fkey" FOREIGN KEY ("approved_technical_flat_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_technical_flat_runs" ADD CONSTRAINT "ai_garment_technical_flat_runs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_technical_flat_runs" ADD CONSTRAINT "ai_garment_technical_flat_runs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "ai_garment_projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_technical_flat_runs" ADD CONSTRAINT "ai_garment_technical_flat_runs_design_direction_id_fkey" FOREIGN KEY ("design_direction_id") REFERENCES "ai_garment_design_directions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_technical_flat_runs" ADD CONSTRAINT "ai_garment_technical_flat_runs_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_technical_flats" ADD CONSTRAINT "ai_garment_technical_flats_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_technical_flats" ADD CONSTRAINT "ai_garment_technical_flats_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "ai_garment_projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_technical_flats" ADD CONSTRAINT "ai_garment_technical_flats_design_direction_id_fkey" FOREIGN KEY ("design_direction_id") REFERENCES "ai_garment_design_directions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_technical_flats" ADD CONSTRAINT "ai_garment_technical_flats_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "ai_garment_technical_flat_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_technical_flats" ADD CONSTRAINT "ai_garment_technical_flats_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

