-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE');

-- CreateEnum
CREATE TYPE "JournalStatus" AS ENUM ('DRAFT', 'POSTED', 'CANCELLED');

-- CreateTable
CREATE TABLE "chart_of_accounts" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "account_type" "AccountType" NOT NULL,
    "parent_account_id" UUID,
    "is_system_account" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chart_of_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_types" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_rates" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "tax_type_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "rate_percentage" DECIMAL(5,2) NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journals" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "branch_id" UUID,
    "journal_number" TEXT NOT NULL,
    "journal_date" DATE NOT NULL,
    "status" "JournalStatus" NOT NULL DEFAULT 'DRAFT',
    "narration" TEXT,
    "source_module" "RelatedModule",
    "source_record_id" UUID,
    "total_debit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "total_credit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "posted_at" TIMESTAMP(3),
    "posted_by_user_id" UUID,
    "created_by_user_id" UUID NOT NULL,
    "reversal_of_journal_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "journals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_lines" (
    "id" UUID NOT NULL,
    "journal_id" UUID NOT NULL,
    "line_number" INTEGER NOT NULL,
    "account_id" UUID NOT NULL,
    "debit_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "credit_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journal_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "chart_of_accounts_company_id_code_key" ON "chart_of_accounts"("company_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "tax_types_company_id_code_key" ON "tax_types"("company_id", "code");

-- CreateIndex
CREATE INDEX "tax_rates_tax_type_id_idx" ON "tax_rates"("tax_type_id");

-- CreateIndex
CREATE UNIQUE INDEX "journals_reversal_of_journal_id_key" ON "journals"("reversal_of_journal_id");

-- CreateIndex
CREATE UNIQUE INDEX "journals_company_id_journal_number_key" ON "journals"("company_id", "journal_number");

-- CreateIndex
CREATE INDEX "journal_lines_journal_id_idx" ON "journal_lines"("journal_id");

-- CreateIndex
CREATE INDEX "journal_lines_account_id_idx" ON "journal_lines"("account_id");

-- AddForeignKey
ALTER TABLE "chart_of_accounts" ADD CONSTRAINT "chart_of_accounts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chart_of_accounts" ADD CONSTRAINT "chart_of_accounts_parent_account_id_fkey" FOREIGN KEY ("parent_account_id") REFERENCES "chart_of_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_types" ADD CONSTRAINT "tax_types_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_rates" ADD CONSTRAINT "tax_rates_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_rates" ADD CONSTRAINT "tax_rates_tax_type_id_fkey" FOREIGN KEY ("tax_type_id") REFERENCES "tax_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journals" ADD CONSTRAINT "journals_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journals" ADD CONSTRAINT "journals_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journals" ADD CONSTRAINT "journals_posted_by_user_id_fkey" FOREIGN KEY ("posted_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journals" ADD CONSTRAINT "journals_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journals" ADD CONSTRAINT "journals_reversal_of_journal_id_fkey" FOREIGN KEY ("reversal_of_journal_id") REFERENCES "journals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_journal_id_fkey" FOREIGN KEY ("journal_id") REFERENCES "journals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "chart_of_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-added: the service layer is the primary correctness mechanism (never
-- both debit and credit non-zero on one line, never negative), matching the
-- job_orders_quantity_consistency_check precedent — these CHECKs are the hard
-- backstop against any future direct-SQL mistake bypassing that layer.
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_amounts_non_negative_check"
  CHECK (debit_amount >= 0 AND credit_amount >= 0);
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_one_side_only_check"
  CHECK (NOT (debit_amount > 0 AND credit_amount > 0));
