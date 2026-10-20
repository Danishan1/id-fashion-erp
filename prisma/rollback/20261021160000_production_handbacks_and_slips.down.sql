-- Rollback for 20261021160000_production_handbacks_and_slips.
-- Drops the hand-back table. Note: hand-backs already reduced their
-- assignments' assigned_quantity; that history is lost with the table.
-- The RelatedModule value JOB_ORDER cannot be removed from a Postgres enum
-- in place; slip attachment rows are deleted so nothing references it.
DROP TABLE IF EXISTS "production_handbacks";
DELETE FROM "attachments" WHERE "related_module" = 'JOB_ORDER';

DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261021160000_production_handbacks_and_slips';
