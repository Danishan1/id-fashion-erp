-- CreateEnum
CREATE TYPE "FinishedGoodsReservationStatus" AS ENUM ('ACTIVE', 'RELEASED', 'FULFILLED');

-- CreateTable
CREATE TABLE "finished_goods_reservations" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "branch_id" UUID,
    "sales_order_line_id" UUID NOT NULL,
    "product_variant_id" UUID NOT NULL,
    "warehouse_id" UUID,
    "reserved_quantity" DECIMAL(18,4) NOT NULL,
    "consumed_quantity" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "status" "FinishedGoodsReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "finished_goods_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "finished_goods_reservations_company_id_product_variant_id_w_idx" ON "finished_goods_reservations"("company_id", "product_variant_id", "warehouse_id", "status");

-- CreateIndex
CREATE INDEX "finished_goods_reservations_sales_order_line_id_idx" ON "finished_goods_reservations"("sales_order_line_id");

-- AddForeignKey
ALTER TABLE "finished_goods_reservations" ADD CONSTRAINT "finished_goods_reservations_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finished_goods_reservations" ADD CONSTRAINT "finished_goods_reservations_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finished_goods_reservations" ADD CONSTRAINT "finished_goods_reservations_sales_order_line_id_fkey" FOREIGN KEY ("sales_order_line_id") REFERENCES "sales_order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finished_goods_reservations" ADD CONSTRAINT "finished_goods_reservations_product_variant_id_fkey" FOREIGN KEY ("product_variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finished_goods_reservations" ADD CONSTRAINT "finished_goods_reservations_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

