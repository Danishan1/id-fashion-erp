-- CreateEnum
CREATE TYPE "MaterialRequestStatus" AS ENUM ('OPEN', 'PARTIALLY_FULFILLED', 'FULFILLED', 'CLOSED', 'ON_HOLD', 'CANCELLED');

-- AlterEnum
BEGIN;
CREATE TYPE "DocumentType_new" AS ENUM ('SAMPLE_REQUEST', 'BUYER_ENQUIRY', 'SALES_ORDER', 'PRODUCTION_ORDER', 'SALES_INVOICE', 'PURCHASE_INVOICE', 'PURCHASE_ORDER', 'MATERIAL_REQUEST', 'GOODS_RECEIPT', 'DISPATCH', 'PAYMENT', 'EXPENSE', 'STOCK_MOVEMENT', 'JOURNAL', 'CUSTOMER', 'SUPPLIER', 'EMPLOYEE', 'STYLE', 'MATERIAL');
ALTER TABLE "document_sequences" ALTER COLUMN "document_type" TYPE "DocumentType_new" USING ("document_type"::text::"DocumentType_new");
ALTER TYPE "DocumentType" RENAME TO "DocumentType_old";
ALTER TYPE "DocumentType_new" RENAME TO "DocumentType";
DROP TYPE "public"."DocumentType_old";
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "RelatedModule_new" AS ENUM ('SAMPLE_REQUEST', 'BUYER_ENQUIRY', 'SALES_ORDER', 'PURCHASE_ORDER', 'MATERIAL_REQUEST', 'SALES_INVOICE', 'PURCHASE_INVOICE', 'QC_INSPECTION', 'DISPATCH', 'PAYMENT', 'GOODS_RECEIPT', 'PRODUCTION_ORDER', 'EXPENSE', 'CUSTOMER', 'SUPPLIER', 'EMPLOYEE', 'PRODUCT');
ALTER TABLE "inventory_transactions" ALTER COLUMN "reference_module" TYPE "RelatedModule_new" USING ("reference_module"::text::"RelatedModule_new");
ALTER TABLE "attachments" ALTER COLUMN "related_module" TYPE "RelatedModule_new" USING ("related_module"::text::"RelatedModule_new");
ALTER TABLE "notifications" ALTER COLUMN "related_module" TYPE "RelatedModule_new" USING ("related_module"::text::"RelatedModule_new");
ALTER TYPE "RelatedModule" RENAME TO "RelatedModule_old";
ALTER TYPE "RelatedModule_new" RENAME TO "RelatedModule";
DROP TYPE "public"."RelatedModule_old";
COMMIT;

-- DropForeignKey
ALTER TABLE "purchase_order_items" DROP CONSTRAINT "purchase_order_items_purchase_request_item_id_fkey";

-- DropForeignKey
ALTER TABLE "purchase_request_items" DROP CONSTRAINT "purchase_request_items_color_id_fkey";

-- DropForeignKey
ALTER TABLE "purchase_request_items" DROP CONSTRAINT "purchase_request_items_dye_id_fkey";

-- DropForeignKey
ALTER TABLE "purchase_request_items" DROP CONSTRAINT "purchase_request_items_material_id_fkey";

-- DropForeignKey
ALTER TABLE "purchase_request_items" DROP CONSTRAINT "purchase_request_items_purchase_request_id_fkey";

-- DropForeignKey
ALTER TABLE "purchase_request_items" DROP CONSTRAINT "purchase_request_items_sales_order_id_fkey";

-- DropForeignKey
ALTER TABLE "purchase_request_items" DROP CONSTRAINT "purchase_request_items_uom_id_fkey";

-- DropForeignKey
ALTER TABLE "purchase_requests" DROP CONSTRAINT "purchase_requests_authorized_by_user_id_fkey";

-- DropForeignKey
ALTER TABLE "purchase_requests" DROP CONSTRAINT "purchase_requests_branch_id_fkey";

-- DropForeignKey
ALTER TABLE "purchase_requests" DROP CONSTRAINT "purchase_requests_company_id_fkey";

-- DropForeignKey
ALTER TABLE "purchase_requests" DROP CONSTRAINT "purchase_requests_department_id_fkey";

-- DropForeignKey
ALTER TABLE "purchase_requests" DROP CONSTRAINT "purchase_requests_requested_by_user_id_fkey";

-- DropForeignKey
ALTER TABLE "purchase_requests" DROP CONSTRAINT "purchase_requests_warehouse_id_fkey";

-- DropIndex
DROP INDEX "purchase_order_items_purchase_request_item_id_key";

-- AlterTable
ALTER TABLE "purchase_order_items" DROP COLUMN "purchase_request_item_id",
ADD COLUMN     "material_request_item_id" UUID;

-- DropTable
DROP TABLE "purchase_request_items";

-- DropTable
DROP TABLE "purchase_requests";

-- DropEnum
DROP TYPE "PurchaseRequestLineStatus";

-- DropEnum
DROP TYPE "PurchaseRequestStatus";

-- CreateTable
CREATE TABLE "material_requests" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "branch_id" UUID,
    "request_number" TEXT NOT NULL,
    "department_id" UUID,
    "warehouse_id" UUID NOT NULL,
    "required_date" DATE,
    "purpose" TEXT,
    "sales_order_id" UUID,
    "remarks" TEXT,
    "status" "MaterialRequestStatus" NOT NULL DEFAULT 'OPEN',
    "status_before_hold" "MaterialRequestStatus",
    "requested_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "material_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "material_request_items" (
    "id" UUID NOT NULL,
    "material_request_id" UUID NOT NULL,
    "material_id" UUID NOT NULL,
    "color_id" UUID,
    "dye_id" UUID,
    "uom_id" UUID NOT NULL,
    "requested_quantity" DECIMAL(18,4) NOT NULL,
    "issued_quantity" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "remarks" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "material_request_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "material_requests_company_id_status_idx" ON "material_requests"("company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "material_requests_company_id_request_number_key" ON "material_requests"("company_id", "request_number");

-- CreateIndex
CREATE INDEX "material_request_items_material_request_id_idx" ON "material_request_items"("material_request_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_order_items_material_request_item_id_key" ON "purchase_order_items"("material_request_item_id");

-- AddForeignKey
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_material_request_item_id_fkey" FOREIGN KEY ("material_request_item_id") REFERENCES "material_request_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_requests" ADD CONSTRAINT "material_requests_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_requests" ADD CONSTRAINT "material_requests_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_requests" ADD CONSTRAINT "material_requests_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_requests" ADD CONSTRAINT "material_requests_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_requests" ADD CONSTRAINT "material_requests_sales_order_id_fkey" FOREIGN KEY ("sales_order_id") REFERENCES "sales_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_requests" ADD CONSTRAINT "material_requests_requested_by_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_request_items" ADD CONSTRAINT "material_request_items_material_request_id_fkey" FOREIGN KEY ("material_request_id") REFERENCES "material_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_request_items" ADD CONSTRAINT "material_request_items_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_request_items" ADD CONSTRAINT "material_request_items_color_id_fkey" FOREIGN KEY ("color_id") REFERENCES "colors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_request_items" ADD CONSTRAINT "material_request_items_dye_id_fkey" FOREIGN KEY ("dye_id") REFERENCES "fabric_dyes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_request_items" ADD CONSTRAINT "material_request_items_uom_id_fkey" FOREIGN KEY ("uom_id") REFERENCES "units_of_measure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

