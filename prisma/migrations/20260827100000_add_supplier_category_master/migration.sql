-- Supplier's category, made a real per-company master (Garment Attributes)
-- instead of a fixed enum, at the user's explicit request. Product's own
-- materialCategory keeps the same fixed values (it already had its own
-- independent validation/UI, a separate decision) — only the underlying
-- shared Postgres enum name changes, from SupplierCategory to
-- MaterialCategory, freeing that name up for the new dynamic master.
-- Both `suppliers` and `products` were confirmed empty before this
-- migration (freshly wiped dev DB), so this is a clean cutover with no
-- backfill needed.

-- CreateEnum
CREATE TYPE "MaterialCategory" AS ENUM ('FABRIC', 'TRIMS', 'ZIPS', 'BUTTONS', 'ACCESSORIES', 'PACKAGING', 'SERVICES', 'MACHINERY', 'OTHER');

-- AlterTable
ALTER TABLE "products" DROP COLUMN "material_category",
ADD COLUMN     "material_category" "MaterialCategory";

-- AlterTable
ALTER TABLE "suppliers" DROP COLUMN "category",
ADD COLUMN     "category_id" UUID NOT NULL;

-- DropEnum
DROP TYPE "SupplierCategory";

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

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "supplier_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
