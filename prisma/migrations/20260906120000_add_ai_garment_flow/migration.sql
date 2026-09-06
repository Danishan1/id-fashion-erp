-- CreateEnum
CREATE TYPE "AiGarmentSourceType" AS ENUM ('REFERENCE', 'FABRIC');

-- CreateEnum
CREATE TYPE "AiGarmentProjectStatus" AS ENUM ('IDEA', 'REFERENCE_ANALYSIS', 'DESIGN_DEVELOPMENT', 'DESIGN_SELECTED', 'TECHNICAL_DEVELOPMENT', 'COSTING', 'SAMPLING', 'BUYER_REVIEW', 'APPROVED', 'PRODUCTION', 'COMPLETED', 'REJECTED', 'ON_HOLD', 'CANCELLED');

-- AlterEnum
ALTER TYPE "DocumentType" ADD VALUE 'AI_GARMENT_PROJECT';

-- AlterEnum
ALTER TYPE "RelatedModule" ADD VALUE 'AI_GARMENT_PROJECT';

-- CreateTable
CREATE TABLE "ai_garment_projects" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "branch_id" UUID,
    "project_number" TEXT NOT NULL,
    "project_name" TEXT NOT NULL,
    "source_type" "AiGarmentSourceType" NOT NULL,
    "customer_id" UUID,
    "buyer_id" UUID,
    "brand_id" UUID,
    "season_id" UUID,
    "category_id" UUID,
    "target_market" TEXT,
    "target_customer_profile" TEXT,
    "target_selling_price" DECIMAL(18,2),
    "currency_code" CHAR(3),
    "order_quantity_estimate" DECIMAL(18,2),
    "status" "AiGarmentProjectStatus" NOT NULL DEFAULT 'IDEA',
    "status_before_hold" "AiGarmentProjectStatus",
    "current_step_key" TEXT NOT NULL,
    "completed_step_keys" TEXT[],
    "product_id" UUID,
    "sample_request_id" UUID,
    "sales_order_id" UUID,
    "notes" TEXT,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_garment_projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_garment_fabric_details" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "gsm_id" UUID,
    "dye_id" UUID,
    "weave_type_id" UUID,
    "width_id" UUID,
    "composition_id" UUID,
    "color_id" UUID,
    "supplier_id" UUID,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_garment_fabric_details_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_garment_design_options" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "label" TEXT,
    "notes" TEXT,
    "is_selected" BOOLEAN NOT NULL DEFAULT false,
    "image_attachment_id" UUID,
    "ai_metadata" JSONB,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_garment_design_options_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_garment_projects_product_id_key" ON "ai_garment_projects"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_garment_projects_sample_request_id_key" ON "ai_garment_projects"("sample_request_id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_garment_projects_sales_order_id_key" ON "ai_garment_projects"("sales_order_id");

-- CreateIndex
CREATE INDEX "ai_garment_projects_company_id_status_idx" ON "ai_garment_projects"("company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ai_garment_projects_company_id_project_number_key" ON "ai_garment_projects"("company_id", "project_number");

-- CreateIndex
CREATE UNIQUE INDEX "ai_garment_fabric_details_project_id_key" ON "ai_garment_fabric_details"("project_id");

-- CreateIndex
CREATE INDEX "ai_garment_design_options_project_id_idx" ON "ai_garment_design_options"("project_id");

-- AddForeignKey
ALTER TABLE "ai_garment_projects" ADD CONSTRAINT "ai_garment_projects_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_projects" ADD CONSTRAINT "ai_garment_projects_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_projects" ADD CONSTRAINT "ai_garment_projects_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_projects" ADD CONSTRAINT "ai_garment_projects_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "buyers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_projects" ADD CONSTRAINT "ai_garment_projects_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_projects" ADD CONSTRAINT "ai_garment_projects_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "seasons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_projects" ADD CONSTRAINT "ai_garment_projects_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_projects" ADD CONSTRAINT "ai_garment_projects_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_projects" ADD CONSTRAINT "ai_garment_projects_sample_request_id_fkey" FOREIGN KEY ("sample_request_id") REFERENCES "sample_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_projects" ADD CONSTRAINT "ai_garment_projects_sales_order_id_fkey" FOREIGN KEY ("sales_order_id") REFERENCES "sales_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_projects" ADD CONSTRAINT "ai_garment_projects_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_fabric_details" ADD CONSTRAINT "ai_garment_fabric_details_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "ai_garment_projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_fabric_details" ADD CONSTRAINT "ai_garment_fabric_details_gsm_id_fkey" FOREIGN KEY ("gsm_id") REFERENCES "fabric_gsms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_fabric_details" ADD CONSTRAINT "ai_garment_fabric_details_dye_id_fkey" FOREIGN KEY ("dye_id") REFERENCES "fabric_dyes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_fabric_details" ADD CONSTRAINT "ai_garment_fabric_details_weave_type_id_fkey" FOREIGN KEY ("weave_type_id") REFERENCES "fabric_weave_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_fabric_details" ADD CONSTRAINT "ai_garment_fabric_details_width_id_fkey" FOREIGN KEY ("width_id") REFERENCES "fabric_widths"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_fabric_details" ADD CONSTRAINT "ai_garment_fabric_details_composition_id_fkey" FOREIGN KEY ("composition_id") REFERENCES "fabric_compositions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_fabric_details" ADD CONSTRAINT "ai_garment_fabric_details_color_id_fkey" FOREIGN KEY ("color_id") REFERENCES "colors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_fabric_details" ADD CONSTRAINT "ai_garment_fabric_details_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_design_options" ADD CONSTRAINT "ai_garment_design_options_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "ai_garment_projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_design_options" ADD CONSTRAINT "ai_garment_design_options_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

