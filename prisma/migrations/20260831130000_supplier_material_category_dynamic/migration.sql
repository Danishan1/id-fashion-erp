-- Switch SupplierMaterialCategory from the fixed MaterialCategory enum to a
-- real FK on the dynamic SupplierCategory master, so the "Categories
-- Supplied (broad)" checklist grows/shrinks with that master's own rows
-- instead of a hardcoded 7-value list.

-- 1. Add the new nullable column first so we can backfill before enforcing NOT NULL.
ALTER TABLE "supplier_material_categories" ADD COLUMN "supplier_category_id" UUID;

-- 2. Backfill: match each existing enum value to the SupplierCategory row of
--    the same company whose code equals that enum value's string form (true
--    for every row seeded so far, since SupplierCategory was originally
--    seeded 1:1 with the old enum's values).
UPDATE "supplier_material_categories" smc
SET "supplier_category_id" = sc.id
FROM "supplier_categories" sc
WHERE sc.company_id = smc.company_id
  AND sc.code = smc.material_category::text;

-- 3. Safety net: drop any row that couldn't be backfilled (no matching
--    SupplierCategory row in that company) rather than leaving a NULL FK.
DELETE FROM "supplier_material_categories" WHERE "supplier_category_id" IS NULL;

-- 4. Enforce NOT NULL now that every remaining row has a real value.
ALTER TABLE "supplier_material_categories" ALTER COLUMN "supplier_category_id" SET NOT NULL;

-- 5. Drop the old enum-backed unique index and column.
DROP INDEX "supplier_material_categories_supplier_id_material_category_key";
ALTER TABLE "supplier_material_categories" DROP COLUMN "material_category";

-- 6. Recreate the unique constraint and add the real FK.
CREATE UNIQUE INDEX "supplier_material_categories_supplier_id_supplier_category__key" ON "supplier_material_categories"("supplier_id", "supplier_category_id");

ALTER TABLE "supplier_material_categories" ADD CONSTRAINT "supplier_material_categories_supplier_category_id_fkey" FOREIGN KEY ("supplier_category_id") REFERENCES "supplier_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
