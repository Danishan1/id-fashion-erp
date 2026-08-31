-- Supplier <-> Material catalog: which suppliers can supply which raw
-- materials, a real many-to-many. Deliberately separate from
-- products.default_supplier_id (a single FK used only to auto-suggest a
-- supplier when generating a PO from a Material Request shortfall) — a
-- material routinely has more than one real-world eligible supplier.

-- CreateTable
CREATE TABLE "supplier_materials" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_materials_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "supplier_materials_company_id_product_id_idx" ON "supplier_materials"("company_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_materials_supplier_id_product_id_key" ON "supplier_materials"("supplier_id", "product_id");

-- AddForeignKey
ALTER TABLE "supplier_materials" ADD CONSTRAINT "supplier_materials_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_materials" ADD CONSTRAINT "supplier_materials_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_materials" ADD CONSTRAINT "supplier_materials_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
