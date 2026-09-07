-- CreateEnum
CREATE TYPE "AiGarmentDesignFeature" AS ENUM ('NECKLINE', 'COLLAR', 'SLEEVE', 'SLEEVE_LENGTH', 'CUFF', 'GARMENT_LENGTH', 'FIT', 'SILHOUETTE', 'POCKET', 'CLOSURE', 'WAIST', 'HEM', 'OTHER');

-- CreateEnum
CREATE TYPE "AiGarmentDesignVariationDecision" AS ENUM ('PENDING', 'SELECTED', 'KEPT_ORIGINAL');

-- CreateTable
CREATE TABLE "ai_garment_design_variation_runs" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "design_direction_id" UUID NOT NULL,
    "parent_generated_image_id" UUID NOT NULL,
    "feature_key" "AiGarmentDesignFeature" NOT NULL,
    "current_feature_value" TEXT NOT NULL,
    "new_requirement" TEXT NOT NULL,
    "additional_instructions" TEXT,
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

    CONSTRAINT "ai_garment_design_variation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_garment_design_variations" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "design_direction_id" UUID NOT NULL,
    "parent_generated_image_id" UUID NOT NULL,
    "variation_run_id" UUID NOT NULL,
    "variation_number" INTEGER NOT NULL,
    "feature_key" "AiGarmentDesignFeature" NOT NULL,
    "previous_value" TEXT NOT NULL,
    "new_value" TEXT NOT NULL,
    "additional_instructions" TEXT,
    "prompt_version" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "image_attachment_id" UUID NOT NULL,
    "decision" "AiGarmentDesignVariationDecision" NOT NULL DEFAULT 'PENDING',
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_garment_design_variations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_garment_design_variation_runs_parent_generated_image_id__idx" ON "ai_garment_design_variation_runs"("parent_generated_image_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ai_garment_design_variations_variation_run_id_key" ON "ai_garment_design_variations"("variation_run_id");

-- CreateIndex
CREATE INDEX "ai_garment_design_variations_parent_generated_image_id_deci_idx" ON "ai_garment_design_variations"("parent_generated_image_id", "decision");

-- CreateIndex
CREATE UNIQUE INDEX "ai_garment_design_variations_parent_generated_image_id_vari_key" ON "ai_garment_design_variations"("parent_generated_image_id", "variation_number");

-- AddForeignKey
ALTER TABLE "ai_garment_design_variation_runs" ADD CONSTRAINT "ai_garment_design_variation_runs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_design_variation_runs" ADD CONSTRAINT "ai_garment_design_variation_runs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "ai_garment_projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_design_variation_runs" ADD CONSTRAINT "ai_garment_design_variation_runs_design_direction_id_fkey" FOREIGN KEY ("design_direction_id") REFERENCES "ai_garment_design_directions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_design_variation_runs" ADD CONSTRAINT "ai_garment_design_variation_runs_parent_generated_image_id_fkey" FOREIGN KEY ("parent_generated_image_id") REFERENCES "ai_garment_generated_images"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_design_variation_runs" ADD CONSTRAINT "ai_garment_design_variation_runs_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_design_variations" ADD CONSTRAINT "ai_garment_design_variations_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_design_variations" ADD CONSTRAINT "ai_garment_design_variations_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "ai_garment_projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_design_variations" ADD CONSTRAINT "ai_garment_design_variations_design_direction_id_fkey" FOREIGN KEY ("design_direction_id") REFERENCES "ai_garment_design_directions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_design_variations" ADD CONSTRAINT "ai_garment_design_variations_parent_generated_image_id_fkey" FOREIGN KEY ("parent_generated_image_id") REFERENCES "ai_garment_generated_images"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_design_variations" ADD CONSTRAINT "ai_garment_design_variations_variation_run_id_fkey" FOREIGN KEY ("variation_run_id") REFERENCES "ai_garment_design_variation_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_design_variations" ADD CONSTRAINT "ai_garment_design_variations_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

