-- GST invoice on payment requests (2026-10-28): header fields + one row per invoice line.
-- AlterTable
ALTER TABLE "payment_requests" ADD COLUMN     "invoice_date" DATE,
ADD COLUMN     "invoice_discount_total" DECIMAL(18,2),
ADD COLUMN     "invoice_grand_total" DECIMAL(18,2),
ADD COLUMN     "invoice_gst_total" DECIMAL(18,2),
ADD COLUMN     "invoice_number" TEXT,
ADD COLUMN     "invoice_taxable_total" DECIMAL(18,2),
ADD COLUMN     "is_itc_applicable" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "is_raw_material_for_production" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "is_reverse_charge" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pay_to_gstin" TEXT,
ADD COLUMN     "place_of_supply_state_code" CHAR(2);

-- CreateTable
CREATE TABLE "payment_request_invoice_lines" (
    "id" UUID NOT NULL,
    "payment_request_id" UUID NOT NULL,
    "line_number" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "is_for_stock" BOOLEAN NOT NULL DEFAULT false,
    "purpose_id" UUID,
    "expense_account_id" UUID,
    "product_id" UUID,
    "hsn_code" TEXT,
    "mrp" DECIMAL(18,2),
    "rate" DECIMAL(18,2) NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "discount_percentage" DECIMAL(5,2),
    "discount_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "taxable_amount" DECIMAL(18,2) NOT NULL,
    "gst_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "cgst_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "cgst_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "sgst_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "sgst_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "igst_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "igst_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "line_amount" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "payment_request_invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payment_request_invoice_lines_purpose_id_idx" ON "payment_request_invoice_lines"("purpose_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_request_invoice_lines_payment_request_id_line_numbe_key" ON "payment_request_invoice_lines"("payment_request_id", "line_number");

-- AddForeignKey
ALTER TABLE "payment_request_invoice_lines" ADD CONSTRAINT "payment_request_invoice_lines_payment_request_id_fkey" FOREIGN KEY ("payment_request_id") REFERENCES "payment_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_request_invoice_lines" ADD CONSTRAINT "payment_request_invoice_lines_purpose_id_fkey" FOREIGN KEY ("purpose_id") REFERENCES "expense_purposes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_request_invoice_lines" ADD CONSTRAINT "payment_request_invoice_lines_expense_account_id_fkey" FOREIGN KEY ("expense_account_id") REFERENCES "chart_of_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_request_invoice_lines" ADD CONSTRAINT "payment_request_invoice_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Hand-added checks.
ALTER TABLE "payment_request_invoice_lines" ADD CONSTRAINT "payment_request_invoice_lines_amounts_check"
  CHECK ("rate" >= 0 AND "quantity" > 0 AND "discount_amount" >= 0 AND "taxable_amount" >= 0
         AND "gst_rate" BETWEEN 0 AND 100 AND ("discount_percentage" IS NULL OR "discount_percentage" BETWEEN 0 AND 100)
         AND "line_amount" >= 0);
ALTER TABLE "payment_request_invoice_lines" ADD CONSTRAINT "payment_request_invoice_lines_line_number_check" CHECK ("line_number" >= 1);
