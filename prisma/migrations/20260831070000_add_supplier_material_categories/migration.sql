-- A coarser sibling to supplier_materials: "this supplier can supply ANY
-- material in this category," including ones added later. Lets a Supplier
-- master avoid needing to be re-opened every time a new material is added
-- to a category it already broadly deals in.

-- CreateTable
CREATE TABLE "supplier_material_categories" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "material_category" "MaterialCategory" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_material_categories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "supplier_material_categories_supplier_id_material_category_key" ON "supplier_material_categories"("supplier_id", "material_category");

-- AddForeignKey
ALTER TABLE "supplier_material_categories" ADD CONSTRAINT "supplier_material_categories_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_material_categories" ADD CONSTRAINT "supplier_material_categories_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
