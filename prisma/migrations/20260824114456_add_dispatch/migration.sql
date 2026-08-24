-- CreateEnum
CREATE TYPE "DispatchStatus" AS ENUM ('DRAFT', 'PACKED', 'DISPATCHED', 'DELIVERED', 'ON_HOLD', 'CANCELLED');

-- AlterEnum
ALTER TYPE "InventoryTransactionType" ADD VALUE 'DISPATCH';

-- AlterTable
ALTER TABLE "sales_order_items" ADD COLUMN     "dispatched_quantity" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "dispatches" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "branch_id" UUID,
    "dispatch_number" TEXT NOT NULL,
    "sales_order_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "dispatch_date" DATE NOT NULL,
    "status" "DispatchStatus" NOT NULL DEFAULT 'DRAFT',
    "status_before_hold" "DispatchStatus",
    "delivery_address" TEXT NOT NULL,
    "transporter_name" TEXT,
    "vehicle_number" TEXT,
    "tracking_number" TEXT,
    "dispatched_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "received_by_name" TEXT,
    "requested_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dispatches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dispatch_items" (
    "id" UUID NOT NULL,
    "dispatch_id" UUID NOT NULL,
    "sales_order_item_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "dispatched_quantity" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dispatch_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cartons" (
    "id" UUID NOT NULL,
    "dispatch_id" UUID NOT NULL,
    "carton_number" INTEGER NOT NULL,
    "total_quantity" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cartons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "carton_items" (
    "id" UUID NOT NULL,
    "carton_id" UUID NOT NULL,
    "dispatch_item_id" UUID NOT NULL,
    "product_variant_id" UUID,
    "quantity" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "carton_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "dispatches_company_id_branch_id_dispatch_number_key" ON "dispatches"("company_id", "branch_id", "dispatch_number");

-- CreateIndex
CREATE INDEX "dispatch_items_dispatch_id_idx" ON "dispatch_items"("dispatch_id");

-- CreateIndex
CREATE UNIQUE INDEX "cartons_dispatch_id_carton_number_key" ON "cartons"("dispatch_id", "carton_number");

-- CreateIndex
CREATE INDEX "carton_items_carton_id_idx" ON "carton_items"("carton_id");

-- CreateIndex
CREATE INDEX "carton_items_dispatch_item_id_idx" ON "carton_items"("dispatch_item_id");

-- AddForeignKey
ALTER TABLE "dispatches" ADD CONSTRAINT "dispatches_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispatches" ADD CONSTRAINT "dispatches_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispatches" ADD CONSTRAINT "dispatches_sales_order_id_fkey" FOREIGN KEY ("sales_order_id") REFERENCES "sales_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispatches" ADD CONSTRAINT "dispatches_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispatches" ADD CONSTRAINT "dispatches_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispatches" ADD CONSTRAINT "dispatches_requested_by_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispatch_items" ADD CONSTRAINT "dispatch_items_dispatch_id_fkey" FOREIGN KEY ("dispatch_id") REFERENCES "dispatches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispatch_items" ADD CONSTRAINT "dispatch_items_sales_order_item_id_fkey" FOREIGN KEY ("sales_order_item_id") REFERENCES "sales_order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispatch_items" ADD CONSTRAINT "dispatch_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cartons" ADD CONSTRAINT "cartons_dispatch_id_fkey" FOREIGN KEY ("dispatch_id") REFERENCES "dispatches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "carton_items" ADD CONSTRAINT "carton_items_carton_id_fkey" FOREIGN KEY ("carton_id") REFERENCES "cartons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "carton_items" ADD CONSTRAINT "carton_items_dispatch_item_id_fkey" FOREIGN KEY ("dispatch_item_id") REFERENCES "dispatch_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "carton_items" ADD CONSTRAINT "carton_items_product_variant_id_fkey" FOREIGN KEY ("product_variant_id") REFERENCES "product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CheckConstraint: same positive-quantity precedent as every prior phase's migration.
ALTER TABLE "dispatch_items" ADD CONSTRAINT "dispatch_items_quantity_positive_check"
  CHECK (dispatched_quantity > 0);

ALTER TABLE "carton_items" ADD CONSTRAINT "carton_items_quantity_positive_check"
  CHECK (quantity > 0);

ALTER TABLE "cartons" ADD CONSTRAINT "cartons_total_quantity_non_negative_check"
  CHECK (total_quantity >= 0);

ALTER TABLE "sales_order_items" ADD CONSTRAINT "sales_order_items_dispatched_quantity_non_negative_check"
  CHECK (dispatched_quantity >= 0);
