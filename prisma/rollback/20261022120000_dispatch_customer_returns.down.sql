-- Rollback for 20261022120000_dispatch_customer_returns
DROP TABLE IF EXISTS "dispatch_return_items";
DROP TABLE IF EXISTS "dispatch_returns";
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261022120000_dispatch_customer_returns';
