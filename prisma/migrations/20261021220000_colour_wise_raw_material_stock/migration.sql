-- Colour-wise raw-material stock: colour on ledger rows, stock movement lines and
-- substitutions, plus the stock_color_balances cache. Existing stock stays
-- uncoloured ("No colour"). Additive only.

-- AlterTable
ALTER TABLE "inventory_transactions" ADD COLUMN     "color_id" UUID;

-- AlterTable
ALTER TABLE "material_substitutions" ADD COLUMN     "substitute_color_id" UUID;

-- AlterTable
ALTER TABLE "stock_movement_items" ADD COLUMN     "color_id" UUID;

-- CreateTable
CREATE TABLE "stock_color_balances" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "color_id" UUID NOT NULL,
    "quantity_on_hand" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_color_balances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stock_color_balances_company_id_product_id_warehouse_id_idx" ON "stock_color_balances"("company_id", "product_id", "warehouse_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_color_balances_company_id_product_id_warehouse_id_col_key" ON "stock_color_balances"("company_id", "product_id", "warehouse_id", "color_id");

-- AddForeignKey
ALTER TABLE "material_substitutions" ADD CONSTRAINT "material_substitutions_substitute_color_id_fkey" FOREIGN KEY ("substitute_color_id") REFERENCES "colors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_color_id_fkey" FOREIGN KEY ("color_id") REFERENCES "colors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_color_balances" ADD CONSTRAINT "stock_color_balances_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_color_balances" ADD CONSTRAINT "stock_color_balances_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_color_balances" ADD CONSTRAINT "stock_color_balances_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_color_balances" ADD CONSTRAINT "stock_color_balances_color_id_fkey" FOREIGN KEY ("color_id") REFERENCES "colors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movement_items" ADD CONSTRAINT "stock_movement_items_color_id_fkey" FOREIGN KEY ("color_id") REFERENCES "colors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

