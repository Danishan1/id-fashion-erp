-- CreateEnum
CREATE TYPE "PurchaseInvoiceStatus" AS ENUM ('DRAFT', 'POSTED', 'PARTIALLY_PAID', 'PAID', 'CLOSED', 'CANCELLED');

-- AlterTable
ALTER TABLE "purchase_order_items" ADD COLUMN     "invoiced_quantity" DECIMAL(18,4) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "purchase_invoices" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "branch_id" UUID,
    "invoice_number" TEXT NOT NULL,
    "purchase_order_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "supplier_invoice_number" TEXT,
    "invoice_date" DATE NOT NULL,
    "due_date" DATE NOT NULL,
    "status" "PurchaseInvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "currency_code" CHAR(3) NOT NULL,
    "exchange_rate" DECIMAL(18,6) NOT NULL DEFAULT 1,
    "base_currency_code" CHAR(3) NOT NULL,
    "subtotal_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "tax_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "base_total_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "journal_id" UUID,
    "posted_at" TIMESTAMP(3),
    "posted_by_user_id" UUID,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_invoice_items" (
    "id" UUID NOT NULL,
    "purchase_invoice_id" UUID NOT NULL,
    "purchase_order_item_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unit_price" DECIMAL(18,2) NOT NULL,
    "tax_rate_id" UUID,
    "tax_percentage" DECIMAL(5,2),
    "tax_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "line_total" DECIMAL(18,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_invoice_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "purchase_invoices_journal_id_key" ON "purchase_invoices"("journal_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_invoices_company_id_branch_id_invoice_number_key" ON "purchase_invoices"("company_id", "branch_id", "invoice_number");

-- CreateIndex
CREATE INDEX "purchase_invoice_items_purchase_invoice_id_idx" ON "purchase_invoice_items"("purchase_invoice_id");

-- CreateIndex
CREATE INDEX "purchase_invoice_items_purchase_order_item_id_idx" ON "purchase_invoice_items"("purchase_order_item_id");

-- AddForeignKey
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_journal_id_fkey" FOREIGN KEY ("journal_id") REFERENCES "journals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_posted_by_user_id_fkey" FOREIGN KEY ("posted_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoice_items" ADD CONSTRAINT "purchase_invoice_items_purchase_invoice_id_fkey" FOREIGN KEY ("purchase_invoice_id") REFERENCES "purchase_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoice_items" ADD CONSTRAINT "purchase_invoice_items_purchase_order_item_id_fkey" FOREIGN KEY ("purchase_order_item_id") REFERENCES "purchase_order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoice_items" ADD CONSTRAINT "purchase_invoice_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoice_items" ADD CONSTRAINT "purchase_invoice_items_tax_rate_id_fkey" FOREIGN KEY ("tax_rate_id") REFERENCES "tax_rates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Hand-added: unlike Sales Invoice (one invoice = 100% of one order, enforced
-- by a different partial unique index on sales_order_id), Purchase Invoice
-- is deliberately partial/repeatable — nothing else stops a clerk from
-- double-entering the same physical supplier bill. Guards against that
-- specifically, without blocking legitimate multiple invoices that simply
-- don't carry (or share) a supplier reference number.
CREATE UNIQUE INDEX "purchase_invoices_supplier_invoice_number_unique" ON "purchase_invoices"("supplier_id", "supplier_invoice_number") WHERE "supplier_invoice_number" IS NOT NULL AND "status" != 'CANCELLED';

-- Hand-added: same job_orders_quantity_consistency_check / journal_lines /
-- sales_invoice_items precedent — the service layer is the primary
-- correctness mechanism, these CHECKs are the hard backstop against a future
-- direct-SQL mistake.
ALTER TABLE "purchase_invoice_items" ADD CONSTRAINT "purchase_invoice_items_quantity_positive_check"
  CHECK (quantity > 0);
ALTER TABLE "purchase_invoice_items" ADD CONSTRAINT "purchase_invoice_items_amounts_non_negative_check"
  CHECK (unit_price >= 0 AND tax_amount >= 0 AND line_total >= 0);
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_amounts_non_negative_check"
  CHECK (subtotal_amount >= 0 AND tax_amount >= 0 AND total_amount >= 0 AND base_total_amount >= 0);
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_total_equals_subtotal_plus_tax_check"
  CHECK (total_amount = subtotal_amount + tax_amount);
