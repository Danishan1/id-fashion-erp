-- CreateTable
CREATE TABLE "dispatch_returns" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "dispatch_id" UUID NOT NULL,
    "return_number" TEXT NOT NULL,
    "remarks" TEXT NOT NULL,
    "total_quantity" INTEGER NOT NULL,
    "returned_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "dispatch_returns_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "dispatch_return_items" (
    "id" UUID NOT NULL,
    "dispatch_return_id" UUID NOT NULL,
    "dispatch_item_id" UUID NOT NULL,
    "pick_line_id" UUID,
    "product_variant_id" UUID,
    "warehouse_location_id" UUID,
    "quantity" INTEGER NOT NULL,
    "regular_quantity" INTEGER NOT NULL,
    "remark" TEXT,
    CONSTRAINT "dispatch_return_items_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE INDEX "dispatch_returns_dispatch_id_idx" ON "dispatch_returns"("dispatch_id");
-- CreateIndex
CREATE INDEX "dispatch_return_items_dispatch_return_id_idx" ON "dispatch_return_items"("dispatch_return_id");
-- CreateIndex
CREATE INDEX "dispatch_return_items_dispatch_item_id_idx" ON "dispatch_return_items"("dispatch_item_id");
-- CreateIndex
CREATE INDEX "dispatch_return_items_pick_line_id_idx" ON "dispatch_return_items"("pick_line_id");
-- AddForeignKey
ALTER TABLE "dispatch_returns" ADD CONSTRAINT "dispatch_returns_dispatch_id_fkey" FOREIGN KEY ("dispatch_id") REFERENCES "dispatches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "dispatch_return_items" ADD CONSTRAINT "dispatch_return_items_dispatch_return_id_fkey" FOREIGN KEY ("dispatch_return_id") REFERENCES "dispatch_returns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "dispatch_return_items" ADD CONSTRAINT "dispatch_return_items_dispatch_item_id_fkey" FOREIGN KEY ("dispatch_item_id") REFERENCES "dispatch_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "dispatch_return_items" ADD CONSTRAINT "dispatch_return_items_pick_line_id_fkey" FOREIGN KEY ("pick_line_id") REFERENCES "finished_goods_pick_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;
