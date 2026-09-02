-- AlterTable
ALTER TABLE "material_request_items" ADD COLUMN     "warehouse_location_id" UUID;

-- AlterTable
ALTER TABLE "stock_movement_items" ADD COLUMN     "warehouse_location_id" UUID;

-- AlterTable
ALTER TABLE "warehouse_locations" ADD COLUMN     "material_category" "MaterialCategory";

-- AddForeignKey
ALTER TABLE "material_request_items" ADD CONSTRAINT "material_request_items_warehouse_location_id_fkey" FOREIGN KEY ("warehouse_location_id") REFERENCES "warehouse_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movement_items" ADD CONSTRAINT "stock_movement_items_warehouse_location_id_fkey" FOREIGN KEY ("warehouse_location_id") REFERENCES "warehouse_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
