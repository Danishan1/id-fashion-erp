-- Rollback for 20261027120000_payment_requests_foundation
-- Drops the Payments Request table and its enums. The added enum values
-- DocumentType.PAYMENT_REQUEST / RelatedModule.PAYMENT_REQUEST stay (Postgres
-- can't drop an enum value); remove any rows that use them first.
DELETE FROM "attachments" WHERE "related_module" = 'PAYMENT_REQUEST';
DELETE FROM "document_sequences" WHERE "document_type" = 'PAYMENT_REQUEST';
DELETE FROM "audit_logs" WHERE "table_name" = 'payment_requests';
DROP TABLE IF EXISTS "payment_requests";
DROP TYPE IF EXISTS "PaymentModeOfTransfer";
DROP TYPE IF EXISTS "PaymentRequestRouting";
DROP TYPE IF EXISTS "PaymentRequestStatus";
DROP TYPE IF EXISTS "PaymentRequestType";
DROP TYPE IF EXISTS "PaymentRequestGroup";
DELETE FROM "permissions" WHERE "module" = 'payment_requests';
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261027120000_payment_requests_foundation';
