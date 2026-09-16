-- CreateTable
CREATE TABLE "replicate_design_tech_packs" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "status" "AiDesignerRunStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "garment_analysis_json" JSONB,
    "designer_notes" TEXT,
    "suggested_additional_views" TEXT,
    "error_message" TEXT,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "replicate_design_tech_packs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "replicate_design_tech_pack_pages" (
    "id" UUID NOT NULL,
    "tech_pack_id" UUID NOT NULL,
    "page_number" INTEGER NOT NULL,
    "page_title" TEXT NOT NULL,
    "prompt_text" TEXT NOT NULL,
    "image_attachment_id" TEXT,

    CONSTRAINT "replicate_design_tech_pack_pages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "replicate_design_tech_pack_pages_tech_pack_id_page_number_key" ON "replicate_design_tech_pack_pages"("tech_pack_id", "page_number");

-- AddForeignKey
ALTER TABLE "replicate_design_tech_packs" ADD CONSTRAINT "replicate_design_tech_packs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "replicate_design_tech_packs" ADD CONSTRAINT "replicate_design_tech_packs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "replicate_design_projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "replicate_design_tech_packs" ADD CONSTRAINT "replicate_design_tech_packs_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "replicate_design_tech_pack_pages" ADD CONSTRAINT "replicate_design_tech_pack_pages_tech_pack_id_fkey" FOREIGN KEY ("tech_pack_id") REFERENCES "replicate_design_tech_packs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

