
-- CreateTable
CREATE TABLE "lot_variant_breakdowns" (
    "id" UUID NOT NULL,
    "lot_id" UUID NOT NULL,
    "product_variant_id" UUID NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lot_variant_breakdowns_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "lot_variant_breakdowns_lot_id_product_variant_id_key" ON "lot_variant_breakdowns"("lot_id", "product_variant_id");

-- AddForeignKey
ALTER TABLE "lot_variant_breakdowns" ADD CONSTRAINT "lot_variant_breakdowns_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lot_variant_breakdowns" ADD CONSTRAINT "lot_variant_breakdowns_product_variant_id_fkey" FOREIGN KEY ("product_variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

