
-- CreateEnum
CREATE TYPE "AiDesignerCreationMode" AS ENUM ('STANDARD', 'SKETCH');

-- CreateEnum
CREATE TYPE "AiDesignerSketchConfidence" AS ENUM ('CONFIRMED_VISUALLY', 'LIKELY_INFERRED', 'NOT_DETERMINABLE');

-- CreateEnum
CREATE TYPE "AiDesignerSketchAnalysisStatus" AS ENUM ('DRAFT', 'AI_ANALYSED', 'UNDER_REVIEW', 'APPROVED', 'STALE');

-- AlterTable
ALTER TABLE "ai_projects" ADD COLUMN     "creation_mode" "AiDesignerCreationMode" NOT NULL DEFAULT 'STANDARD',
ADD COLUMN     "sketch_image_attachment_id" TEXT;

-- CreateTable
CREATE TABLE "ai_designer_sketch_analyses" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "sketch_attachment_id" TEXT NOT NULL,
    "status" "AiDesignerSketchAnalysisStatus" NOT NULL DEFAULT 'DRAFT',
    "prompt_version" TEXT NOT NULL,
    "provider" TEXT,
    "model" TEXT,
    "raw_response_json" JSONB,
    "sketch_analysis_summary" TEXT,
    "approved_by_user_id" UUID,
    "approved_at" TIMESTAMP(3),
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_designer_sketch_analyses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_designer_sketch_observations" (
    "id" UUID NOT NULL,
    "analysis_id" UUID NOT NULL,
    "feature_key" TEXT NOT NULL,
    "ai_observation" TEXT NOT NULL,
    "ai_confidence" "AiDesignerSketchConfidence" NOT NULL,
    "approved_observation" TEXT NOT NULL,
    "user_edited" BOOLEAN NOT NULL DEFAULT false,
    "is_locked" BOOLEAN NOT NULL DEFAULT true,
    "approved_by_user_id" UUID,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_designer_sketch_observations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_designer_sketch_analysis_runs" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "analysis_id" UUID,
    "sketch_attachment_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "prompt_version" TEXT NOT NULL,
    "status" "AiDesignerRunStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "error_category" TEXT,
    "error_message" TEXT,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "created_by_user_id" UUID NOT NULL,

    CONSTRAINT "ai_designer_sketch_analysis_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_designer_sketch_analyses_project_id_key" ON "ai_designer_sketch_analyses"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_designer_sketch_observations_analysis_id_feature_key_key" ON "ai_designer_sketch_observations"("analysis_id", "feature_key");

-- CreateIndex
CREATE INDEX "ai_designer_sketch_analysis_runs_project_id_status_idx" ON "ai_designer_sketch_analysis_runs"("project_id", "status");

-- AddForeignKey
ALTER TABLE "ai_designer_sketch_analyses" ADD CONSTRAINT "ai_designer_sketch_analyses_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "ai_projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_designer_sketch_analyses" ADD CONSTRAINT "ai_designer_sketch_analyses_approved_by_user_id_fkey" FOREIGN KEY ("approved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_designer_sketch_analyses" ADD CONSTRAINT "ai_designer_sketch_analyses_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_designer_sketch_observations" ADD CONSTRAINT "ai_designer_sketch_observations_analysis_id_fkey" FOREIGN KEY ("analysis_id") REFERENCES "ai_designer_sketch_analyses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_designer_sketch_observations" ADD CONSTRAINT "ai_designer_sketch_observations_approved_by_user_id_fkey" FOREIGN KEY ("approved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_designer_sketch_analysis_runs" ADD CONSTRAINT "ai_designer_sketch_analysis_runs_analysis_id_fkey" FOREIGN KEY ("analysis_id") REFERENCES "ai_designer_sketch_analyses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_designer_sketch_analysis_runs" ADD CONSTRAINT "ai_designer_sketch_analysis_runs_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

