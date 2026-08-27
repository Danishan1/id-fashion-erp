-- DropForeignKey
ALTER TABLE "purchase_invoice_items" DROP CONSTRAINT "purchase_invoice_items_product_id_fkey";

-- DropForeignKey
ALTER TABLE "purchase_invoice_items" DROP CONSTRAINT "purchase_invoice_items_purchase_order_item_id_fkey";

-- DropForeignKey
ALTER TABLE "purchase_invoices" DROP CONSTRAINT "purchase_invoices_purchase_order_id_fkey";

-- AlterTable
ALTER TABLE "purchase_invoice_items" ADD COLUMN     "description" TEXT,
ADD COLUMN     "expense_account_id" UUID,
ALTER COLUMN "purchase_order_item_id" DROP NOT NULL,
ALTER COLUMN "product_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "purchase_invoices" ALTER COLUMN "purchase_order_id" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "purchase_invoice_items_expense_account_id_idx" ON "purchase_invoice_items"("expense_account_id");

-- AddForeignKey
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoice_items" ADD CONSTRAINT "purchase_invoice_items_purchase_order_item_id_fkey" FOREIGN KEY ("purchase_order_item_id") REFERENCES "purchase_order_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoice_items" ADD CONSTRAINT "purchase_invoice_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoice_items" ADD CONSTRAINT "purchase_invoice_items_expense_account_id_fkey" FOREIGN KEY ("expense_account_id") REFERENCES "chart_of_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Hand-added CHECK: every line is EXACTLY one of (PO-linked, direct) — same
-- two-nullable-field-XOR shape as payment_allocations_exactly_one_invoice_check.
ALTER TABLE "purchase_invoice_items" ADD CONSTRAINT "purchase_invoice_items_exactly_one_source_check"
  CHECK ((purchase_order_item_id IS NOT NULL) != (expense_account_id IS NOT NULL));
