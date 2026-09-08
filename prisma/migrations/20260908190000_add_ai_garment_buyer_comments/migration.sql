-- CreateEnum
CREATE TYPE "AiGarmentBuyerCommentCategory" AS ENUM ('FIT', 'CONSTRUCTION', 'FABRIC', 'COLOR', 'TRIM', 'PRICING', 'OTHER');

-- CreateTable
CREATE TABLE "ai_garment_buyer_comments_runs" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
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

    CONSTRAINT "ai_garment_buyer_comments_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_garment_buyer_comments_analyses" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "overall_summary" TEXT NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_garment_buyer_comments_analyses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_garment_buyer_comment_category_summaries" (
    "id" UUID NOT NULL,
    "analysis_id" UUID NOT NULL,
    "category" "AiGarmentBuyerCommentCategory" NOT NULL,
    "summary" TEXT NOT NULL,
    "evidence_excerpt" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_garment_buyer_comment_category_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_garment_buyer_comments_runs_project_id_status_idx" ON "ai_garment_buyer_comments_runs"("project_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ai_garment_buyer_comments_analyses_run_id_key" ON "ai_garment_buyer_comments_analyses"("run_id");

-- CreateIndex
CREATE INDEX "ai_garment_buyer_comments_analyses_project_id_idx" ON "ai_garment_buyer_comments_analyses"("project_id");

-- AddForeignKey
ALTER TABLE "ai_garment_buyer_comments_runs" ADD CONSTRAINT "ai_garment_buyer_comments_runs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_buyer_comments_runs" ADD CONSTRAINT "ai_garment_buyer_comments_runs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "ai_garment_projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_buyer_comments_runs" ADD CONSTRAINT "ai_garment_buyer_comments_runs_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_buyer_comments_analyses" ADD CONSTRAINT "ai_garment_buyer_comments_analyses_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_buyer_comments_analyses" ADD CONSTRAINT "ai_garment_buyer_comments_analyses_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "ai_garment_projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_buyer_comments_analyses" ADD CONSTRAINT "ai_garment_buyer_comments_analyses_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "ai_garment_buyer_comments_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_buyer_comments_analyses" ADD CONSTRAINT "ai_garment_buyer_comments_analyses_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_buyer_comment_category_summaries" ADD CONSTRAINT "ai_garment_buyer_comment_category_summaries_analysis_id_fkey" FOREIGN KEY ("analysis_id") REFERENCES "ai_garment_buyer_comments_analyses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
