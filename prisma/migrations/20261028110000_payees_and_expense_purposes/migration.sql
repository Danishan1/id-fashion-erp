-- Payee and Purpose masters (2026-10-28). Additive only.
-- The unrelated sample_requests.color drift line from migrate diff is deliberately left out (see CLAUDE.md).

-- CreateEnum
CREATE TYPE "PayeeType" AS ENUM ('INDIVIDUAL', 'BUSINESS', 'GOVERNMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "ExpensePurposeGroup" AS ENUM ('EXPENDITURE', 'VOUCHER', 'LOAN', 'INVESTMENT');

ALTER TABLE "payment_requests" ADD COLUMN     "payee_id" UUID;

-- CreateTable
CREATE TABLE "payees" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "payee_type" "PayeeType" NOT NULL DEFAULT 'INDIVIDUAL',
    "gstin" TEXT,
    "state_code" VARCHAR(2),
    "pan" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "bank_account_name" TEXT,
    "bank_account_no" TEXT,
    "ifsc_code" TEXT,
    "upi_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_purposes" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "purpose_group" "ExpensePurposeGroup" NOT NULL,
    "parent_id" UUID,
    "expense_account_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expense_purposes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payees_company_id_code_key" ON "payees"("company_id", "code");

-- CreateIndex
CREATE INDEX "expense_purposes_company_id_purpose_group_idx" ON "expense_purposes"("company_id", "purpose_group");

-- CreateIndex
CREATE UNIQUE INDEX "expense_purposes_company_id_code_key" ON "expense_purposes"("company_id", "code");

-- AddForeignKey
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_payee_id_fkey" FOREIGN KEY ("payee_id") REFERENCES "payees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payees" ADD CONSTRAINT "payees_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_purposes" ADD CONSTRAINT "expense_purposes_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_purposes" ADD CONSTRAINT "expense_purposes_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "expense_purposes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_purposes" ADD CONSTRAINT "expense_purposes_expense_account_id_fkey" FOREIGN KEY ("expense_account_id") REFERENCES "chart_of_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Hand-added: a purpose can not be its own parent.
ALTER TABLE "expense_purposes" ADD CONSTRAINT "expense_purposes_not_own_parent_check" CHECK ("parent_id" IS NULL OR "parent_id" <> "id");
