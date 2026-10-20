-- Reconstructs the migration that should have shipped with origin/main's
-- "Product Unit Garment Barcode & Traceability System" feature (commits
-- af51f5f/5425f49) -- schema.prisma already had these tables/enum values on
-- main's own tip commit, but no migration file for them was ever committed,
-- so they were never actually applied to this dev database (confirmed via a
-- direct information_schema query: product_units/customer_returns/
-- customer_return_items/product_unit_events do not exist here).
--
-- Deliberately EXCLUDES the `ALTER TABLE "sample_requests" DROP COLUMN
-- "color"` statement that `prisma migrate diff` also reported -- that is a
-- separate, pre-existing, unrelated schema/DB drift already documented
-- elsewhere (sample_requests.color exists in this dev DB but not in
-- schema.prisma) and must not be touched by this migration.

-- CreateEnum
CREATE TYPE "ProductUnitStatus" AS ENUM ('PACKED', 'IN_STOCK', 'ALLOCATED', 'DISPATCHED', 'RETURNED', 'QUARANTINED', 'REWORK', 'SCRAPPED');

-- CreateEnum
CREATE TYPE "CustomerReturnStatus" AS ENUM ('RECEIVED', 'INSPECTED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReturnCondition" AS ENUM ('GOOD', 'DAMAGED', 'DEFECTIVE', 'WRONG_ITEM');

-- CreateEnum
CREATE TYPE "ReturnDisposition" AS ENUM ('RESTOCK', 'REWORK', 'QUARANTINE', 'SCRAP');

-- AlterEnum
ALTER TYPE "BarcodeEntityType" ADD VALUE 'PRODUCT_UNIT';

-- AlterEnum
ALTER TYPE "DocumentType" ADD VALUE 'PRODUCT_UNIT';
ALTER TYPE "DocumentType" ADD VALUE 'CUSTOMER_RETURN';

-- AlterEnum
ALTER TYPE "InventoryTransactionType" ADD VALUE 'CUSTOMER_RETURN';

-- AlterEnum
ALTER TYPE "RelatedModule" ADD VALUE 'CUSTOMER_RETURN';

-- CreateTable
CREATE TABLE "product_units" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "unit_code" TEXT NOT NULL,
    "product_id" UUID NOT NULL,
    "product_variant_id" UUID NOT NULL,
    "production_order_id" UUID NOT NULL,
    "lot_id" UUID NOT NULL,
    "sales_order_id" UUID,
    "sales_order_item_id" UUID,
    "sales_order_line_id" UUID,
    "carton_id" UUID,
    "dispatch_id" UUID,
    "dispatch_item_id" UUID,
    "status" "ProductUnitStatus" NOT NULL DEFAULT 'PACKED',
    "current_warehouse_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_unit_events" (
    "id" UUID NOT NULL,
    "product_unit_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "from_status" "ProductUnitStatus",
    "to_status" "ProductUnitStatus" NOT NULL,
    "location_id" UUID,
    "reference_type" TEXT,
    "reference_id" UUID,
    "remarks" TEXT,
    "actor_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_unit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_returns" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "return_number" TEXT NOT NULL,
    "sales_order_id" UUID,
    "customer_id" UUID NOT NULL,
    "status" "CustomerReturnStatus" NOT NULL DEFAULT 'RECEIVED',
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "received_by_id" UUID NOT NULL,
    "remarks" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_return_items" (
    "id" UUID NOT NULL,
    "customer_return_id" UUID NOT NULL,
    "product_unit_id" UUID NOT NULL,
    "return_reason" TEXT NOT NULL,
    "condition" "ReturnCondition" NOT NULL DEFAULT 'GOOD',
    "disposition" "ReturnDisposition" NOT NULL DEFAULT 'RESTOCK',
    "restock_warehouse_id" UUID,
    "inspected_at" TIMESTAMP(3),
    "inspected_by_id" UUID,
    "remarks" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_return_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_units_lot_id_idx" ON "product_units"("lot_id");

-- CreateIndex
CREATE INDEX "product_units_dispatch_id_idx" ON "product_units"("dispatch_id");

-- CreateIndex
CREATE INDEX "product_units_carton_id_idx" ON "product_units"("carton_id");

-- CreateIndex
CREATE INDEX "product_units_product_variant_id_idx" ON "product_units"("product_variant_id");

-- CreateIndex
CREATE INDEX "product_units_status_idx" ON "product_units"("status");

-- CreateIndex
CREATE UNIQUE INDEX "product_units_company_id_unit_code_key" ON "product_units"("company_id", "unit_code");

-- CreateIndex
CREATE INDEX "product_unit_events_product_unit_id_idx" ON "product_unit_events"("product_unit_id");

-- CreateIndex
CREATE INDEX "customer_returns_customer_id_idx" ON "customer_returns"("customer_id");

-- CreateIndex
CREATE INDEX "customer_returns_sales_order_id_idx" ON "customer_returns"("sales_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_returns_company_id_return_number_key" ON "customer_returns"("company_id", "return_number");

-- CreateIndex
CREATE INDEX "customer_return_items_customer_return_id_idx" ON "customer_return_items"("customer_return_id");

-- CreateIndex
CREATE INDEX "customer_return_items_product_unit_id_idx" ON "customer_return_items"("product_unit_id");

-- AddForeignKey
ALTER TABLE "product_units" ADD CONSTRAINT "product_units_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_units" ADD CONSTRAINT "product_units_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_units" ADD CONSTRAINT "product_units_product_variant_id_fkey" FOREIGN KEY ("product_variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_units" ADD CONSTRAINT "product_units_production_order_id_fkey" FOREIGN KEY ("production_order_id") REFERENCES "production_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_units" ADD CONSTRAINT "product_units_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_units" ADD CONSTRAINT "product_units_sales_order_id_fkey" FOREIGN KEY ("sales_order_id") REFERENCES "sales_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_units" ADD CONSTRAINT "product_units_sales_order_item_id_fkey" FOREIGN KEY ("sales_order_item_id") REFERENCES "sales_order_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_units" ADD CONSTRAINT "product_units_sales_order_line_id_fkey" FOREIGN KEY ("sales_order_line_id") REFERENCES "sales_order_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_units" ADD CONSTRAINT "product_units_carton_id_fkey" FOREIGN KEY ("carton_id") REFERENCES "cartons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_units" ADD CONSTRAINT "product_units_dispatch_id_fkey" FOREIGN KEY ("dispatch_id") REFERENCES "dispatches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_units" ADD CONSTRAINT "product_units_dispatch_item_id_fkey" FOREIGN KEY ("dispatch_item_id") REFERENCES "dispatch_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_units" ADD CONSTRAINT "product_units_current_warehouse_id_fkey" FOREIGN KEY ("current_warehouse_id") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_unit_events" ADD CONSTRAINT "product_unit_events_product_unit_id_fkey" FOREIGN KEY ("product_unit_id") REFERENCES "product_units"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_returns" ADD CONSTRAINT "customer_returns_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_returns" ADD CONSTRAINT "customer_returns_sales_order_id_fkey" FOREIGN KEY ("sales_order_id") REFERENCES "sales_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_returns" ADD CONSTRAINT "customer_returns_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_returns" ADD CONSTRAINT "customer_returns_received_by_id_fkey" FOREIGN KEY ("received_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_return_items" ADD CONSTRAINT "customer_return_items_customer_return_id_fkey" FOREIGN KEY ("customer_return_id") REFERENCES "customer_returns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_return_items" ADD CONSTRAINT "customer_return_items_product_unit_id_fkey" FOREIGN KEY ("product_unit_id") REFERENCES "product_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_return_items" ADD CONSTRAINT "customer_return_items_restock_warehouse_id_fkey" FOREIGN KEY ("restock_warehouse_id") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_return_items" ADD CONSTRAINT "customer_return_items_inspected_by_id_fkey" FOREIGN KEY ("inspected_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
