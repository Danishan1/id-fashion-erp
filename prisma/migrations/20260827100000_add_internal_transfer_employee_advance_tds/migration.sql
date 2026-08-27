-- CreateEnum
CREATE TYPE "InternalTransferStatus" AS ENUM ('DRAFT', 'POSTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EmployeeAdvanceStatus" AS ENUM ('ISSUED', 'PARTIALLY_SETTLED', 'SETTLED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "DocumentType" ADD VALUE 'INTERNAL_TRANSFER';
ALTER TYPE "DocumentType" ADD VALUE 'EMPLOYEE_ADVANCE';
ALTER TYPE "DocumentType" ADD VALUE 'EMPLOYEE_ADVANCE_SETTLEMENT';

-- AlterTable
ALTER TABLE "expenses" ADD COLUMN     "tds_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "tds_percentage" DECIMAL(5,2);

-- CreateTable
CREATE TABLE "internal_transfers" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "branch_id" UUID,
    "transfer_number" TEXT NOT NULL,
    "transfer_date" DATE NOT NULL,
    "from_payment_type_id" UUID NOT NULL,
    "from_bank_account_id" UUID,
    "to_payment_type_id" UUID NOT NULL,
    "to_bank_account_id" UUID,
    "amount" DECIMAL(18,2) NOT NULL,
    "narration" TEXT,
    "status" "InternalTransferStatus" NOT NULL DEFAULT 'DRAFT',
    "journal_id" UUID,
    "posted_at" TIMESTAMP(3),
    "posted_by_user_id" UUID,
    "created_by_user_id" UUID NOT NULL,
    "idempotency_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "internal_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_advances" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "branch_id" UUID,
    "advance_number" TEXT NOT NULL,
    "advance_date" DATE NOT NULL,
    "employee_id" UUID NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "payment_type_id" UUID NOT NULL,
    "bank_account_id" UUID,
    "purpose" TEXT,
    "settled_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "status" "EmployeeAdvanceStatus" NOT NULL DEFAULT 'ISSUED',
    "journal_id" UUID,
    "posted_at" TIMESTAMP(3),
    "created_by_user_id" UUID NOT NULL,
    "idempotency_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_advances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_advance_settlements" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "employee_advance_id" UUID NOT NULL,
    "settlement_number" TEXT NOT NULL,
    "settlement_date" DATE NOT NULL,
    "expense_account_id" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "tax_rate_id" UUID,
    "tax_percentage" DECIMAL(5,2),
    "tax_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(18,2) NOT NULL,
    "status" "ExpenseStatus" NOT NULL DEFAULT 'DRAFT',
    "journal_id" UUID,
    "posted_at" TIMESTAMP(3),
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_advance_settlements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "internal_transfers_journal_id_key" ON "internal_transfers"("journal_id");

-- CreateIndex
CREATE INDEX "internal_transfers_company_id_status_idx" ON "internal_transfers"("company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "internal_transfers_company_id_branch_id_transfer_number_key" ON "internal_transfers"("company_id", "branch_id", "transfer_number");

-- CreateIndex
CREATE UNIQUE INDEX "internal_transfers_company_id_idempotency_key_key" ON "internal_transfers"("company_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "employee_advances_journal_id_key" ON "employee_advances"("journal_id");

-- CreateIndex
CREATE INDEX "employee_advances_company_id_status_idx" ON "employee_advances"("company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "employee_advances_company_id_branch_id_advance_number_key" ON "employee_advances"("company_id", "branch_id", "advance_number");

-- CreateIndex
CREATE UNIQUE INDEX "employee_advances_company_id_idempotency_key_key" ON "employee_advances"("company_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "employee_advance_settlements_journal_id_key" ON "employee_advance_settlements"("journal_id");

-- CreateIndex
CREATE INDEX "employee_advance_settlements_employee_advance_id_idx" ON "employee_advance_settlements"("employee_advance_id");

-- CreateIndex
CREATE UNIQUE INDEX "employee_advance_settlements_company_id_settlement_number_key" ON "employee_advance_settlements"("company_id", "settlement_number");

-- AddForeignKey
ALTER TABLE "internal_transfers" ADD CONSTRAINT "internal_transfers_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_transfers" ADD CONSTRAINT "internal_transfers_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_transfers" ADD CONSTRAINT "internal_transfers_from_payment_type_id_fkey" FOREIGN KEY ("from_payment_type_id") REFERENCES "payment_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_transfers" ADD CONSTRAINT "internal_transfers_to_payment_type_id_fkey" FOREIGN KEY ("to_payment_type_id") REFERENCES "payment_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_transfers" ADD CONSTRAINT "internal_transfers_from_bank_account_id_fkey" FOREIGN KEY ("from_bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_transfers" ADD CONSTRAINT "internal_transfers_to_bank_account_id_fkey" FOREIGN KEY ("to_bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_transfers" ADD CONSTRAINT "internal_transfers_journal_id_fkey" FOREIGN KEY ("journal_id") REFERENCES "journals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_transfers" ADD CONSTRAINT "internal_transfers_posted_by_user_id_fkey" FOREIGN KEY ("posted_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_transfers" ADD CONSTRAINT "internal_transfers_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_advances" ADD CONSTRAINT "employee_advances_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_advances" ADD CONSTRAINT "employee_advances_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_advances" ADD CONSTRAINT "employee_advances_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_advances" ADD CONSTRAINT "employee_advances_payment_type_id_fkey" FOREIGN KEY ("payment_type_id") REFERENCES "payment_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_advances" ADD CONSTRAINT "employee_advances_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_advances" ADD CONSTRAINT "employee_advances_journal_id_fkey" FOREIGN KEY ("journal_id") REFERENCES "journals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_advances" ADD CONSTRAINT "employee_advances_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_advance_settlements" ADD CONSTRAINT "employee_advance_settlements_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_advance_settlements" ADD CONSTRAINT "employee_advance_settlements_employee_advance_id_fkey" FOREIGN KEY ("employee_advance_id") REFERENCES "employee_advances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_advance_settlements" ADD CONSTRAINT "employee_advance_settlements_expense_account_id_fkey" FOREIGN KEY ("expense_account_id") REFERENCES "chart_of_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_advance_settlements" ADD CONSTRAINT "employee_advance_settlements_tax_rate_id_fkey" FOREIGN KEY ("tax_rate_id") REFERENCES "tax_rates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_advance_settlements" ADD CONSTRAINT "employee_advance_settlements_journal_id_fkey" FOREIGN KEY ("journal_id") REFERENCES "journals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_advance_settlements" ADD CONSTRAINT "employee_advance_settlements_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
