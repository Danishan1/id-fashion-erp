-- CreateEnum
CREATE TYPE "AiDesignerFabricSource" AS ENUM ('EXISTING', 'UPLOADED');

-- CreateEnum
CREATE TYPE "AiDesignerTargetCustomer" AS ENUM ('MEN', 'WOMEN', 'BOYS', 'GIRLS', 'BABY', 'UNISEX');

-- CreateEnum
CREATE TYPE "AiDesignerProjectStatus" AS ENUM ('DRAFT', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AiDesignerPromptType" AS ENUM ('FABRIC_ANALYSIS', 'IMAGE_GENERATE', 'IMAGE_EDIT');

-- CreateEnum
CREATE TYPE "AiDesignerRunStatus" AS ENUM ('IN_PROGRESS', 'SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "AiDesignerImageDecision" AS ENUM ('PENDING', 'SELECTED', 'REJECTED');

-- AlterEnum (additive only)
ALTER TYPE "DocumentType" ADD VALUE 'AI_DESIGNER_PROJECT';

-- AlterEnum (additive only)
ALTER TYPE "RelatedModule" ADD VALUE 'AI_DESIGNER_PROJECT';

-- CreateTable
CREATE TABLE "ai_projects" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "project_number" TEXT NOT NULL,
    "project_name" TEXT NOT NULL,
    "status" "AiDesignerProjectStatus" NOT NULL DEFAULT 'DRAFT',
    "current_step" TEXT NOT NULL DEFAULT 'FABRIC_SELECTION',
    "completed_steps" TEXT[],
    "fabric_source" "AiDesignerFabricSource",
    "fabric_product_id" UUID,
    "fabric_image_attachment_id" TEXT,
    "fabric_name" TEXT,
    "fabric_code" TEXT,
    "fabric_composition" TEXT,
    "fabric_gsm" TEXT,
    "fabric_width" TEXT,
    "fabric_weave" TEXT,
    "fabric_stretch" TEXT,
    "fabric_opacity" TEXT,
    "fabric_texture" TEXT,
    "fabric_pattern_type" TEXT,
    "fabric_print_type" TEXT,
    "fabric_suitable_season" TEXT,
    "fabric_recommended_garments" TEXT,
    "fabric_color" TEXT,
    "fabric_supplier_id" UUID,
    "target_customer" "AiDesignerTargetCustomer",
    "age_group" TEXT,
    "product_category" TEXT,
    "design_selections_json" JSONB,
    "model_gender" TEXT,
    "model_body_type" TEXT,
    "model_pose" TEXT,
    "environment_key" TEXT,
    "environment_label" TEXT,
    "is_custom_environment" BOOLEAN NOT NULL DEFAULT false,
    "current_version_id" UUID,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_prompts" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "prompt_type" "AiDesignerPromptType" NOT NULL,
    "prompt_version" TEXT NOT NULL,
    "spec_json" JSONB NOT NULL,
    "prompt_text" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "status" "AiDesignerRunStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "error_category" TEXT,
    "error_message" TEXT,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "created_by_user_id" UUID NOT NULL,

    CONSTRAINT "ai_prompts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_generations" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "prompt_id" UUID NOT NULL,
    "parent_image_id" UUID,
    "edited_feature" TEXT,
    "requested_image_count" INTEGER NOT NULL DEFAULT 1,
    "status" "AiDesignerRunStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_generations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_images" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "generation_id" UUID NOT NULL,
    "image_attachment_id" TEXT NOT NULL,
    "decision" "AiDesignerImageDecision" NOT NULL DEFAULT 'PENDING',
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_versions" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL,
    "current_image_id" UUID NOT NULL,
    "change_summary" TEXT,
    "design_snapshot_json" JSONB NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_projects_current_version_id_key" ON "ai_projects"("current_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_projects_company_id_project_number_key" ON "ai_projects"("company_id", "project_number");

-- CreateIndex
CREATE UNIQUE INDEX "ai_generations_prompt_id_key" ON "ai_generations"("prompt_id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_versions_project_id_version_number_key" ON "ai_versions"("project_id", "version_number");

-- AddForeignKey
ALTER TABLE "ai_projects" ADD CONSTRAINT "ai_projects_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_projects" ADD CONSTRAINT "ai_projects_fabric_product_id_fkey" FOREIGN KEY ("fabric_product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_projects" ADD CONSTRAINT "ai_projects_fabric_supplier_id_fkey" FOREIGN KEY ("fabric_supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_projects" ADD CONSTRAINT "ai_projects_current_version_id_fkey" FOREIGN KEY ("current_version_id") REFERENCES "ai_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_projects" ADD CONSTRAINT "ai_projects_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_prompts" ADD CONSTRAINT "ai_prompts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_prompts" ADD CONSTRAINT "ai_prompts_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "ai_projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_prompts" ADD CONSTRAINT "ai_prompts_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_generations" ADD CONSTRAINT "ai_generations_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_generations" ADD CONSTRAINT "ai_generations_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "ai_projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_generations" ADD CONSTRAINT "ai_generations_prompt_id_fkey" FOREIGN KEY ("prompt_id") REFERENCES "ai_prompts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_generations" ADD CONSTRAINT "ai_generations_parent_image_id_fkey" FOREIGN KEY ("parent_image_id") REFERENCES "ai_images"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_generations" ADD CONSTRAINT "ai_generations_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_images" ADD CONSTRAINT "ai_images_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_images" ADD CONSTRAINT "ai_images_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "ai_projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_images" ADD CONSTRAINT "ai_images_generation_id_fkey" FOREIGN KEY ("generation_id") REFERENCES "ai_generations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_images" ADD CONSTRAINT "ai_images_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_versions" ADD CONSTRAINT "ai_versions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_versions" ADD CONSTRAINT "ai_versions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "ai_projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_versions" ADD CONSTRAINT "ai_versions_current_image_id_fkey" FOREIGN KEY ("current_image_id") REFERENCES "ai_images"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_versions" ADD CONSTRAINT "ai_versions_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
