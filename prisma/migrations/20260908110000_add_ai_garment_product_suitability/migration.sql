
-- CreateEnum
CREATE TYPE "AiGarmentSuitabilityStatus" AS ENUM ('DRAFT', 'AI_ANALYSED', 'UNDER_REVIEW', 'APPROVED', 'STALE');

-- CreateEnum
CREATE TYPE "AiGarmentSuitabilityRating" AS ENUM ('HIGHLY_SUITABLE', 'SUITABLE', 'MARGINALLY_SUITABLE', 'NOT_SUITABLE');

-- CreateTable
CREATE TABLE "ai_garment_product_suitabilities" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "status" "AiGarmentSuitabilityStatus" NOT NULL DEFAULT 'DRAFT',
    "analysis_version" INTEGER NOT NULL DEFAULT 0,
    "prompt_version" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "raw_response_json" JSONB NOT NULL,
    "overall_summary" TEXT,
    "approved_by_user_id" UUID,
    "approved_at" TIMESTAMP(3),
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_garment_product_suitabilities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_garment_product_suitability_items" (
    "id" UUID NOT NULL,
    "suitability_id" UUID NOT NULL,
    "product_type_id" UUID NOT NULL,
    "ai_rating" "AiGarmentSuitabilityRating" NOT NULL,
    "ai_reasoning" TEXT NOT NULL,
    "approved_rating" "AiGarmentSuitabilityRating" NOT NULL,
    "user_edited" BOOLEAN NOT NULL DEFAULT false,
    "approved_by_user_id" UUID,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_garment_product_suitability_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_garment_product_suitability_runs" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "suitability_id" UUID,
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

    CONSTRAINT "ai_garment_product_suitability_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_garment_product_suitabilities_project_id_key" ON "ai_garment_product_suitabilities"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_garment_product_suitability_items_suitability_id_product_key" ON "ai_garment_product_suitability_items"("suitability_id", "product_type_id");

-- CreateIndex
CREATE INDEX "ai_garment_product_suitability_runs_project_id_status_idx" ON "ai_garment_product_suitability_runs"("project_id", "status");

-- AddForeignKey
ALTER TABLE "ai_garment_product_suitabilities" ADD CONSTRAINT "ai_garment_product_suitabilities_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_product_suitabilities" ADD CONSTRAINT "ai_garment_product_suitabilities_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "ai_garment_projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_product_suitabilities" ADD CONSTRAINT "ai_garment_product_suitabilities_approved_by_user_id_fkey" FOREIGN KEY ("approved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_product_suitabilities" ADD CONSTRAINT "ai_garment_product_suitabilities_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_product_suitability_items" ADD CONSTRAINT "ai_garment_product_suitability_items_suitability_id_fkey" FOREIGN KEY ("suitability_id") REFERENCES "ai_garment_product_suitabilities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_product_suitability_items" ADD CONSTRAINT "ai_garment_product_suitability_items_product_type_id_fkey" FOREIGN KEY ("product_type_id") REFERENCES "product_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_product_suitability_items" ADD CONSTRAINT "ai_garment_product_suitability_items_approved_by_user_id_fkey" FOREIGN KEY ("approved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_product_suitability_runs" ADD CONSTRAINT "ai_garment_product_suitability_runs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_product_suitability_runs" ADD CONSTRAINT "ai_garment_product_suitability_runs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "ai_garment_projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_product_suitability_runs" ADD CONSTRAINT "ai_garment_product_suitability_runs_suitability_id_fkey" FOREIGN KEY ("suitability_id") REFERENCES "ai_garment_product_suitabilities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_product_suitability_runs" ADD CONSTRAINT "ai_garment_product_suitability_runs_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

