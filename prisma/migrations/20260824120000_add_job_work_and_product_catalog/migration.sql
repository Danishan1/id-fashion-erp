-- CreateEnum
CREATE TYPE "JobWorkOrderStatus" AS ENUM ('ISSUED', 'PARTIALLY_RECEIVED', 'FULLY_RECEIVED', 'CLOSED', 'ON_HOLD', 'CANCELLED');

-- CreateEnum
CREATE TYPE "JobWorkReceiptStatus" AS ENUM ('COMPLETED', 'PARTIALLY_REVERSED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "DocumentType" ADD VALUE 'JOB_WORK_ORDER';

-- AlterEnum
ALTER TYPE "InventoryTransactionType" ADD VALUE 'JOB_WORK_ISSUE';

-- AlterEnum
ALTER TYPE "RelatedModule" ADD VALUE 'JOB_WORK_ORDER';

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "brand_id" UUID,
ADD COLUMN     "product_fitting_id" UUID,
ADD COLUMN     "product_type_id" UUID;

-- CreateTable
CREATE TABLE "job_work_orders" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "branch_id" UUID,
    "job_work_number" TEXT NOT NULL,
    "supplier_id" UUID NOT NULL,
    "job_order_id" UUID NOT NULL,
    "issued_quantity" DECIMAL(18,4) NOT NULL,
    "uom_id" UUID NOT NULL,
    "issue_date" DATE NOT NULL,
    "expected_completion_date" DATE,
    "status" "JobWorkOrderStatus" NOT NULL DEFAULT 'ISSUED',
    "status_before_hold" "JobWorkOrderStatus",
    "received_quantity" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "rejected_quantity" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "damaged_quantity" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "remarks" TEXT,
    "requested_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_work_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_work_order_materials" (
    "id" UUID NOT NULL,
    "job_work_order_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "uom_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "fabric_roll_id" UUID,
    "notes" TEXT,

    CONSTRAINT "job_work_order_materials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_work_receipts" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "job_work_order_id" UUID NOT NULL,
    "receipt_number" TEXT NOT NULL,
    "received_date" DATE NOT NULL,
    "received_quantity" DECIMAL(18,4) NOT NULL,
    "rejected_quantity" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "damaged_quantity" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "status" "JobWorkReceiptStatus" NOT NULL DEFAULT 'COMPLETED',
    "remarks" TEXT,
    "received_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_work_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "job_work_orders_company_id_status_idx" ON "job_work_orders"("company_id", "status");

-- CreateIndex
CREATE INDEX "job_work_orders_supplier_id_idx" ON "job_work_orders"("supplier_id");

-- CreateIndex
CREATE INDEX "job_work_orders_job_order_id_idx" ON "job_work_orders"("job_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "job_work_orders_company_id_job_work_number_key" ON "job_work_orders"("company_id", "job_work_number");

-- CreateIndex
CREATE INDEX "job_work_receipts_job_work_order_id_idx" ON "job_work_receipts"("job_work_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "job_work_receipts_company_id_job_work_order_id_receipt_numb_key" ON "job_work_receipts"("company_id", "job_work_order_id", "receipt_number");

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_product_type_id_fkey" FOREIGN KEY ("product_type_id") REFERENCES "product_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_product_fitting_id_fkey" FOREIGN KEY ("product_fitting_id") REFERENCES "product_fittings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_work_orders" ADD CONSTRAINT "job_work_orders_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_work_orders" ADD CONSTRAINT "job_work_orders_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_work_orders" ADD CONSTRAINT "job_work_orders_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_work_orders" ADD CONSTRAINT "job_work_orders_job_order_id_fkey" FOREIGN KEY ("job_order_id") REFERENCES "job_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_work_orders" ADD CONSTRAINT "job_work_orders_uom_id_fkey" FOREIGN KEY ("uom_id") REFERENCES "units_of_measure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_work_orders" ADD CONSTRAINT "job_work_orders_requested_by_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_work_order_materials" ADD CONSTRAINT "job_work_order_materials_job_work_order_id_fkey" FOREIGN KEY ("job_work_order_id") REFERENCES "job_work_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_work_order_materials" ADD CONSTRAINT "job_work_order_materials_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_work_order_materials" ADD CONSTRAINT "job_work_order_materials_uom_id_fkey" FOREIGN KEY ("uom_id") REFERENCES "units_of_measure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_work_order_materials" ADD CONSTRAINT "job_work_order_materials_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_work_order_materials" ADD CONSTRAINT "job_work_order_materials_fabric_roll_id_fkey" FOREIGN KEY ("fabric_roll_id") REFERENCES "fabric_rolls"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_work_receipts" ADD CONSTRAINT "job_work_receipts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_work_receipts" ADD CONSTRAINT "job_work_receipts_job_work_order_id_fkey" FOREIGN KEY ("job_work_order_id") REFERENCES "job_work_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_work_receipts" ADD CONSTRAINT "job_work_receipts_received_by_user_id_fkey" FOREIGN KEY ("received_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
