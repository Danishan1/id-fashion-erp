-- A free-text note for a WarehouseLocation tagged materialCategory = OTHER,
-- so "Other" doesn't need to mean "unspecified" -- e.g. "Packing Machine
-- Room". The service layer forces this back to null whenever
-- materialCategory is anything else.

-- AlterTable
ALTER TABLE "warehouse_locations" ADD COLUMN "material_category_other" TEXT;
