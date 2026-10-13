-- CreateEnum
CREATE TYPE "StockStatus" AS ENUM ('SALEABLE', 'REJECTED');

-- AlterTable
ALTER TABLE "inventory_transactions" ADD COLUMN     "product_variant_id" UUID,
ADD COLUMN     "stock_status" "StockStatus";

-- CreateIndex
CREATE INDEX "inventory_transactions_product_variant_id_idx" ON "inventory_transactions"("product_variant_id");

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_product_variant_id_fkey" FOREIGN KEY ("product_variant_id") REFERENCES "product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

