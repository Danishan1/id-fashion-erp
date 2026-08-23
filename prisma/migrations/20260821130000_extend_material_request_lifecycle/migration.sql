-- CreateEnum
CREATE TYPE "MaterialRequestType" AS ENUM ('PRODUCTION_REQUIREMENT', 'DAMAGE_REPLACEMENT');

-- DropIndex
DROP INDEX "purchase_order_items_material_request_item_id_key";

-- AlterTable
ALTER TABLE "material_request_items" ADD COLUMN     "damage_reason" TEXT,
ADD COLUMN     "purchase_received_quantity" DECIMAL(18,4) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "material_requests" ADD COLUMN     "bom_id" UUID,
ADD COLUMN     "original_material_request_id" UUID,
ADD COLUMN     "request_type" "MaterialRequestType" NOT NULL DEFAULT 'PRODUCTION_REQUIREMENT';

-- CreateIndex
CREATE INDEX "material_requests_company_id_request_type_idx" ON "material_requests"("company_id", "request_type");

-- CreateIndex
CREATE INDEX "purchase_order_items_material_request_item_id_idx" ON "purchase_order_items"("material_request_item_id");

-- AddForeignKey
ALTER TABLE "material_requests" ADD CONSTRAINT "material_requests_bom_id_fkey" FOREIGN KEY ("bom_id") REFERENCES "boms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_requests" ADD CONSTRAINT "material_requests_original_material_request_id_fkey" FOREIGN KEY ("original_material_request_id") REFERENCES "material_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

