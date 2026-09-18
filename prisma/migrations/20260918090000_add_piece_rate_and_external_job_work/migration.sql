-- CreateEnum
CREATE TYPE "RateCardRateSource" AS ENUM ('WORKER_SPECIFIC', 'WORKER_GRADE', 'STYLE_OPERATION_DEFAULT', 'OPERATION_DEFAULT');

-- CreateEnum
CREATE TYPE "PieceRateEarnerType" AS ENUM ('EMPLOYEE', 'SUPPLIER');

-- CreateEnum
CREATE TYPE "PieceRateEarningStatus" AS ENUM ('PENDING', 'PENDING_APPROVAL', 'APPROVED', 'PAYABLE', 'PAID', 'ADJUSTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PieceRatePaymentQuantityRule" AS ENUM ('GOOD_COMPLETED_QTY', 'QC_ACCEPTED_QTY');

-- CreateEnum
CREATE TYPE "ExternalEntrySource" AS ENUM ('EXTERNAL_UNIT_USER', 'INTERNAL_SUPERVISOR', 'BOTH');

-- CreateEnum
CREATE TYPE "JobWorkOrderRateStatus" AS ENUM ('RESOLVED', 'UNRESOLVED', 'OVERRIDDEN');

-- CreateEnum
CREATE TYPE "JobWorkReceiptSource" AS ENUM ('INTERNAL_SUPERVISOR', 'EXTERNAL_UNIT_USER');

-- CreateEnum
CREATE TYPE "JobWorkReceiptApprovalStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "job_order_assignments" ADD COLUMN     "overridden_at" TIMESTAMP(3),
ADD COLUMN     "overridden_by_user_id" UUID,
ADD COLUMN     "overridden_rate" DECIMAL(18,4),
ADD COLUMN     "override_reason" TEXT,
ADD COLUMN     "production_operation_id" UUID,
ADD COLUMN     "rate_overridden" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "rate_snapshot_at" TIMESTAMP(3),
ADD COLUMN     "resolved_rate" DECIMAL(18,4),
ADD COLUMN     "resolved_rate_card_id" UUID,
ADD COLUMN     "resolved_rate_source" "RateCardRateSource";

-- AlterTable
ALTER TABLE "job_work_orders" ADD COLUMN     "production_operation_id" UUID,
ADD COLUMN     "rate_resolution_status" "JobWorkOrderRateStatus" NOT NULL DEFAULT 'UNRESOLVED',
ADD COLUMN     "rate_source_id" UUID,
ADD COLUMN     "resolved_rate" DECIMAL(18,4);

-- AlterTable
ALTER TABLE "job_work_receipts" ADD COLUMN     "approval_remark" TEXT,
ADD COLUMN     "approval_status" "JobWorkReceiptApprovalStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
ADD COLUMN     "approved_at" TIMESTAMP(3),
ADD COLUMN     "approved_by_user_id" UUID,
ADD COLUMN     "submitted_by_source" "JobWorkReceiptSource" NOT NULL DEFAULT 'INTERNAL_SUPERVISOR',
ADD COLUMN     "submitted_by_user_id" UUID;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "supplier_id" UUID;

-- CreateTable
CREATE TABLE "production_operations" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "production_stage_id" UUID,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "production_operations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "piece_rate_cards" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "production_operation_id" UUID NOT NULL,
    "product_id" UUID,
    "employee_id" UUID,
    "employee_category_id" UUID,
    "supplier_id" UUID,
    "rate" DECIMAL(18,4) NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_user_id" UUID NOT NULL,
    "updated_by_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "piece_rate_cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "piece_rate_earnings" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "job_order_id" UUID NOT NULL,
    "earner_type" "PieceRateEarnerType" NOT NULL,
    "job_order_assignment_id" UUID,
    "employee_id" UUID,
    "job_work_order_id" UUID,
    "job_work_receipt_id" UUID,
    "supplier_id" UUID,
    "production_operation_id" UUID,
    "qty_basis" "PieceRatePaymentQuantityRule" NOT NULL,
    "payable_quantity" DECIMAL(18,4) NOT NULL,
    "rate_applied" DECIMAL(18,4) NOT NULL,
    "rate_source" "RateCardRateSource",
    "amount" DECIMAL(18,2) NOT NULL,
    "status" "PieceRateEarningStatus" NOT NULL DEFAULT 'PENDING',
    "cumulative_basis_at_generation" DECIMAL(18,4) NOT NULL,
    "generated_from_entry_id" UUID,
    "generated_from_qc_inspection_id" UUID,
    "approved_by_user_id" UUID,
    "approved_at" TIMESTAMP(3),
    "remarks" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "piece_rate_earnings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_settings" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "supervisor_approval_required" BOOLEAN NOT NULL DEFAULT false,
    "external_entry_by" "ExternalEntrySource" NOT NULL DEFAULT 'INTERNAL_SUPERVISOR',
    "piece_rate_tracking_enabled" BOOLEAN NOT NULL DEFAULT false,
    "piece_rate_payment_quantity_rule" "PieceRatePaymentQuantityRule" NOT NULL DEFAULT 'QC_ACCEPTED_QTY',
    "workers_can_view_own_rate" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "production_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_routes" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "product_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "production_routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_route_stages" (
    "id" UUID NOT NULL,
    "production_route_id" UUID NOT NULL,
    "production_stage_id" UUID NOT NULL,
    "is_external" BOOLEAN NOT NULL DEFAULT false,
    "preferred_supplier_id" UUID,

    CONSTRAINT "production_route_stages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "production_operations_company_id_code_key" ON "production_operations"("company_id", "code");

-- CreateIndex
CREATE INDEX "piece_rate_cards_company_id_production_operation_id_idx" ON "piece_rate_cards"("company_id", "production_operation_id");

-- CreateIndex
CREATE INDEX "piece_rate_cards_company_id_product_id_production_operation_idx" ON "piece_rate_cards"("company_id", "product_id", "production_operation_id");

-- CreateIndex
CREATE INDEX "piece_rate_cards_company_id_employee_id_production_operatio_idx" ON "piece_rate_cards"("company_id", "employee_id", "production_operation_id");

-- CreateIndex
CREATE INDEX "piece_rate_cards_company_id_employee_category_id_production_idx" ON "piece_rate_cards"("company_id", "employee_category_id", "production_operation_id");

-- CreateIndex
CREATE INDEX "piece_rate_cards_company_id_supplier_id_production_operatio_idx" ON "piece_rate_cards"("company_id", "supplier_id", "production_operation_id");

-- CreateIndex
CREATE INDEX "piece_rate_earnings_company_id_employee_id_idx" ON "piece_rate_earnings"("company_id", "employee_id");

-- CreateIndex
CREATE INDEX "piece_rate_earnings_company_id_supplier_id_idx" ON "piece_rate_earnings"("company_id", "supplier_id");

-- CreateIndex
CREATE INDEX "piece_rate_earnings_job_order_id_job_order_assignment_id_idx" ON "piece_rate_earnings"("job_order_id", "job_order_assignment_id");

-- CreateIndex
CREATE INDEX "piece_rate_earnings_job_order_id_job_work_order_id_idx" ON "piece_rate_earnings"("job_order_id", "job_work_order_id");

-- CreateIndex
CREATE INDEX "piece_rate_earnings_company_id_status_idx" ON "piece_rate_earnings"("company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "production_settings_company_id_key" ON "production_settings"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "production_route_stages_production_route_id_production_stag_key" ON "production_route_stages"("production_route_id", "production_stage_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_supplier_id_key" ON "users"("supplier_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_operations" ADD CONSTRAINT "production_operations_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_operations" ADD CONSTRAINT "production_operations_production_stage_id_fkey" FOREIGN KEY ("production_stage_id") REFERENCES "production_stages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "piece_rate_cards" ADD CONSTRAINT "piece_rate_cards_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "piece_rate_cards" ADD CONSTRAINT "piece_rate_cards_production_operation_id_fkey" FOREIGN KEY ("production_operation_id") REFERENCES "production_operations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "piece_rate_cards" ADD CONSTRAINT "piece_rate_cards_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "piece_rate_cards" ADD CONSTRAINT "piece_rate_cards_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "piece_rate_cards" ADD CONSTRAINT "piece_rate_cards_employee_category_id_fkey" FOREIGN KEY ("employee_category_id") REFERENCES "employee_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "piece_rate_cards" ADD CONSTRAINT "piece_rate_cards_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "piece_rate_cards" ADD CONSTRAINT "piece_rate_cards_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "piece_rate_cards" ADD CONSTRAINT "piece_rate_cards_updated_by_user_id_fkey" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "piece_rate_earnings" ADD CONSTRAINT "piece_rate_earnings_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "piece_rate_earnings" ADD CONSTRAINT "piece_rate_earnings_job_order_id_fkey" FOREIGN KEY ("job_order_id") REFERENCES "job_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "piece_rate_earnings" ADD CONSTRAINT "piece_rate_earnings_job_order_assignment_id_fkey" FOREIGN KEY ("job_order_assignment_id") REFERENCES "job_order_assignments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "piece_rate_earnings" ADD CONSTRAINT "piece_rate_earnings_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "piece_rate_earnings" ADD CONSTRAINT "piece_rate_earnings_job_work_order_id_fkey" FOREIGN KEY ("job_work_order_id") REFERENCES "job_work_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "piece_rate_earnings" ADD CONSTRAINT "piece_rate_earnings_job_work_receipt_id_fkey" FOREIGN KEY ("job_work_receipt_id") REFERENCES "job_work_receipts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "piece_rate_earnings" ADD CONSTRAINT "piece_rate_earnings_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "piece_rate_earnings" ADD CONSTRAINT "piece_rate_earnings_production_operation_id_fkey" FOREIGN KEY ("production_operation_id") REFERENCES "production_operations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "piece_rate_earnings" ADD CONSTRAINT "piece_rate_earnings_approved_by_user_id_fkey" FOREIGN KEY ("approved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_settings" ADD CONSTRAINT "production_settings_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_routes" ADD CONSTRAINT "production_routes_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_routes" ADD CONSTRAINT "production_routes_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_route_stages" ADD CONSTRAINT "production_route_stages_production_route_id_fkey" FOREIGN KEY ("production_route_id") REFERENCES "production_routes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_route_stages" ADD CONSTRAINT "production_route_stages_production_stage_id_fkey" FOREIGN KEY ("production_stage_id") REFERENCES "production_stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_route_stages" ADD CONSTRAINT "production_route_stages_preferred_supplier_id_fkey" FOREIGN KEY ("preferred_supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_order_assignments" ADD CONSTRAINT "job_order_assignments_production_operation_id_fkey" FOREIGN KEY ("production_operation_id") REFERENCES "production_operations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_order_assignments" ADD CONSTRAINT "job_order_assignments_resolved_rate_card_id_fkey" FOREIGN KEY ("resolved_rate_card_id") REFERENCES "piece_rate_cards"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_order_assignments" ADD CONSTRAINT "job_order_assignments_overridden_by_user_id_fkey" FOREIGN KEY ("overridden_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_work_orders" ADD CONSTRAINT "job_work_orders_production_operation_id_fkey" FOREIGN KEY ("production_operation_id") REFERENCES "production_operations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_work_receipts" ADD CONSTRAINT "job_work_receipts_approved_by_user_id_fkey" FOREIGN KEY ("approved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_work_receipts" ADD CONSTRAINT "job_work_receipts_submitted_by_user_id_fkey" FOREIGN KEY ("submitted_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
