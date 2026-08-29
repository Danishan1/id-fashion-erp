-- Supplier's category, made a real per-company master (Garment Attributes)
-- instead of a fixed enum, at the user's explicit request. Product's own
-- materialCategory keeps the same fixed values (it already had its own
-- independent validation/UI, a separate decision) — only the underlying
-- shared Postgres enum name changes, from SupplierCategory to
-- MaterialCategory, freeing that name up for the new dynamic master.
--
-- NOTE: this migration was rewritten from the original branch's version,
-- which assumed `suppliers`/`products` were empty (true on that branch's
-- dev DB, not true here) and did a blind DROP+re-ADD NOT NULL — that would
-- have either failed outright or silently discarded real category data on
-- this database. This version backfills instead: seeds all 9 canonical
-- categories per company (matching seed.ts's own literals exactly), then
-- maps every existing supplier's old enum value onto the matching new row
-- before enforcing NOT NULL, and converts products.material_category via an
-- in-place type cast (same values, renamed enum) rather than a destructive
-- drop.

-- CreateEnum
CREATE TYPE "MaterialCategory" AS ENUM ('FABRIC', 'TRIMS', 'ZIPS', 'BUTTONS', 'ACCESSORIES', 'PACKAGING', 'SERVICES', 'MACHINERY', 'OTHER');

-- Preserve every existing product's material_category — same enum values,
-- just moving to the new, renamed type.
ALTER TABLE "products" ALTER COLUMN "material_category" TYPE "MaterialCategory" USING (material_category::text::"MaterialCategory");

-- CreateTable
CREATE TABLE "supplier_categories" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_categories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "supplier_categories_company_id_code_key" ON "supplier_categories"("company_id", "code");

-- AddForeignKey
ALTER TABLE "supplier_categories" ADD CONSTRAINT "supplier_categories_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill: all 9 canonical categories for every existing company, matching
-- prisma/seed.ts's own supplierCategory.createMany literals exactly, so a
-- fresh company and an already-seeded one end up with the identical set.
INSERT INTO "supplier_categories" ("id", "company_id", "code", "name", "is_active", "created_at", "updated_at")
SELECT gen_random_uuid(), c.id, v.code, v.name, true, now(), now()
FROM "companies" c
CROSS JOIN (VALUES
  ('FABRIC', 'Fabric'), ('TRIMS', 'Trims'), ('ZIPS', 'Zips'), ('BUTTONS', 'Buttons'),
  ('ACCESSORIES', 'Accessories'), ('PACKAGING', 'Packaging'), ('SERVICES', 'Services'),
  ('MACHINERY', 'Machinery'), ('OTHER', 'Other')
) AS v(code, name);

-- AlterTable: add category_id nullable first so existing rows can be backfilled
ALTER TABLE "suppliers" ADD COLUMN "category_id" UUID;

-- Map every existing supplier's old enum value onto its new master row
UPDATE "suppliers" s
SET "category_id" = sc.id
FROM "supplier_categories" sc
WHERE sc.company_id = s.company_id AND sc.code = s.category::text;

-- Now safe to enforce NOT NULL — every row was backfilled above
ALTER TABLE "suppliers" ALTER COLUMN "category_id" SET NOT NULL;

-- Drop the old enum column now that category_id fully replaces it
ALTER TABLE "suppliers" DROP COLUMN "category";

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "supplier_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- DropEnum: safe now — products was converted above, suppliers.category was just dropped
DROP TYPE "SupplierCategory";
