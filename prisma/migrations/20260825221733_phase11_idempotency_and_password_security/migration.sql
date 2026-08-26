-- AlterEnum
ALTER TYPE "DocumentType" ADD VALUE 'JOB_WORK_RECEIPT';

-- AlterTable
ALTER TABLE "expenses" ADD COLUMN     "idempotency_key" TEXT;

-- AlterTable
ALTER TABLE "job_work_receipts" ADD COLUMN     "idempotency_key" TEXT;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "idempotency_key" TEXT;

-- AlterTable
ALTER TABLE "purchase_invoices" ADD COLUMN     "idempotency_key" TEXT;

-- AlterTable
ALTER TABLE "sales_invoices" ADD COLUMN     "idempotency_key" TEXT;

-- AlterTable
ALTER TABLE "stock_movements" ADD COLUMN     "idempotency_key" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "password_changed_at" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "expenses_company_id_idempotency_key_key" ON "expenses"("company_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "job_work_receipts_company_id_idempotency_key_key" ON "job_work_receipts"("company_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "payments_company_id_idempotency_key_key" ON "payments"("company_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_invoices_company_id_idempotency_key_key" ON "purchase_invoices"("company_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "sales_invoices_company_id_idempotency_key_key" ON "sales_invoices"("company_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "stock_movements_company_id_idempotency_key_key" ON "stock_movements"("company_id", "idempotency_key");

