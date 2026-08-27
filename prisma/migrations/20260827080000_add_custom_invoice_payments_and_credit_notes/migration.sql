-- CreateEnum
CREATE TYPE "CustomInvoicePaymentStatus" AS ENUM ('RECORDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CustomInvoiceCreditNoteType" AS ENUM ('OVERALL_DISCOUNT', 'PRODUCT_WISE', 'PRODUCT_RETURN');

-- CreateEnum
CREATE TYPE "CustomInvoiceCreditNoteStatus" AS ENUM ('ISSUED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "DocumentType" ADD VALUE 'CUSTOM_INVOICE_CREDIT_NOTE';

-- AlterTable
ALTER TABLE "custom_invoice_items" ADD COLUMN     "credited_amount" DECIMAL(18,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "custom_invoices" ADD COLUMN     "credited_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "income_account_id" UUID,
ADD COLUMN     "paid_amount" DECIMAL(18,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "custom_invoice_payments" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "custom_invoice_id" UUID NOT NULL,
    "payment_date" DATE NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "payment_type_id" UUID,
    "reference_note" TEXT,
    "status" "CustomInvoicePaymentStatus" NOT NULL DEFAULT 'RECORDED',
    "received_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "custom_invoice_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custom_invoice_credit_notes" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "custom_invoice_id" UUID NOT NULL,
    "credit_note_number" TEXT NOT NULL,
    "credit_note_date" DATE NOT NULL,
    "type" "CustomInvoiceCreditNoteType" NOT NULL,
    "reason" TEXT,
    "total_amount" DECIMAL(18,2) NOT NULL,
    "status" "CustomInvoiceCreditNoteStatus" NOT NULL DEFAULT 'ISSUED',
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "custom_invoice_credit_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custom_invoice_credit_note_items" (
    "id" UUID NOT NULL,
    "credit_note_id" UUID NOT NULL,
    "custom_invoice_item_id" UUID NOT NULL,
    "quantity" DECIMAL(18,4),
    "amount" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "custom_invoice_credit_note_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "custom_invoice_payments_custom_invoice_id_idx" ON "custom_invoice_payments"("custom_invoice_id");

-- CreateIndex
CREATE INDEX "custom_invoice_credit_notes_custom_invoice_id_idx" ON "custom_invoice_credit_notes"("custom_invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "custom_invoice_credit_notes_company_id_credit_note_number_key" ON "custom_invoice_credit_notes"("company_id", "credit_note_number");

-- CreateIndex
CREATE INDEX "custom_invoice_credit_note_items_credit_note_id_idx" ON "custom_invoice_credit_note_items"("credit_note_id");

-- AddForeignKey
ALTER TABLE "custom_invoices" ADD CONSTRAINT "custom_invoices_income_account_id_fkey" FOREIGN KEY ("income_account_id") REFERENCES "chart_of_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_invoice_payments" ADD CONSTRAINT "custom_invoice_payments_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_invoice_payments" ADD CONSTRAINT "custom_invoice_payments_custom_invoice_id_fkey" FOREIGN KEY ("custom_invoice_id") REFERENCES "custom_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_invoice_payments" ADD CONSTRAINT "custom_invoice_payments_payment_type_id_fkey" FOREIGN KEY ("payment_type_id") REFERENCES "payment_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_invoice_payments" ADD CONSTRAINT "custom_invoice_payments_received_by_user_id_fkey" FOREIGN KEY ("received_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_invoice_credit_notes" ADD CONSTRAINT "custom_invoice_credit_notes_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_invoice_credit_notes" ADD CONSTRAINT "custom_invoice_credit_notes_custom_invoice_id_fkey" FOREIGN KEY ("custom_invoice_id") REFERENCES "custom_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_invoice_credit_notes" ADD CONSTRAINT "custom_invoice_credit_notes_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_invoice_credit_note_items" ADD CONSTRAINT "custom_invoice_credit_note_items_credit_note_id_fkey" FOREIGN KEY ("credit_note_id") REFERENCES "custom_invoice_credit_notes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_invoice_credit_note_items" ADD CONSTRAINT "custom_invoice_credit_note_items_custom_invoice_item_id_fkey" FOREIGN KEY ("custom_invoice_item_id") REFERENCES "custom_invoice_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
