-- Rollback for 20261028110000_payees_and_expense_purposes
ALTER TABLE "payment_requests" DROP CONSTRAINT IF EXISTS "payment_requests_payee_id_fkey";
ALTER TABLE "payment_requests" DROP COLUMN IF EXISTS "payee_id";
DROP TABLE IF EXISTS "expense_purposes";
DROP TABLE IF EXISTS "payees";
DROP TYPE IF EXISTS "ExpensePurposeGroup";
DROP TYPE IF EXISTS "PayeeType";
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261028110000_payees_and_expense_purposes';
