-- Rollback for 20261021210000_production_order_color_fabrics.
-- Drops the colour-wise fabric plans; Material Requests already generated from
-- them are unaffected.
DROP TABLE IF EXISTS "production_order_color_fabrics";

DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261021210000_production_order_color_fabrics';
