-- CreateEnum
CREATE TYPE "PurchaseRequestStatus" AS ENUM ('OPEN', 'PARTIALLY_CONVERTED', 'CONVERTED_TO_PO', 'CLOSED', 'ON_HOLD', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PurchaseRequestLineStatus" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "purchase_order_items" ADD COLUMN     "purchase_request_item_id" UUID;

-- CreateTable
CREATE TABLE "purchase_requests" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "branch_id" UUID,
    "request_number" TEXT NOT NULL,
    "department_id" UUID,
    "reference_text" TEXT,
    "delivery_date" DATE,
    "warehouse_id" UUID,
    "remarks" TEXT,
    "status" "PurchaseRequestStatus" NOT NULL DEFAULT 'OPEN',
    "status_before_hold" "PurchaseRequestStatus",
    "is_authorized" BOOLEAN NOT NULL DEFAULT false,
    "authorized_at" TIMESTAMP(3),
    "authorized_by_user_id" UUID,
    "estimated_total_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "requested_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_request_items" (
    "id" UUID NOT NULL,
    "purchase_request_id" UUID NOT NULL,
    "material_id" UUID NOT NULL,
    "color_id" UUID,
    "dye_id" UUID,
    "uom_id" UUID NOT NULL,
    "requested_quantity" DECIMAL(18,4) NOT NULL,
    "rate" DECIMAL(18,2),
    "approved_quantity" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "line_status" "PurchaseRequestLineStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "rejection_reason" TEXT,
    "sales_order_id" UUID,
    "remarks" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_request_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "purchase_requests_company_id_status_idx" ON "purchase_requests"("company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_requests_company_id_request_number_key" ON "purchase_requests"("company_id", "request_number");

-- CreateIndex
CREATE INDEX "purchase_request_items_purchase_request_id_idx" ON "purchase_request_items"("purchase_request_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_order_items_purchase_request_item_id_key" ON "purchase_order_items"("purchase_request_item_id");

-- AddForeignKey
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_purchase_request_item_id_fkey" FOREIGN KEY ("purchase_request_item_id") REFERENCES "purchase_request_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_requested_by_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_authorized_by_user_id_fkey" FOREIGN KEY ("authorized_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_request_items" ADD CONSTRAINT "purchase_request_items_purchase_request_id_fkey" FOREIGN KEY ("purchase_request_id") REFERENCES "purchase_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_request_items" ADD CONSTRAINT "purchase_request_items_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_request_items" ADD CONSTRAINT "purchase_request_items_color_id_fkey" FOREIGN KEY ("color_id") REFERENCES "colors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_request_items" ADD CONSTRAINT "purchase_request_items_dye_id_fkey" FOREIGN KEY ("dye_id") REFERENCES "fabric_dyes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_request_items" ADD CONSTRAINT "purchase_request_items_uom_id_fkey" FOREIGN KEY ("uom_id") REFERENCES "units_of_measure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_request_items" ADD CONSTRAINT "purchase_request_items_sales_order_id_fkey" FOREIGN KEY ("sales_order_id") REFERENCES "sales_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

