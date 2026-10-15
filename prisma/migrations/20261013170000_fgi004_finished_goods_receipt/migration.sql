-- AlterEnum
ALTER TYPE "DocumentType" ADD VALUE 'FG_RECEIPT';

-- AlterEnum
ALTER TYPE "RelatedModule" ADD VALUE 'FINISHED_GOODS_RECEIPT';

-- CreateTable
CREATE TABLE "finished_goods_receipts" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "branch_id" UUID,
    "receipt_number" TEXT NOT NULL,
    "product_id" UUID NOT NULL,
    "lot_id" UUID NOT NULL,
    "job_order_id" UUID NOT NULL,
    "production_order_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "total_quantity" DECIMAL(18,4) NOT NULL,
    "posted_by_user_id" UUID NOT NULL,
    "posted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "finished_goods_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finished_goods_receipt_items" (
    "id" UUID NOT NULL,
    "finished_goods_receipt_id" UUID NOT NULL,
    "product_variant_id" UUID NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "inventory_transaction_id" UUID,

    CONSTRAINT "finished_goods_receipt_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "finished_goods_receipts_lot_id_idx" ON "finished_goods_receipts"("lot_id");

-- CreateIndex
CREATE INDEX "finished_goods_receipts_job_order_id_idx" ON "finished_goods_receipts"("job_order_id");

-- CreateIndex
CREATE INDEX "finished_goods_receipts_production_order_id_idx" ON "finished_goods_receipts"("production_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "finished_goods_receipts_company_id_branch_id_receipt_number_key" ON "finished_goods_receipts"("company_id", "branch_id", "receipt_number");

-- CreateIndex
CREATE INDEX "finished_goods_receipt_items_finished_goods_receipt_id_idx" ON "finished_goods_receipt_items"("finished_goods_receipt_id");

-- AddForeignKey
ALTER TABLE "finished_goods_receipts" ADD CONSTRAINT "finished_goods_receipts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finished_goods_receipts" ADD CONSTRAINT "finished_goods_receipts_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finished_goods_receipts" ADD CONSTRAINT "finished_goods_receipts_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finished_goods_receipts" ADD CONSTRAINT "finished_goods_receipts_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finished_goods_receipts" ADD CONSTRAINT "finished_goods_receipts_job_order_id_fkey" FOREIGN KEY ("job_order_id") REFERENCES "job_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finished_goods_receipts" ADD CONSTRAINT "finished_goods_receipts_production_order_id_fkey" FOREIGN KEY ("production_order_id") REFERENCES "production_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finished_goods_receipts" ADD CONSTRAINT "finished_goods_receipts_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finished_goods_receipts" ADD CONSTRAINT "finished_goods_receipts_posted_by_user_id_fkey" FOREIGN KEY ("posted_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finished_goods_receipt_items" ADD CONSTRAINT "finished_goods_receipt_items_finished_goods_receipt_id_fkey" FOREIGN KEY ("finished_goods_receipt_id") REFERENCES "finished_goods_receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finished_goods_receipt_items" ADD CONSTRAINT "finished_goods_receipt_items_product_variant_id_fkey" FOREIGN KEY ("product_variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finished_goods_receipt_items" ADD CONSTRAINT "finished_goods_receipt_items_inventory_transaction_id_fkey" FOREIGN KEY ("inventory_transaction_id") REFERENCES "inventory_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

