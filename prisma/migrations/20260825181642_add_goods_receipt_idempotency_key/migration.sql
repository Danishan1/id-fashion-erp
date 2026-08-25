-- AlterTable
ALTER TABLE "goods_receipts" ADD COLUMN     "idempotency_key" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "goods_receipts_company_id_idempotency_key_key" ON "goods_receipts"("company_id", "idempotency_key");

