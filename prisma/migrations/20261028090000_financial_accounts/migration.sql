-- Financial accounts (2026-10-28): account kind + one ledger account per bank account.
-- The unrelated sample_requests.color drift line from migrate diff is deliberately left out (see CLAUDE.md).

-- CreateEnum
CREATE TYPE "FinancialAccountKind" AS ENUM ('CURRENT', 'SAVINGS', 'CASH', 'FIXED_DEPOSIT', 'RECURRING_DEPOSIT', 'CREDIT_CARD', 'LOAN_GIVEN', 'INVESTMENT');

ALTER TABLE "bank_accounts" ADD COLUMN     "account_kind" "FinancialAccountKind" NOT NULL DEFAULT 'CURRENT',
ADD COLUMN     "credit_limit" DECIMAL(18,2),
ADD COLUMN     "interest_rate" DECIMAL(5,2),
ADD COLUMN     "ledger_account_id" UUID,
ADD COLUMN     "maturity_date" DATE,
ALTER COLUMN "bank_name" DROP NOT NULL,
ALTER COLUMN "account_number" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "bank_accounts_ledger_account_id_key" ON "bank_accounts"("ledger_account_id");

-- AddForeignKey
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_ledger_account_id_fkey" FOREIGN KEY ("ledger_account_id") REFERENCES "chart_of_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Backfill: every existing bank account gets its own ledger account under the
-- company's BANK control account (code BANK-<bank code>). No journal is moved:
-- balances posted before today stay on BANK itself.
INSERT INTO "chart_of_accounts" ("id", "company_id", "code", "name", "account_type", "parent_account_id", "is_system_account", "is_active", "created_at", "updated_at")
SELECT gen_random_uuid(), ba."company_id", 'BANK-' || ba."code", ba."name", 'ASSET', parent."id", true, true, now(), now()
FROM "bank_accounts" ba
JOIN "chart_of_accounts" parent ON parent."company_id" = ba."company_id" AND parent."code" = 'BANK'
WHERE ba."ledger_account_id" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "chart_of_accounts" c WHERE c."company_id" = ba."company_id" AND c."code" = 'BANK-' || ba."code"
  );

UPDATE "bank_accounts" ba
SET "ledger_account_id" = c."id"
FROM "chart_of_accounts" c
WHERE c."company_id" = ba."company_id" AND c."code" = 'BANK-' || ba."code" AND ba."ledger_account_id" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "bank_accounts" other WHERE other."ledger_account_id" = c."id");
