-- CreateTable
CREATE TABLE "finished_goods_stock_balances" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "branch_id" UUID,
    "product_id" UUID NOT NULL,
    "product_variant_id" UUID,
    "warehouse_id" UUID NOT NULL,
    "warehouse_location_id" UUID,
    "stock_status" "StockStatus" NOT NULL,
    "quantity_on_hand" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "finished_goods_stock_balances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "finished_goods_stock_balances_company_id_product_id_warehou_idx" ON "finished_goods_stock_balances"("company_id", "product_id", "warehouse_id");

-- AddForeignKey
ALTER TABLE "finished_goods_stock_balances" ADD CONSTRAINT "finished_goods_stock_balances_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finished_goods_stock_balances" ADD CONSTRAINT "finished_goods_stock_balances_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finished_goods_stock_balances" ADD CONSTRAINT "finished_goods_stock_balances_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finished_goods_stock_balances" ADD CONSTRAINT "finished_goods_stock_balances_product_variant_id_fkey" FOREIGN KEY ("product_variant_id") REFERENCES "product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finished_goods_stock_balances" ADD CONSTRAINT "finished_goods_stock_balances_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finished_goods_stock_balances" ADD CONSTRAINT "finished_goods_stock_balances_warehouse_location_id_fkey" FOREIGN KEY ("warehouse_location_id") REFERENCES "warehouse_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Hand-written (FGI-002): true uniqueness on
-- (company_id, product_id, product_variant_id, warehouse_id,
-- warehouse_location_id, stock_status) including when product_variant_id
-- and/or warehouse_location_id are NULL. A plain multi-column UNIQUE
-- constraint treats every NULL as distinct from every other NULL, so it
-- would silently permit duplicate "unallocated variant" or duplicate
-- "unassigned location" rows for the same key. COALESCE-ing each nullable
-- column to a fixed, reserved sentinel UUID inside the index expression
-- makes two NULLs collide exactly like two equal real values would, closing
-- that gap without needing an actual sentinel row in product_variants or
-- warehouse_locations.
CREATE UNIQUE INDEX "finished_goods_stock_balances_key"
ON "finished_goods_stock_balances" (
    "company_id",
    "product_id",
    COALESCE("product_variant_id", '00000000-0000-0000-0000-000000000000'::uuid),
    "warehouse_id",
    COALESCE("warehouse_location_id", '00000000-0000-0000-0000-000000000000'::uuid),
    "stock_status"
);
