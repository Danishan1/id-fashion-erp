
-- CreateEnum
CREATE TYPE "ReplicateDesignProjectStatus" AS ENUM ('DRAFT', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReplicateDesignFabricSource" AS ENUM ('EXISTING', 'UPLOADED');

-- CreateEnum
CREATE TYPE "ReplicateDesignDnaStatus" AS ENUM ('DRAFT', 'AI_ANALYSED', 'UNDER_REVIEW', 'APPROVED', 'STALE');

-- CreateEnum
CREATE TYPE "ReplicateAnalysisConfidence" AS ENUM ('CONFIRMED_VISUALLY', 'LIKELY_INFERRED', 'NOT_DETERMINABLE');

-- CreateEnum
CREATE TYPE "ReplicateRunStatus" AS ENUM ('IN_PROGRESS', 'SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "ReplicateMaterialRole" AS ENUM ('MAIN_FABRIC', 'CONTRAST_FABRIC', 'LINING', 'INTERLINING', 'BUTTON', 'ZIPPER', 'THREAD', 'LABEL', 'TRIM_OTHER', 'OTHER');

-- CreateEnum
CREATE TYPE "ReplicateCompatibilityRating" AS ENUM ('COMPATIBLE', 'MINOR_CONCERN', 'INCOMPATIBLE');

-- CreateEnum
CREATE TYPE "ReplicateCompatibilitySubject" AS ENUM ('FABRIC', 'MATERIAL_LINE');

-- CreateEnum
CREATE TYPE "ReplicateImageDecision" AS ENUM ('PENDING', 'SELECTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ReplicatePromptType" AS ENUM ('DNA_ANALYSIS', 'COMPATIBILITY_CHECK', 'IMAGE_GENERATE');

-- AlterEnum
ALTER TYPE "AIProviderCapability" ADD VALUE 'DESIGN_REPLICATION';

-- AlterEnum
ALTER TYPE "DocumentType" ADD VALUE 'REPLICATE_DESIGN_PROJECT';

-- AlterEnum
ALTER TYPE "RelatedModule" ADD VALUE 'REPLICATE_DESIGN_PROJECT';

-- CreateTable
CREATE TABLE "replicate_design_projects" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "project_number" TEXT NOT NULL,
    "project_name" TEXT NOT NULL,
    "status" "ReplicateDesignProjectStatus" NOT NULL DEFAULT 'DRAFT',
    "current_step" TEXT NOT NULL DEFAULT 'REFERENCE_UPLOAD',
    "completed_steps" TEXT[],
    "reference_front_image_attachment_id" TEXT,
    "reference_back_image_attachment_id" TEXT,
    "reference_side_image_attachment_id" TEXT,
    "reference_detail_image_attachment_id" TEXT,
    "fabric_source" "ReplicateDesignFabricSource",
    "fabric_product_id" UUID,
    "fabric_image_attachment_id" TEXT,
    "fabric_name" TEXT,
    "fabric_code" TEXT,
    "fabric_supplier_id" UUID,
    "current_version_id" UUID,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "replicate_design_projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "replicate_design_dna_analyses" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "reference_attachment_id" TEXT NOT NULL,
    "status" "ReplicateDesignDnaStatus" NOT NULL DEFAULT 'DRAFT',
    "prompt_version" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "raw_response_json" JSONB NOT NULL,
    "design_dna_summary" TEXT,
    "approved_by_user_id" UUID,
    "approved_at" TIMESTAMP(3),
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "replicate_design_dna_analyses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "replicate_design_dna_observations" (
    "id" UUID NOT NULL,
    "analysis_id" UUID NOT NULL,
    "feature_key" TEXT NOT NULL,
    "ai_observation" TEXT NOT NULL,
    "ai_confidence" "ReplicateAnalysisConfidence" NOT NULL,
    "approved_observation" TEXT NOT NULL,
    "user_edited" BOOLEAN NOT NULL DEFAULT false,
    "is_locked" BOOLEAN NOT NULL DEFAULT true,
    "approved_by_user_id" UUID,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "replicate_design_dna_observations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "replicate_design_dna_analysis_runs" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "analysis_id" UUID,
    "reference_attachment_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "prompt_version" TEXT NOT NULL,
    "status" "ReplicateRunStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "error_category" TEXT,
    "error_message" TEXT,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "created_by_user_id" UUID NOT NULL,

    CONSTRAINT "replicate_design_dna_analysis_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "replicate_design_material_lines" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "role" "ReplicateMaterialRole" NOT NULL DEFAULT 'OTHER',
    "quantity" DECIMAL(18,4),
    "uom_id" UUID,
    "notes" TEXT,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "replicate_design_material_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "replicate_design_compatibility_checks" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "prompt_version" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "raw_response_json" JSONB NOT NULL,
    "overall_summary" TEXT,
    "overall_rating" "ReplicateCompatibilityRating",
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "replicate_design_compatibility_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "replicate_design_compatibility_items" (
    "id" UUID NOT NULL,
    "check_id" UUID NOT NULL,
    "subject_type" "ReplicateCompatibilitySubject" NOT NULL,
    "material_line_id" UUID,
    "ai_rating" "ReplicateCompatibilityRating" NOT NULL,
    "ai_reasoning" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "replicate_design_compatibility_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "replicate_design_compatibility_runs" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "check_id" UUID,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "prompt_version" TEXT NOT NULL,
    "status" "ReplicateRunStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "error_category" TEXT,
    "error_message" TEXT,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "created_by_user_id" UUID NOT NULL,

    CONSTRAINT "replicate_design_compatibility_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "replicate_design_prompts" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "prompt_type" "ReplicatePromptType" NOT NULL,
    "prompt_version" TEXT NOT NULL,
    "spec_json" JSONB NOT NULL,
    "prompt_text" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "status" "ReplicateRunStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "error_category" TEXT,
    "error_message" TEXT,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "created_by_user_id" UUID NOT NULL,

    CONSTRAINT "replicate_design_prompts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "replicate_design_generations" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "prompt_id" UUID NOT NULL,
    "requested_image_count" INTEGER NOT NULL DEFAULT 1,
    "status" "ReplicateRunStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "replicate_design_generations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "replicate_design_images" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "generation_id" UUID NOT NULL,
    "image_attachment_id" TEXT NOT NULL,
    "decision" "ReplicateImageDecision" NOT NULL DEFAULT 'PENDING',
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "replicate_design_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "replicate_design_versions" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL,
    "current_image_id" UUID NOT NULL,
    "change_summary" TEXT,
    "design_snapshot_json" JSONB NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "replicate_design_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "replicate_design_projects_current_version_id_key" ON "replicate_design_projects"("current_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "replicate_design_projects_company_id_project_number_key" ON "replicate_design_projects"("company_id", "project_number");

-- CreateIndex
CREATE UNIQUE INDEX "replicate_design_dna_analyses_project_id_key" ON "replicate_design_dna_analyses"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "replicate_design_dna_observations_analysis_id_feature_key_key" ON "replicate_design_dna_observations"("analysis_id", "feature_key");

-- CreateIndex
CREATE INDEX "replicate_design_dna_analysis_runs_project_id_status_idx" ON "replicate_design_dna_analysis_runs"("project_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "replicate_design_compatibility_checks_project_id_key" ON "replicate_design_compatibility_checks"("project_id");

-- CreateIndex
CREATE INDEX "replicate_design_compatibility_runs_project_id_status_idx" ON "replicate_design_compatibility_runs"("project_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "replicate_design_generations_prompt_id_key" ON "replicate_design_generations"("prompt_id");

-- CreateIndex
CREATE UNIQUE INDEX "replicate_design_versions_project_id_version_number_key" ON "replicate_design_versions"("project_id", "version_number");

-- AddForeignKey
ALTER TABLE "replicate_design_projects" ADD CONSTRAINT "replicate_design_projects_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "replicate_design_projects" ADD CONSTRAINT "replicate_design_projects_fabric_product_id_fkey" FOREIGN KEY ("fabric_product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "replicate_design_projects" ADD CONSTRAINT "replicate_design_projects_fabric_supplier_id_fkey" FOREIGN KEY ("fabric_supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "replicate_design_projects" ADD CONSTRAINT "replicate_design_projects_current_version_id_fkey" FOREIGN KEY ("current_version_id") REFERENCES "replicate_design_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "replicate_design_projects" ADD CONSTRAINT "replicate_design_projects_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "replicate_design_dna_analyses" ADD CONSTRAINT "replicate_design_dna_analyses_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "replicate_design_dna_analyses" ADD CONSTRAINT "replicate_design_dna_analyses_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "replicate_design_projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "replicate_design_dna_analyses" ADD CONSTRAINT "replicate_design_dna_analyses_approved_by_user_id_fkey" FOREIGN KEY ("approved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "replicate_design_dna_analyses" ADD CONSTRAINT "replicate_design_dna_analyses_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "replicate_design_dna_observations" ADD CONSTRAINT "replicate_design_dna_observations_analysis_id_fkey" FOREIGN KEY ("analysis_id") REFERENCES "replicate_design_dna_analyses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "replicate_design_dna_observations" ADD CONSTRAINT "replicate_design_dna_observations_approved_by_user_id_fkey" FOREIGN KEY ("approved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "replicate_design_dna_analysis_runs" ADD CONSTRAINT "replicate_design_dna_analysis_runs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "replicate_design_dna_analysis_runs" ADD CONSTRAINT "replicate_design_dna_analysis_runs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "replicate_design_projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "replicate_design_dna_analysis_runs" ADD CONSTRAINT "replicate_design_dna_analysis_runs_analysis_id_fkey" FOREIGN KEY ("analysis_id") REFERENCES "replicate_design_dna_analyses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "replicate_design_dna_analysis_runs" ADD CONSTRAINT "replicate_design_dna_analysis_runs_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "replicate_design_material_lines" ADD CONSTRAINT "replicate_design_material_lines_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "replicate_design_material_lines" ADD CONSTRAINT "replicate_design_material_lines_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "replicate_design_projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "replicate_design_material_lines" ADD CONSTRAINT "replicate_design_material_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "replicate_design_material_lines" ADD CONSTRAINT "replicate_design_material_lines_uom_id_fkey" FOREIGN KEY ("uom_id") REFERENCES "units_of_measure"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "replicate_design_material_lines" ADD CONSTRAINT "replicate_design_material_lines_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "replicate_design_compatibility_checks" ADD CONSTRAINT "replicate_design_compatibility_checks_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "replicate_design_compatibility_checks" ADD CONSTRAINT "replicate_design_compatibility_checks_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "replicate_design_projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "replicate_design_compatibility_checks" ADD CONSTRAINT "replicate_design_compatibility_checks_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "replicate_design_compatibility_items" ADD CONSTRAINT "replicate_design_compatibility_items_check_id_fkey" FOREIGN KEY ("check_id") REFERENCES "replicate_design_compatibility_checks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "replicate_design_compatibility_items" ADD CONSTRAINT "replicate_design_compatibility_items_material_line_id_fkey" FOREIGN KEY ("material_line_id") REFERENCES "replicate_design_material_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "replicate_design_compatibility_runs" ADD CONSTRAINT "replicate_design_compatibility_runs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "replicate_design_compatibility_runs" ADD CONSTRAINT "replicate_design_compatibility_runs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "replicate_design_projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "replicate_design_compatibility_runs" ADD CONSTRAINT "replicate_design_compatibility_runs_check_id_fkey" FOREIGN KEY ("check_id") REFERENCES "replicate_design_compatibility_checks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "replicate_design_compatibility_runs" ADD CONSTRAINT "replicate_design_compatibility_runs_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "replicate_design_prompts" ADD CONSTRAINT "replicate_design_prompts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "replicate_design_prompts" ADD CONSTRAINT "replicate_design_prompts_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "replicate_design_projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "replicate_design_prompts" ADD CONSTRAINT "replicate_design_prompts_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "replicate_design_generations" ADD CONSTRAINT "replicate_design_generations_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "replicate_design_generations" ADD CONSTRAINT "replicate_design_generations_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "replicate_design_projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "replicate_design_generations" ADD CONSTRAINT "replicate_design_generations_prompt_id_fkey" FOREIGN KEY ("prompt_id") REFERENCES "replicate_design_prompts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "replicate_design_generations" ADD CONSTRAINT "replicate_design_generations_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "replicate_design_images" ADD CONSTRAINT "replicate_design_images_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "replicate_design_images" ADD CONSTRAINT "replicate_design_images_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "replicate_design_projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "replicate_design_images" ADD CONSTRAINT "replicate_design_images_generation_id_fkey" FOREIGN KEY ("generation_id") REFERENCES "replicate_design_generations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "replicate_design_images" ADD CONSTRAINT "replicate_design_images_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "replicate_design_versions" ADD CONSTRAINT "replicate_design_versions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "replicate_design_versions" ADD CONSTRAINT "replicate_design_versions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "replicate_design_projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "replicate_design_versions" ADD CONSTRAINT "replicate_design_versions_current_image_id_fkey" FOREIGN KEY ("current_image_id") REFERENCES "replicate_design_images"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "replicate_design_versions" ADD CONSTRAINT "replicate_design_versions_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

