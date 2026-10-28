-- Rollback for 20261028090000_financial_accounts
-- Only safe before any journal used a per-bank ledger account (journal_lines reference them).
ALTER TABLE "bank_accounts" DROP CONSTRAINT IF EXISTS "bank_accounts_ledger_account_id_fkey";
DELETE FROM "chart_of_accounts" c USING "bank_accounts" ba WHERE ba."ledger_account_id" = c."id" AND NOT EXISTS (SELECT 1 FROM "journal_lines" l WHERE l."account_id" = c."id");
ALTER TABLE "bank_accounts" DROP COLUMN IF EXISTS "account_kind", DROP COLUMN IF EXISTS "credit_limit", DROP COLUMN IF EXISTS "interest_rate", DROP COLUMN IF EXISTS "ledger_account_id", DROP COLUMN IF EXISTS "maturity_date";
UPDATE "bank_accounts" SET "bank_name" = COALESCE("bank_name", ''), "account_number" = COALESCE("account_number", '');
ALTER TABLE "bank_accounts" ALTER COLUMN "bank_name" SET NOT NULL, ALTER COLUMN "account_number" SET NOT NULL;
DROP TYPE IF EXISTS "FinancialAccountKind";
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261028090000_financial_accounts';
