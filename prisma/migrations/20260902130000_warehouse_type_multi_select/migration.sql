-- Warehouse.type: single WarehouseType -> WarehouseType[] (multi-select).
-- A physical warehouse can store more than one material kind in different
-- rooms/sections; existing rows are preserved as one-element arrays, never
-- dropped.

ALTER TABLE "warehouses" ADD COLUMN "type_new" "WarehouseType"[] NOT NULL DEFAULT ARRAY[]::"WarehouseType"[];

UPDATE "warehouses" SET "type_new" = ARRAY["type"];

ALTER TABLE "warehouses" DROP COLUMN "type";

ALTER TABLE "warehouses" RENAME COLUMN "type_new" TO "type";

ALTER TABLE "warehouses" ALTER COLUMN "type" DROP DEFAULT;
