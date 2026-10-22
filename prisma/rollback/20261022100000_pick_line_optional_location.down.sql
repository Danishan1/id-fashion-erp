-- Rollback for 20261022100000_pick_line_optional_location.
-- Pick lines taken from not-put-away (staging) stock have no location and
-- can't be kept once the column is NOT NULL again — they are deleted here.
-- Check first: SELECT count(*) FROM finished_goods_pick_lines WHERE warehouse_location_id IS NULL;
DELETE FROM "finished_goods_pick_lines" WHERE "warehouse_location_id" IS NULL;
ALTER TABLE "finished_goods_pick_lines" ALTER COLUMN "warehouse_location_id" SET NOT NULL;

DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261022100000_pick_line_optional_location';
