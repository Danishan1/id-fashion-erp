-- Rollback for 20261027160000_payment_request_payouts
-- Only safe before any payout exists: payouts own real journals/payments.
DROP TABLE IF EXISTS "payment_request_payouts";
ALTER TABLE "payments" DROP COLUMN IF EXISTS "is_advance";
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261027160000_payment_request_payouts';
