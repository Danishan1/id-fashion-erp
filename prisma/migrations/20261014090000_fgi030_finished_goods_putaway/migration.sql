-- AlterEnum
ALTER TYPE "DocumentType" ADD VALUE 'FG_PUTAWAY';

-- AlterEnum
ALTER TYPE "RelatedModule" ADD VALUE 'FINISHED_GOODS_PUTAWAY';

-- CreateTable
CREATE TABLE "finished_goods_putaways" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "branch_id" UUID,
    "putaway_number" TEXT NOT NULL,
    "product_id" UUID NOT NULL,
    "product_variant_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "stock_status" "StockStatus" NOT NULL,
    "total_quantity" DECIMAL(18,4) NOT NULL,
    "performed_by_user_id" UUID NOT NULL,
    "performed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "finished_goods_putaways_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finished_goods_putaway_items" (
    "id" UUID NOT NULL,
    "finished_goods_putaway_id" UUID NOT NULL,
    "warehouse_location_id" UUID NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "inventory_transaction_id" UUID,

    CONSTRAINT "finished_goods_putaway_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "finished_goods_putaways_company_id_product_id_warehouse_id_idx" ON "finished_goods_putaways"("company_id", "product_id", "warehouse_id");

-- CreateIndex
CREATE UNIQUE INDEX "finished_goods_putaways_company_id_branch_id_putaway_number_key" ON "finished_goods_putaways"("company_id", "branch_id", "putaway_number");

-- CreateIndex
CREATE INDEX "finished_goods_putaway_items_finished_goods_putaway_id_idx" ON "finished_goods_putaway_items"("finished_goods_putaway_id");

-- AddForeignKey
ALTER TABLE "finished_goods_putaways" ADD CONSTRAINT "finished_goods_putaways_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finished_goods_putaways" ADD CONSTRAINT "finished_goods_putaways_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finished_goods_putaways" ADD CONSTRAINT "finished_goods_putaways_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finished_goods_putaways" ADD CONSTRAINT "finished_goods_putaways_product_variant_id_fkey" FOREIGN KEY ("product_variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finished_goods_putaways" ADD CONSTRAINT "finished_goods_putaways_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finished_goods_putaways" ADD CONSTRAINT "finished_goods_putaways_performed_by_user_id_fkey" FOREIGN KEY ("performed_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finished_goods_putaway_items" ADD CONSTRAINT "finished_goods_putaway_items_finished_goods_putaway_id_fkey" FOREIGN KEY ("finished_goods_putaway_id") REFERENCES "finished_goods_putaways"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finished_goods_putaway_items" ADD CONSTRAINT "finished_goods_putaway_items_warehouse_location_id_fkey" FOREIGN KEY ("warehouse_location_id") REFERENCES "warehouse_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finished_goods_putaway_items" ADD CONSTRAINT "finished_goods_putaway_items_inventory_transaction_id_fkey" FOREIGN KEY ("inventory_transaction_id") REFERENCES "inventory_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

