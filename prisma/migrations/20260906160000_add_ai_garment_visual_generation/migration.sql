-- CreateEnum
CREATE TYPE "AiGarmentGeneratedImageDecision" AS ENUM ('PENDING', 'SELECTED', 'REJECTED');

-- CreateTable
CREATE TABLE "ai_garment_image_generation_runs" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "design_direction_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "prompt_version" TEXT NOT NULL,
    "prompt_text" TEXT NOT NULL,
    "requested_image_count" INTEGER NOT NULL,
    "parent_generated_image_id" UUID,
    "status" "AiGarmentAnalysisRunStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "error_category" TEXT,
    "error_message" TEXT,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "created_by_user_id" UUID NOT NULL,

    CONSTRAINT "ai_garment_image_generation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_garment_generated_images" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "design_direction_id" UUID NOT NULL,
    "generation_run_id" UUID NOT NULL,
    "prompt_version" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "image_attachment_id" UUID NOT NULL,
    "decision" "AiGarmentGeneratedImageDecision" NOT NULL DEFAULT 'PENDING',
    "user_notes" TEXT,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_garment_generated_images_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_garment_image_generation_runs_project_id_design_directio_idx" ON "ai_garment_image_generation_runs"("project_id", "design_direction_id", "status");

-- CreateIndex
CREATE INDEX "ai_garment_generated_images_project_id_design_direction_id_idx" ON "ai_garment_generated_images"("project_id", "design_direction_id");

-- CreateIndex
CREATE INDEX "ai_garment_generated_images_design_direction_id_decision_idx" ON "ai_garment_generated_images"("design_direction_id", "decision");

-- AddForeignKey
ALTER TABLE "ai_garment_image_generation_runs" ADD CONSTRAINT "ai_garment_image_generation_runs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_image_generation_runs" ADD CONSTRAINT "ai_garment_image_generation_runs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "ai_garment_projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_image_generation_runs" ADD CONSTRAINT "ai_garment_image_generation_runs_design_direction_id_fkey" FOREIGN KEY ("design_direction_id") REFERENCES "ai_garment_design_directions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_image_generation_runs" ADD CONSTRAINT "ai_garment_image_generation_runs_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_generated_images" ADD CONSTRAINT "ai_garment_generated_images_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_generated_images" ADD CONSTRAINT "ai_garment_generated_images_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "ai_garment_projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_generated_images" ADD CONSTRAINT "ai_garment_generated_images_design_direction_id_fkey" FOREIGN KEY ("design_direction_id") REFERENCES "ai_garment_design_directions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_generated_images" ADD CONSTRAINT "ai_garment_generated_images_generation_run_id_fkey" FOREIGN KEY ("generation_run_id") REFERENCES "ai_garment_image_generation_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_generated_images" ADD CONSTRAINT "ai_garment_generated_images_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

