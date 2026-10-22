-- Production Order colour-wise fabric plan: per garment colour x BOM fabric line,
-- the fabric, fabric colour and quantity to request. Additive only.

-- CreateTable
CREATE TABLE "production_order_color_fabrics" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "production_order_id" UUID NOT NULL,
    "garment_color_id" UUID NOT NULL,
    "bom_material_id" UUID NOT NULL,
    "material_id" UUID NOT NULL,
    "fabric_color_id" UUID,
    "quantity" DECIMAL(18,4) NOT NULL,
    "uom_id" UUID NOT NULL,
    "updated_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "production_order_color_fabrics_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "production_order_color_fabrics_company_id_idx" ON "production_order_color_fabrics"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "production_order_color_fabrics_production_order_id_garment__key" ON "production_order_color_fabrics"("production_order_id", "garment_color_id", "bom_material_id");

-- AddForeignKey
ALTER TABLE "production_order_color_fabrics" ADD CONSTRAINT "production_order_color_fabrics_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_order_color_fabrics" ADD CONSTRAINT "production_order_color_fabrics_production_order_id_fkey" FOREIGN KEY ("production_order_id") REFERENCES "production_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_order_color_fabrics" ADD CONSTRAINT "production_order_color_fabrics_garment_color_id_fkey" FOREIGN KEY ("garment_color_id") REFERENCES "colors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_order_color_fabrics" ADD CONSTRAINT "production_order_color_fabrics_bom_material_id_fkey" FOREIGN KEY ("bom_material_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_order_color_fabrics" ADD CONSTRAINT "production_order_color_fabrics_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_order_color_fabrics" ADD CONSTRAINT "production_order_color_fabrics_fabric_color_id_fkey" FOREIGN KEY ("fabric_color_id") REFERENCES "colors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_order_color_fabrics" ADD CONSTRAINT "production_order_color_fabrics_uom_id_fkey" FOREIGN KEY ("uom_id") REFERENCES "units_of_measure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_order_color_fabrics" ADD CONSTRAINT "production_order_color_fabrics_updated_by_user_id_fkey" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

