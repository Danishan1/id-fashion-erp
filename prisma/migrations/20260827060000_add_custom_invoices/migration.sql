-- CreateEnum
CREATE TYPE "CustomInvoiceType" AS ENUM ('TAX_INVOICE', 'PROFORMA_INVOICE');

-- CreateEnum
CREATE TYPE "CustomInvoiceStatus" AS ENUM ('DRAFT', 'CANCELLED');

-- CreateTable
CREATE TABLE "invoice_series" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "fiscal_year_label" TEXT NOT NULL,
    "next_number" INTEGER NOT NULL DEFAULT 1,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoice_series_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custom_invoices" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "branch_id" UUID,
    "invoice_date" DATE NOT NULL,
    "invoice_type" "CustomInvoiceType" NOT NULL DEFAULT 'TAX_INVOICE',
    "has_due_date" BOOLEAN NOT NULL DEFAULT false,
    "due_date" DATE,
    "invoice_series_id" UUID NOT NULL,
    "invoice_number" TEXT NOT NULL,
    "customer_id" UUID NOT NULL,
    "discount_percentage" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "is_reverse_charge" BOOLEAN NOT NULL DEFAULT false,
    "subtotal_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "discount_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "tax_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "grand_total" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "advance_payment_title" TEXT,
    "advance_payment_amount" DECIMAL(18,2),
    "payable_amount_title" TEXT,
    "payable_amount_value" DECIMAL(18,2),
    "balance_due" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "terms_and_conditions" TEXT,
    "status" "CustomInvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "custom_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custom_invoice_items" (
    "id" UUID NOT NULL,
    "custom_invoice_id" UUID NOT NULL,
    "product_id" UUID,
    "item_name" TEXT NOT NULL,
    "hsn_code" TEXT,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unit_price" DECIMAL(18,4) NOT NULL,
    "gst_percentage" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "line_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "line_tax_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "line_total" DECIMAL(18,2) NOT NULL DEFAULT 0,

    CONSTRAINT "custom_invoice_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custom_invoice_notes" (
    "id" UUID NOT NULL,
    "custom_invoice_id" UUID NOT NULL,
    "note" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "custom_invoice_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "invoice_series_company_id_name_key" ON "invoice_series"("company_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_series_company_id_prefix_key" ON "invoice_series"("company_id", "prefix");

-- CreateIndex
CREATE INDEX "custom_invoices_company_id_status_idx" ON "custom_invoices"("company_id", "status");

-- CreateIndex
CREATE INDEX "custom_invoices_customer_id_idx" ON "custom_invoices"("customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "custom_invoices_company_id_invoice_number_key" ON "custom_invoices"("company_id", "invoice_number");

-- CreateIndex
CREATE INDEX "custom_invoice_items_custom_invoice_id_idx" ON "custom_invoice_items"("custom_invoice_id");

-- CreateIndex
CREATE INDEX "custom_invoice_notes_custom_invoice_id_idx" ON "custom_invoice_notes"("custom_invoice_id");

-- AddForeignKey
ALTER TABLE "invoice_series" ADD CONSTRAINT "invoice_series_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_invoices" ADD CONSTRAINT "custom_invoices_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_invoices" ADD CONSTRAINT "custom_invoices_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_invoices" ADD CONSTRAINT "custom_invoices_invoice_series_id_fkey" FOREIGN KEY ("invoice_series_id") REFERENCES "invoice_series"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_invoices" ADD CONSTRAINT "custom_invoices_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_invoices" ADD CONSTRAINT "custom_invoices_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_invoice_items" ADD CONSTRAINT "custom_invoice_items_custom_invoice_id_fkey" FOREIGN KEY ("custom_invoice_id") REFERENCES "custom_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_invoice_items" ADD CONSTRAINT "custom_invoice_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_invoice_notes" ADD CONSTRAINT "custom_invoice_notes_custom_invoice_id_fkey" FOREIGN KEY ("custom_invoice_id") REFERENCES "custom_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
