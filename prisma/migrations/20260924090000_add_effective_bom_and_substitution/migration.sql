-- CreateEnum
CREATE TYPE "SalesOrderBomSourceType" AS ENUM ('STYLE_BOM', 'SAMPLE_MATERIALS', 'NONE');

-- CreateEnum
CREATE TYPE "SalesOrderBomOverrideReason" AS ENUM ('CUSTOMER_REQUIREMENT', 'BUYER_APPROVAL', 'SPECIFICATION_CHANGE', 'QUALITY_REQUIREMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "ApprovalDecisionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "MaterialSubstitutionReason" AS ENUM ('ORIGINAL_MATERIAL_NOT_AVAILABLE', 'QUALITY_ISSUE', 'OTHER');

-- AlterTable
ALTER TABLE "material_requests" ADD COLUMN     "approval_remark" TEXT,
ADD COLUMN     "approval_status" "ApprovalDecisionStatus",
ADD COLUMN     "approved_at" TIMESTAMP(3),
ADD COLUMN     "approved_by_user_id" UUID,
ADD COLUMN     "job_order_id" UUID,
ADD COLUMN     "lot_id" UUID;

-- AlterTable
ALTER TABLE "sales_order_items" ADD COLUMN     "sales_order_line_id" UUID;

-- CreateTable
CREATE TABLE "sales_order_lines" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "sales_order_id" UUID NOT NULL,
    "line_number" INTEGER NOT NULL,
    "source_type" "SalesOrderBomSourceType" NOT NULL DEFAULT 'NONE',
    "bom_version_id" UUID,
    "sample_version_id" UUID,
    "snapshot_taken_at" TIMESTAMP(3),
    "snapshot_taken_by_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_order_bom_overrides" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "sales_order_line_id" UUID NOT NULL,
    "original_material_id" UUID,
    "effective_material_id" UUID,
    "original_quantity_per_unit" DECIMAL(18,4),
    "effective_quantity_per_unit" DECIMAL(18,4),
    "wastage_percentage" DECIMAL(5,2),
    "color_id" UUID,
    "uom_id" UUID,
    "reason" "SalesOrderBomOverrideReason" NOT NULL DEFAULT 'OTHER',
    "remarks" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "changed_by_user_id" UUID NOT NULL,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deactivated_by_user_id" UUID,
    "deactivated_at" TIMESTAMP(3),

    CONSTRAINT "sales_order_bom_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "material_substitutions" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "material_request_item_id" UUID NOT NULL,
    "original_material_id" UUID NOT NULL,
    "substitute_material_id" UUID NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "uom_id" UUID NOT NULL,
    "reason" "MaterialSubstitutionReason" NOT NULL DEFAULT 'OTHER',
    "remarks" TEXT,
    "status" "ApprovalDecisionStatus" NOT NULL DEFAULT 'PENDING',
    "requested_by_user_id" UUID NOT NULL,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approved_by_user_id" UUID,
    "approved_at" TIMESTAMP(3),
    "approval_remark" TEXT,
    "inventory_transaction_id" UUID,

    CONSTRAINT "material_substitutions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sales_order_lines_sales_order_id_line_number_key" ON "sales_order_lines"("sales_order_id", "line_number");

-- CreateIndex
CREATE INDEX "sales_order_bom_overrides_sales_order_line_id_idx" ON "sales_order_bom_overrides"("sales_order_line_id");

-- CreateIndex
CREATE INDEX "material_substitutions_material_request_item_id_idx" ON "material_substitutions"("material_request_item_id");

-- CreateIndex
CREATE INDEX "material_substitutions_company_id_status_idx" ON "material_substitutions"("company_id", "status");

-- CreateIndex
CREATE INDEX "material_requests_lot_id_idx" ON "material_requests"("lot_id");

-- CreateIndex
CREATE INDEX "material_requests_job_order_id_idx" ON "material_requests"("job_order_id");

-- AddForeignKey
ALTER TABLE "sales_order_items" ADD CONSTRAINT "sales_order_items_sales_order_line_id_fkey" FOREIGN KEY ("sales_order_line_id") REFERENCES "sales_order_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_sales_order_id_fkey" FOREIGN KEY ("sales_order_id") REFERENCES "sales_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_bom_version_id_fkey" FOREIGN KEY ("bom_version_id") REFERENCES "bom_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_sample_version_id_fkey" FOREIGN KEY ("sample_version_id") REFERENCES "sample_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_snapshot_taken_by_user_id_fkey" FOREIGN KEY ("snapshot_taken_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order_bom_overrides" ADD CONSTRAINT "sales_order_bom_overrides_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order_bom_overrides" ADD CONSTRAINT "sales_order_bom_overrides_sales_order_line_id_fkey" FOREIGN KEY ("sales_order_line_id") REFERENCES "sales_order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order_bom_overrides" ADD CONSTRAINT "sales_order_bom_overrides_original_material_id_fkey" FOREIGN KEY ("original_material_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order_bom_overrides" ADD CONSTRAINT "sales_order_bom_overrides_effective_material_id_fkey" FOREIGN KEY ("effective_material_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order_bom_overrides" ADD CONSTRAINT "sales_order_bom_overrides_color_id_fkey" FOREIGN KEY ("color_id") REFERENCES "colors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order_bom_overrides" ADD CONSTRAINT "sales_order_bom_overrides_uom_id_fkey" FOREIGN KEY ("uom_id") REFERENCES "units_of_measure"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order_bom_overrides" ADD CONSTRAINT "sales_order_bom_overrides_changed_by_user_id_fkey" FOREIGN KEY ("changed_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order_bom_overrides" ADD CONSTRAINT "sales_order_bom_overrides_deactivated_by_user_id_fkey" FOREIGN KEY ("deactivated_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_requests" ADD CONSTRAINT "material_requests_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_requests" ADD CONSTRAINT "material_requests_job_order_id_fkey" FOREIGN KEY ("job_order_id") REFERENCES "job_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_requests" ADD CONSTRAINT "material_requests_approved_by_user_id_fkey" FOREIGN KEY ("approved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_substitutions" ADD CONSTRAINT "material_substitutions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_substitutions" ADD CONSTRAINT "material_substitutions_material_request_item_id_fkey" FOREIGN KEY ("material_request_item_id") REFERENCES "material_request_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_substitutions" ADD CONSTRAINT "material_substitutions_original_material_id_fkey" FOREIGN KEY ("original_material_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_substitutions" ADD CONSTRAINT "material_substitutions_substitute_material_id_fkey" FOREIGN KEY ("substitute_material_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_substitutions" ADD CONSTRAINT "material_substitutions_uom_id_fkey" FOREIGN KEY ("uom_id") REFERENCES "units_of_measure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_substitutions" ADD CONSTRAINT "material_substitutions_requested_by_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_substitutions" ADD CONSTRAINT "material_substitutions_approved_by_user_id_fkey" FOREIGN KEY ("approved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_substitutions" ADD CONSTRAINT "material_substitutions_inventory_transaction_id_fkey" FOREIGN KEY ("inventory_transaction_id") REFERENCES "inventory_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
