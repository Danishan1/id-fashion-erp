-- CreateEnum
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('DRAFT', 'APPROVED', 'SENT_TO_SUPPLIER', 'PARTIALLY_RECEIVED', 'FULLY_RECEIVED', 'CLOSED', 'ON_HOLD', 'CANCELLED');

-- CreateEnum
CREATE TYPE "GoodsReceiptStatus" AS ENUM ('COMPLETED', 'PARTIALLY_REVERSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "FabricRollStatus" AS ENUM ('IN_STOCK', 'PARTIALLY_USED', 'CONSUMED', 'DAMAGED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "InventoryTransactionType" AS ENUM ('OPENING_BALANCE', 'GOODS_RECEIPT', 'GOODS_RECEIPT_REVERSAL', 'MATERIAL_ISSUE', 'PRODUCTION_RECEIPT', 'ADJUSTMENT', 'STOCK_TRANSFER');

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "branch_id" UUID,
    "order_number" TEXT NOT NULL,
    "supplier_id" UUID NOT NULL,
    "order_date" DATE NOT NULL,
    "expected_delivery_date" DATE,
    "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "status_before_hold" "PurchaseOrderStatus",
    "currency_code" CHAR(3) NOT NULL,
    "exchange_rate" DECIMAL(18,6) NOT NULL DEFAULT 1,
    "base_currency_code" CHAR(3) NOT NULL,
    "total_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "base_total_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "requested_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_items" (
    "id" UUID NOT NULL,
    "purchase_order_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "uom_id" UUID NOT NULL,
    "ordered_quantity" DECIMAL(18,4) NOT NULL,
    "unit_price" DECIMAL(18,2) NOT NULL,
    "received_quantity" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_receipts" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "branch_id" UUID,
    "receipt_number" TEXT NOT NULL,
    "purchase_order_id" UUID NOT NULL,
    "received_date" DATE NOT NULL,
    "received_by_user_id" UUID NOT NULL,
    "status" "GoodsReceiptStatus" NOT NULL DEFAULT 'COMPLETED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "goods_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_receipt_items" (
    "id" UUID NOT NULL,
    "goods_receipt_id" UUID NOT NULL,
    "purchase_order_item_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "uom_id" UUID NOT NULL,
    "received_quantity" DECIMAL(18,4) NOT NULL,
    "reversed_quantity" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "warehouse_id" UUID NOT NULL,
    "warehouse_location_id" UUID,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "goods_receipt_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fabric_rolls" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "goods_receipt_item_id" UUID NOT NULL,
    "roll_number" TEXT NOT NULL,
    "roll_quantity" DECIMAL(18,4) NOT NULL,
    "remaining_quantity" DECIMAL(18,4) NOT NULL,
    "batch_no" TEXT,
    "gsm_id" UUID,
    "dye_id" UUID,
    "weave_type_id" UUID,
    "width_id" UUID,
    "composition_id" UUID,
    "warehouse_location_id" UUID,
    "status" "FabricRollStatus" NOT NULL DEFAULT 'IN_STOCK',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fabric_rolls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_transactions" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "branch_id" UUID,
    "product_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "warehouse_location_id" UUID,
    "transaction_type" "InventoryTransactionType" NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "reference_module" "RelatedModule" NOT NULL,
    "reference_record_id" UUID NOT NULL,
    "fabric_roll_id" UUID,
    "performed_by_user_id" UUID NOT NULL,
    "performed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,

    CONSTRAINT "inventory_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_balances" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "quantity_on_hand" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_balances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "purchase_orders_company_id_supplier_id_idx" ON "purchase_orders"("company_id", "supplier_id");

-- CreateIndex
CREATE INDEX "purchase_orders_company_id_status_idx" ON "purchase_orders"("company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_company_id_order_number_key" ON "purchase_orders"("company_id", "order_number");

-- CreateIndex
CREATE INDEX "purchase_order_items_purchase_order_id_idx" ON "purchase_order_items"("purchase_order_id");

-- CreateIndex
CREATE INDEX "goods_receipts_company_id_purchase_order_id_idx" ON "goods_receipts"("company_id", "purchase_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "goods_receipts_company_id_receipt_number_key" ON "goods_receipts"("company_id", "receipt_number");

-- CreateIndex
CREATE INDEX "goods_receipt_items_goods_receipt_id_idx" ON "goods_receipt_items"("goods_receipt_id");

-- CreateIndex
CREATE INDEX "goods_receipt_items_purchase_order_item_id_idx" ON "goods_receipt_items"("purchase_order_item_id");

-- CreateIndex
CREATE INDEX "fabric_rolls_company_id_roll_number_idx" ON "fabric_rolls"("company_id", "roll_number");

-- CreateIndex
CREATE INDEX "fabric_rolls_goods_receipt_item_id_idx" ON "fabric_rolls"("goods_receipt_item_id");

-- CreateIndex
CREATE INDEX "inventory_transactions_company_id_product_id_warehouse_id_idx" ON "inventory_transactions"("company_id", "product_id", "warehouse_id");

-- CreateIndex
CREATE INDEX "inventory_transactions_reference_module_reference_record_id_idx" ON "inventory_transactions"("reference_module", "reference_record_id");

-- CreateIndex
CREATE INDEX "inventory_transactions_fabric_roll_id_idx" ON "inventory_transactions"("fabric_roll_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_balances_company_id_product_id_warehouse_id_key" ON "stock_balances"("company_id", "product_id", "warehouse_id");

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_requested_by_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_uom_id_fkey" FOREIGN KEY ("uom_id") REFERENCES "units_of_measure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_received_by_user_id_fkey" FOREIGN KEY ("received_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_items" ADD CONSTRAINT "goods_receipt_items_goods_receipt_id_fkey" FOREIGN KEY ("goods_receipt_id") REFERENCES "goods_receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_items" ADD CONSTRAINT "goods_receipt_items_purchase_order_item_id_fkey" FOREIGN KEY ("purchase_order_item_id") REFERENCES "purchase_order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_items" ADD CONSTRAINT "goods_receipt_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_items" ADD CONSTRAINT "goods_receipt_items_uom_id_fkey" FOREIGN KEY ("uom_id") REFERENCES "units_of_measure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_items" ADD CONSTRAINT "goods_receipt_items_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_items" ADD CONSTRAINT "goods_receipt_items_warehouse_location_id_fkey" FOREIGN KEY ("warehouse_location_id") REFERENCES "warehouse_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fabric_rolls" ADD CONSTRAINT "fabric_rolls_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fabric_rolls" ADD CONSTRAINT "fabric_rolls_goods_receipt_item_id_fkey" FOREIGN KEY ("goods_receipt_item_id") REFERENCES "goods_receipt_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fabric_rolls" ADD CONSTRAINT "fabric_rolls_gsm_id_fkey" FOREIGN KEY ("gsm_id") REFERENCES "fabric_gsms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fabric_rolls" ADD CONSTRAINT "fabric_rolls_dye_id_fkey" FOREIGN KEY ("dye_id") REFERENCES "fabric_dyes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fabric_rolls" ADD CONSTRAINT "fabric_rolls_weave_type_id_fkey" FOREIGN KEY ("weave_type_id") REFERENCES "fabric_weave_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fabric_rolls" ADD CONSTRAINT "fabric_rolls_width_id_fkey" FOREIGN KEY ("width_id") REFERENCES "fabric_widths"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fabric_rolls" ADD CONSTRAINT "fabric_rolls_composition_id_fkey" FOREIGN KEY ("composition_id") REFERENCES "fabric_compositions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fabric_rolls" ADD CONSTRAINT "fabric_rolls_warehouse_location_id_fkey" FOREIGN KEY ("warehouse_location_id") REFERENCES "warehouse_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_warehouse_location_id_fkey" FOREIGN KEY ("warehouse_location_id") REFERENCES "warehouse_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_fabric_roll_id_fkey" FOREIGN KEY ("fabric_roll_id") REFERENCES "fabric_rolls"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_performed_by_user_id_fkey" FOREIGN KEY ("performed_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
