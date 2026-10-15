-- CreateTable
CREATE TABLE "finished_goods_pick_lines" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "dispatch_item_id" UUID NOT NULL,
    "product_variant_id" UUID NOT NULL,
    "warehouse_location_id" UUID NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "picked_by_user_id" UUID NOT NULL,
    "picked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "finished_goods_pick_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "finished_goods_pick_lines_dispatch_item_id_idx" ON "finished_goods_pick_lines"("dispatch_item_id");

-- CreateIndex
CREATE INDEX "finished_goods_pick_lines_product_variant_id_warehouse_loca_idx" ON "finished_goods_pick_lines"("product_variant_id", "warehouse_location_id");

-- AddForeignKey
ALTER TABLE "finished_goods_pick_lines" ADD CONSTRAINT "finished_goods_pick_lines_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finished_goods_pick_lines" ADD CONSTRAINT "finished_goods_pick_lines_dispatch_item_id_fkey" FOREIGN KEY ("dispatch_item_id") REFERENCES "dispatch_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finished_goods_pick_lines" ADD CONSTRAINT "finished_goods_pick_lines_product_variant_id_fkey" FOREIGN KEY ("product_variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finished_goods_pick_lines" ADD CONSTRAINT "finished_goods_pick_lines_warehouse_location_id_fkey" FOREIGN KEY ("warehouse_location_id") REFERENCES "warehouse_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finished_goods_pick_lines" ADD CONSTRAINT "finished_goods_pick_lines_picked_by_user_id_fkey" FOREIGN KEY ("picked_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

