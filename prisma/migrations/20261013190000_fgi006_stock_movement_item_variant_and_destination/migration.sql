-- AlterTable
ALTER TABLE "stock_movement_items" ADD COLUMN     "product_variant_id" UUID,
ADD COLUMN     "to_warehouse_location_id" UUID;

-- AddForeignKey
ALTER TABLE "stock_movement_items" ADD CONSTRAINT "stock_movement_items_product_variant_id_fkey" FOREIGN KEY ("product_variant_id") REFERENCES "product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movement_items" ADD CONSTRAINT "stock_movement_items_to_warehouse_location_id_fkey" FOREIGN KEY ("to_warehouse_location_id") REFERENCES "warehouse_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

