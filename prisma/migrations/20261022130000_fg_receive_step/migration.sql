-- CreateEnum
CREATE TYPE "FinishedGoodsReceiptSource" AS ENUM ('PRODUCTION', 'CUSTOMER_RETURN');

-- CreateEnum
CREATE TYPE "FinishedGoodsReceiptStatus" AS ENUM ('PENDING', 'PARTIALLY_RECEIVED', 'RECEIVED');

-- AlterTable
ALTER TABLE "finished_goods_receipt_items" ADD COLUMN     "received_quantity" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "suggested_location_id" UUID,
ALTER COLUMN "product_variant_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "finished_goods_receipts" ADD COLUMN     "dispatch_id" UUID,
ADD COLUMN     "dispatch_return_id" UUID,
ADD COLUMN     "received_at" TIMESTAMP(3),
ADD COLUMN     "remarks" TEXT,
ADD COLUMN     "source" "FinishedGoodsReceiptSource" NOT NULL DEFAULT 'PRODUCTION',
ADD COLUMN     "status" "FinishedGoodsReceiptStatus" NOT NULL DEFAULT 'RECEIVED',
ALTER COLUMN "lot_id" DROP NOT NULL,
ALTER COLUMN "job_order_id" DROP NOT NULL,
ALTER COLUMN "production_order_id" DROP NOT NULL;

-- CreateTable
CREATE TABLE "finished_goods_receipt_postings" (
    "id" UUID NOT NULL,
    "finished_goods_receipt_id" UUID NOT NULL,
    "receipt_item_id" UUID NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "warehouse_location_id" UUID,
    "inventory_transaction_id" UUID NOT NULL,
    "received_by_user_id" UUID NOT NULL,
    "remarks" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "finished_goods_receipt_postings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "finished_goods_receipt_postings_finished_goods_receipt_id_idx" ON "finished_goods_receipt_postings"("finished_goods_receipt_id");

-- CreateIndex
CREATE INDEX "finished_goods_receipt_postings_receipt_item_id_idx" ON "finished_goods_receipt_postings"("receipt_item_id");

-- AddForeignKey
ALTER TABLE "finished_goods_receipts" ADD CONSTRAINT "finished_goods_receipts_dispatch_id_fkey" FOREIGN KEY ("dispatch_id") REFERENCES "dispatches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finished_goods_receipts" ADD CONSTRAINT "finished_goods_receipts_dispatch_return_id_fkey" FOREIGN KEY ("dispatch_return_id") REFERENCES "dispatch_returns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finished_goods_receipt_postings" ADD CONSTRAINT "finished_goods_receipt_postings_finished_goods_receipt_id_fkey" FOREIGN KEY ("finished_goods_receipt_id") REFERENCES "finished_goods_receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finished_goods_receipt_postings" ADD CONSTRAINT "finished_goods_receipt_postings_receipt_item_id_fkey" FOREIGN KEY ("receipt_item_id") REFERENCES "finished_goods_receipt_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finished_goods_receipt_postings" ADD CONSTRAINT "finished_goods_receipt_postings_warehouse_location_id_fkey" FOREIGN KEY ("warehouse_location_id") REFERENCES "warehouse_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finished_goods_receipt_postings" ADD CONSTRAINT "finished_goods_receipt_postings_received_by_user_id_fkey" FOREIGN KEY ("received_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Receipts created before the receive step were posted straight to stock:
-- every line counts as fully received.
UPDATE "finished_goods_receipt_items" SET "received_quantity" = "quantity";
UPDATE "finished_goods_receipts" SET "received_at" = "posted_at" WHERE "status" = 'RECEIVED' AND "received_at" IS NULL;
