-- CreateEnum
CREATE TYPE "AiGarmentAnalysisConfidence" AS ENUM ('CONFIRMED_VISUALLY', 'LIKELY_INFERRED', 'NOT_DETERMINABLE');

-- CreateEnum
CREATE TYPE "AiGarmentConstructionComplexity" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "AiGarmentReferenceAnalysisStatus" AS ENUM ('DRAFT', 'AI_ANALYSED', 'UNDER_REVIEW', 'APPROVED', 'STALE');

-- CreateEnum
CREATE TYPE "AiGarmentAnalysisRunStatus" AS ENUM ('IN_PROGRESS', 'SUCCESS', 'FAILED');

-- AlterTable
ALTER TABLE "ai_garment_projects" ADD COLUMN     "reference_image_attachment_id" UUID;

-- CreateTable
CREATE TABLE "ai_garment_reference_analyses" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "reference_attachment_id" UUID NOT NULL,
    "status" "AiGarmentReferenceAnalysisStatus" NOT NULL DEFAULT 'DRAFT',
    "analysis_version" INTEGER NOT NULL DEFAULT 0,
    "prompt_version" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "raw_response_json" JSONB NOT NULL,
    "construction_complexity_level" "AiGarmentConstructionComplexity",
    "construction_complexity_explanation" TEXT,
    "manufacturing_challenges" TEXT[],
    "key_design_language_features" TEXT[],
    "features_for_further_development" TEXT[],
    "features_to_change_for_differentiation" TEXT[],
    "missing_information" TEXT[],
    "design_dna_summary" TEXT,
    "approved_by_user_id" UUID,
    "approved_at" TIMESTAMP(3),
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_garment_reference_analyses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_garment_reference_observations" (
    "id" UUID NOT NULL,
    "analysis_id" UUID NOT NULL,
    "feature_key" TEXT NOT NULL,
    "ai_observation" TEXT NOT NULL,
    "ai_confidence" "AiGarmentAnalysisConfidence" NOT NULL,
    "ai_manufacturing_relevance" TEXT NOT NULL,
    "approved_observation" TEXT NOT NULL,
    "user_edited" BOOLEAN NOT NULL DEFAULT false,
    "approved_by_user_id" UUID,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_garment_reference_observations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_garment_reference_analysis_runs" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "analysis_id" UUID,
    "reference_attachment_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "prompt_version" TEXT NOT NULL,
    "analysis_version" INTEGER NOT NULL,
    "status" "AiGarmentAnalysisRunStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "error_category" TEXT,
    "error_message" TEXT,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "created_by_user_id" UUID NOT NULL,

    CONSTRAINT "ai_garment_reference_analysis_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_garment_reference_analyses_project_id_key" ON "ai_garment_reference_analyses"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_garment_reference_observations_analysis_id_feature_key_key" ON "ai_garment_reference_observations"("analysis_id", "feature_key");

-- CreateIndex
CREATE INDEX "ai_garment_reference_analysis_runs_project_id_status_idx" ON "ai_garment_reference_analysis_runs"("project_id", "status");

-- AddForeignKey
ALTER TABLE "ai_garment_reference_analyses" ADD CONSTRAINT "ai_garment_reference_analyses_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_reference_analyses" ADD CONSTRAINT "ai_garment_reference_analyses_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "ai_garment_projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_reference_analyses" ADD CONSTRAINT "ai_garment_reference_analyses_approved_by_user_id_fkey" FOREIGN KEY ("approved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_reference_analyses" ADD CONSTRAINT "ai_garment_reference_analyses_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_reference_observations" ADD CONSTRAINT "ai_garment_reference_observations_analysis_id_fkey" FOREIGN KEY ("analysis_id") REFERENCES "ai_garment_reference_analyses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_reference_observations" ADD CONSTRAINT "ai_garment_reference_observations_approved_by_user_id_fkey" FOREIGN KEY ("approved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_reference_analysis_runs" ADD CONSTRAINT "ai_garment_reference_analysis_runs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_reference_analysis_runs" ADD CONSTRAINT "ai_garment_reference_analysis_runs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "ai_garment_projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_reference_analysis_runs" ADD CONSTRAINT "ai_garment_reference_analysis_runs_analysis_id_fkey" FOREIGN KEY ("analysis_id") REFERENCES "ai_garment_reference_analyses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_reference_analysis_runs" ADD CONSTRAINT "ai_garment_reference_analysis_runs_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

