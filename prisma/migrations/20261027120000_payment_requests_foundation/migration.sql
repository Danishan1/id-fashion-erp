-- Payments Request hub foundation (2026-10-27). Additive only.
-- The unrelated sample_requests.color drift line from migrate diff is deliberately left out (see CLAUDE.md).

-- CreateEnum
CREATE TYPE "PaymentRequestGroup" AS ENUM ('SALARY', 'EXPENDITURE', 'SUPPLIER', 'INTERNAL_TRANSFER');

-- CreateEnum
CREATE TYPE "PaymentRequestType" AS ENUM ('SALARY', 'ADVANCE_REMINDER', 'INVESTMENT', 'TAX_INVOICE', 'VOUCHER_SINGLE', 'VOUCHER_MULTIPLE', 'SUPPLIER_ON_ACCOUNT', 'SUPPLIER_BILL', 'SUPPLIER_ADJUSTMENT', 'LOAN', 'IMPREST', 'FIXED_DEPOSIT', 'CASH_WITHDRAWAL', 'RECURRING_DEPOSIT', 'BANK_TRANSFER', 'CREDIT_CARD');

-- CreateEnum
CREATE TYPE "PaymentRequestStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'PARTIALLY_PAID', 'PAID', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentRequestRouting" AS ENUM ('APPROVAL_THEN_PAY', 'DIRECT_TO_ACCOUNTANT');

-- CreateEnum
CREATE TYPE "PaymentModeOfTransfer" AS ENUM ('NEFT', 'RTGS', 'IMPS', 'UPI', 'CHEQUE', 'CASH', 'CARD', 'OTHER');

-- AlterEnum
ALTER TYPE "DocumentType" ADD VALUE 'PAYMENT_REQUEST';

-- AlterEnum
ALTER TYPE "RelatedModule" ADD VALUE 'PAYMENT_REQUEST';

-- CreateTable
CREATE TABLE "payment_requests" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "branch_id" UUID,
    "request_number" TEXT NOT NULL,
    "request_type" "PaymentRequestType" NOT NULL,
    "request_group" "PaymentRequestGroup" NOT NULL,
    "status" "PaymentRequestStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "routing" "PaymentRequestRouting" NOT NULL DEFAULT 'APPROVAL_THEN_PAY',
    "amount" DECIMAL(18,2) NOT NULL,
    "paid_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "currency_code" CHAR(3) NOT NULL,
    "pay_to_name" TEXT NOT NULL,
    "supplier_id" UUID,
    "employee_id" UUID,
    "payment_due_date" DATE NOT NULL,
    "mode_of_transfer" "PaymentModeOfTransfer",
    "remark" TEXT,
    "type_data_json" JSONB,
    "source_module" TEXT,
    "source_record_id" UUID,
    "approved_at" TIMESTAMP(3),
    "approved_by_user_id" UUID,
    "rejected_at" TIMESTAMP(3),
    "rejected_by_user_id" UUID,
    "rejection_reason" TEXT,
    "cancelled_at" TIMESTAMP(3),
    "cancelled_by_user_id" UUID,
    "created_by_user_id" UUID NOT NULL,
    "idempotency_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payment_requests_company_id_status_idx" ON "payment_requests"("company_id", "status");

-- CreateIndex
CREATE INDEX "payment_requests_company_id_request_group_request_type_idx" ON "payment_requests"("company_id", "request_group", "request_type");

-- CreateIndex
CREATE INDEX "payment_requests_company_id_created_by_user_id_idx" ON "payment_requests"("company_id", "created_by_user_id");

-- CreateIndex
CREATE INDEX "payment_requests_company_id_payment_due_date_idx" ON "payment_requests"("company_id", "payment_due_date");

-- CreateIndex
CREATE UNIQUE INDEX "payment_requests_company_id_request_number_key" ON "payment_requests"("company_id", "request_number");

-- CreateIndex
CREATE UNIQUE INDEX "payment_requests_company_id_idempotency_key_key" ON "payment_requests"("company_id", "idempotency_key");

-- AddForeignKey
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_approved_by_user_id_fkey" FOREIGN KEY ("approved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_rejected_by_user_id_fkey" FOREIGN KEY ("rejected_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_cancelled_by_user_id_fkey" FOREIGN KEY ("cancelled_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

