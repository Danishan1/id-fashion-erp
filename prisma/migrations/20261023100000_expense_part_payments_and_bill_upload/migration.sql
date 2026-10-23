-- CreateEnum
CREATE TYPE "ExpenseSource" AS ENUM ('STANDARD', 'BILL_UPLOAD');

-- AlterEnum
ALTER TYPE "DocumentType" ADD VALUE 'EXPENSE_PAYMENT';

-- AlterEnum
ALTER TYPE "ExpenseApprovalStatus" ADD VALUE 'PARTIALLY_PAID';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "RelatedModule" ADD VALUE 'EXPENSE_PAYMENT';
ALTER TYPE "RelatedModule" ADD VALUE 'EMPLOYEE_ADVANCE';
ALTER TYPE "RelatedModule" ADD VALUE 'INTERNAL_TRANSFER';

-- DropForeignKey
ALTER TABLE "expenses" DROP CONSTRAINT "expenses_account_id_fkey";

-- DropForeignKey
ALTER TABLE "expenses" DROP CONSTRAINT "expenses_payment_type_id_fkey";

-- AlterTable
ALTER TABLE "expenses" ADD COLUMN     "paid_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "source" "ExpenseSource" NOT NULL DEFAULT 'STANDARD',
ALTER COLUMN "account_id" DROP NOT NULL,
ALTER COLUMN "payment_type_id" DROP NOT NULL;

-- AlterTable

-- CreateTable
CREATE TABLE "expense_payments" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "branch_id" UUID,
    "expense_id" UUID NOT NULL,
    "payment_number" TEXT NOT NULL,
    "payment_date" DATE NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "payment_type_id" UUID NOT NULL,
    "bank_account_id" UUID,
    "reference_number" TEXT,
    "notes" TEXT,
    "journal_id" UUID NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "idempotency_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expense_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "expense_payments_journal_id_key" ON "expense_payments"("journal_id");

-- CreateIndex
CREATE INDEX "expense_payments_expense_id_idx" ON "expense_payments"("expense_id");

-- CreateIndex
CREATE UNIQUE INDEX "expense_payments_company_id_branch_id_payment_number_key" ON "expense_payments"("company_id", "branch_id", "payment_number");

-- CreateIndex
CREATE UNIQUE INDEX "expense_payments_company_id_idempotency_key_key" ON "expense_payments"("company_id", "idempotency_key");

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "chart_of_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_payment_type_id_fkey" FOREIGN KEY ("payment_type_id") REFERENCES "payment_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_payments" ADD CONSTRAINT "expense_payments_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_payments" ADD CONSTRAINT "expense_payments_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_payments" ADD CONSTRAINT "expense_payments_expense_id_fkey" FOREIGN KEY ("expense_id") REFERENCES "expenses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_payments" ADD CONSTRAINT "expense_payments_payment_type_id_fkey" FOREIGN KEY ("payment_type_id") REFERENCES "payment_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_payments" ADD CONSTRAINT "expense_payments_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_payments" ADD CONSTRAINT "expense_payments_journal_id_fkey" FOREIGN KEY ("journal_id") REFERENCES "journals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_payments" ADD CONSTRAINT "expense_payments_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Backfill: an expense already PAID the old one-shot way has paid its whole net payable.
UPDATE "expenses" SET "paid_amount" = "total_amount" - "tds_amount" WHERE "status" = 'PAID';
