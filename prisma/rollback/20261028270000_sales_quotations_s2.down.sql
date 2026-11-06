-- Rollback for 20261028270000_sales_quotations_s2 (Quotations core, S2).
-- Deletes every quotation (with revisions, lines and attachments' DB rows),
-- the sales_quotations permissions (grants/overrides cascade) and QUOTATION
-- document sequences. Postgres can't drop an enum value, so 'QUOTATION' stays
-- in "DocumentType" / "RelatedModule" (unused and harmless).
BEGIN;

DELETE FROM "attachments" WHERE "related_module" = 'QUOTATION';
DELETE FROM "notifications" WHERE "related_module" = 'QUOTATION';
DELETE FROM "document_sequences" WHERE "document_type" = 'QUOTATION';
DROP TABLE IF EXISTS "quotation_lines";
DROP TABLE IF EXISTS "quotation_revisions";
DROP TABLE IF EXISTS "quotations";
DROP TYPE IF EXISTS "QuotationLineType";
DROP TYPE IF EXISTS "QuotationRevisionStatus";
DROP TYPE IF EXISTS "QuotationStatus";
DELETE FROM "permissions" WHERE "module" = 'sales_quotations';
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261028270000_sales_quotations_s2';

COMMIT;
