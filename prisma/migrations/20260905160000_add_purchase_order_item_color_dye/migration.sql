-- Shade/Pantone + Color on Purchase Order line items (2026-09-05)
ALTER TABLE "purchase_order_items" ADD COLUMN     "color_id" UUID,
ADD COLUMN     "dye_id" UUID;

ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_color_id_fkey" FOREIGN KEY ("color_id") REFERENCES "colors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_dye_id_fkey" FOREIGN KEY ("dye_id") REFERENCES "fabric_dyes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
