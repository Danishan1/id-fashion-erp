-- CreateEnum
CREATE TYPE "AiGarmentDesignBalance" AS ENUM ('COMMERCIAL_LOWER_RISK', 'BALANCED', 'FASHION_FORWARD');

-- CreateEnum
CREATE TYPE "AiGarmentCommercialClassification" AS ENUM ('SAFE_COMMERCIAL', 'BALANCED', 'FASHION_FORWARD');

-- CreateEnum
CREATE TYPE "AiGarmentRatingLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "AiGarmentDesignDirectionStatus" AS ENUM ('GENERATED', 'APPROVED', 'REJECTED', 'SAVED_FOR_LATER');

-- CreateTable
CREATE TABLE "ai_garment_development_brief_runs" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "reference_analysis_id" UUID NOT NULL,
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

    CONSTRAINT "ai_garment_development_brief_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_garment_design_directions" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "development_brief_run_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "AiGarmentDesignDirectionStatus" NOT NULL DEFAULT 'GENERATED',
    "ai_generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_notes" TEXT,
    "user_edited" BOOLEAN NOT NULL DEFAULT false,
    "design_direction_name" TEXT NOT NULL,
    "commercial_classification" "AiGarmentCommercialClassification" NOT NULL,
    "target_consumer" TEXT NOT NULL,
    "silhouette" TEXT NOT NULL,
    "garment_length" TEXT NOT NULL,
    "fit" TEXT NOT NULL,
    "neckline" TEXT NOT NULL,
    "collar" TEXT NOT NULL,
    "sleeve" TEXT NOT NULL,
    "shoulder_construction" TEXT NOT NULL,
    "front_construction" TEXT NOT NULL,
    "back_construction" TEXT NOT NULL,
    "closure" TEXT NOT NULL,
    "pocket" TEXT NOT NULL,
    "waist_treatment" TEXT NOT NULL,
    "hem" TEXT NOT NULL,
    "key_new_design_feature" TEXT NOT NULL,
    "suggested_fabric_character" TEXT NOT NULL,
    "suggested_trims" TEXT NOT NULL,
    "production_complexity" "AiGarmentRatingLevel" NOT NULL,
    "expected_fabric_consumption" "AiGarmentRatingLevel" NOT NULL,
    "target_price_compatibility_level" "AiGarmentRatingLevel" NOT NULL,
    "commercial_rationale" TEXT NOT NULL,
    "manufacturing_risk" TEXT NOT NULL,
    "differentiation_from_reference" TEXT NOT NULL,
    "commercial_potential_score" INTEGER NOT NULL,
    "buyer_fit_score" INTEGER NOT NULL,
    "manufacturing_ease_score" INTEGER NOT NULL,
    "target_price_compatibility_score" INTEGER NOT NULL,
    "fabric_efficiency_score" INTEGER NOT NULL,
    "design_freshness_score" INTEGER NOT NULL,
    "overall_score" INTEGER NOT NULL,
    "is_recommended_for_visualisation" BOOLEAN NOT NULL DEFAULT false,
    "ai_raw_json" JSONB NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_garment_design_directions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_garment_development_brief_runs_project_id_status_idx" ON "ai_garment_development_brief_runs"("project_id", "status");

-- CreateIndex
CREATE INDEX "ai_garment_design_directions_project_id_status_idx" ON "ai_garment_design_directions"("project_id", "status");

-- AddForeignKey
ALTER TABLE "ai_garment_development_brief_runs" ADD CONSTRAINT "ai_garment_development_brief_runs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_development_brief_runs" ADD CONSTRAINT "ai_garment_development_brief_runs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "ai_garment_projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_development_brief_runs" ADD CONSTRAINT "ai_garment_development_brief_runs_reference_analysis_id_fkey" FOREIGN KEY ("reference_analysis_id") REFERENCES "ai_garment_reference_analyses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_development_brief_runs" ADD CONSTRAINT "ai_garment_development_brief_runs_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_design_directions" ADD CONSTRAINT "ai_garment_design_directions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_design_directions" ADD CONSTRAINT "ai_garment_design_directions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "ai_garment_projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_design_directions" ADD CONSTRAINT "ai_garment_design_directions_development_brief_run_id_fkey" FOREIGN KEY ("development_brief_run_id") REFERENCES "ai_garment_development_brief_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_design_directions" ADD CONSTRAINT "ai_garment_design_directions_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

