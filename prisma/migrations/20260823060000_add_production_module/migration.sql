
-- CreateEnum
CREATE TYPE "ProductionOrderStatus" AS ENUM ('PLANNED', 'MATERIAL_ALLOCATED', 'IN_PROGRESS', 'ON_HOLD', 'CANCELLED', 'CLOSED');

-- CreateEnum
CREATE TYPE "ProductionPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "LotStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'SPLIT', 'MERGED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LotRelationType" AS ENUM ('SPLIT', 'MERGE');

-- CreateEnum
CREATE TYPE "JobOrderStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'PARTIALLY_COMPLETED', 'COMPLETED', 'ON_HOLD', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'REASSIGNED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "StageTransactionType" AS ENUM ('FORWARD', 'REWORK', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "QcResult" AS ENUM ('PASS', 'PARTIAL_PASS', 'FAIL');

-- AlterEnum
ALTER TYPE "InventoryTransactionType" ADD VALUE 'DAMAGE';

-- AlterTable
ALTER TABLE "material_requests" ADD COLUMN     "production_order_id" UUID;

-- AlterTable
ALTER TABLE "production_stages" ADD COLUMN     "allow_rework" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "default_owner_employee_id" UUID,
ADD COLUMN     "department_id" UUID,
ADD COLUMN     "is_final" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "is_qc_recommended" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "production_orders" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "branch_id" UUID,
    "order_number" TEXT NOT NULL,
    "sales_order_item_id" UUID,
    "product_id" UUID NOT NULL,
    "bom_id" UUID,
    "planned_quantity" DECIMAL(18,4) NOT NULL,
    "status" "ProductionOrderStatus" NOT NULL DEFAULT 'PLANNED',
    "status_before_hold" "ProductionOrderStatus",
    "priority" "ProductionPriority" NOT NULL DEFAULT 'NORMAL',
    "planned_start_date" DATE,
    "planned_end_date" DATE,
    "actual_start_date" DATE,
    "actual_end_date" DATE,
    "next_lot_sequence" INTEGER NOT NULL DEFAULT 1,
    "remarks" TEXT,
    "requested_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "production_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lots" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "branch_id" UUID,
    "production_order_id" UUID NOT NULL,
    "lot_number" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "uom_id" UUID NOT NULL,
    "status" "LotStatus" NOT NULL DEFAULT 'PLANNED',
    "current_stage_id" UUID,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lot_relations" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "parent_lot_id" UUID NOT NULL,
    "child_lot_id" UUID NOT NULL,
    "relation_type" "LotRelationType" NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "reason" TEXT,
    "performed_by_user_id" UUID NOT NULL,
    "performed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lot_relations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_orders" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "production_order_id" UUID NOT NULL,
    "lot_id" UUID NOT NULL,
    "production_stage_id" UUID NOT NULL,
    "job_number" TEXT NOT NULL,
    "source_job_order_id" UUID,
    "production_line_id" UUID,
    "planned_quantity" DECIMAL(18,4) NOT NULL,
    "completed_quantity" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "rejected_quantity" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "damaged_quantity" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "forwarded_quantity" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "qc_passed_quantity" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "status" "JobOrderStatus" NOT NULL DEFAULT 'PENDING',
    "priority" "ProductionPriority" NOT NULL DEFAULT 'NORMAL',
    "planned_start_at" TIMESTAMP(3),
    "planned_end_at" TIMESTAMP(3),
    "actual_start_at" TIMESTAMP(3),
    "actual_end_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_order_assignments" (
    "id" UUID NOT NULL,
    "job_order_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "assigned_quantity" DECIMAL(18,4) NOT NULL,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'ASSIGNED',
    "assigned_by_user_id" UUID NOT NULL,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "job_order_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_order_progress_entries" (
    "id" UUID NOT NULL,
    "job_order_id" UUID NOT NULL,
    "job_order_assignment_id" UUID,
    "employee_id" UUID NOT NULL,
    "recorded_by_user_id" UUID NOT NULL,
    "completed_quantity" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "rejected_quantity" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "damaged_quantity" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "is_adjustment" BOOLEAN NOT NULL DEFAULT false,
    "remarks" TEXT,
    "started_at" TIMESTAMP(3),
    "ended_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_order_progress_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_stage_transactions" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "production_order_id" UUID NOT NULL,
    "lot_id" UUID NOT NULL,
    "from_job_order_id" UUID,
    "to_job_order_id" UUID NOT NULL,
    "from_production_stage_id" UUID,
    "to_production_stage_id" UUID NOT NULL,
    "transaction_type" "StageTransactionType" NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "is_backward" BOOLEAN NOT NULL DEFAULT false,
    "revert_reason" TEXT,
    "performed_by_user_id" UUID NOT NULL,
    "performed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,

    CONSTRAINT "production_stage_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qc_inspections" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "production_order_id" UUID NOT NULL,
    "lot_id" UUID NOT NULL,
    "job_order_id" UUID NOT NULL,
    "inspected_quantity" DECIMAL(18,4) NOT NULL,
    "accepted_quantity" DECIMAL(18,4) NOT NULL,
    "rejected_quantity" DECIMAL(18,4) NOT NULL,
    "damaged_quantity" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "result" "QcResult" NOT NULL,
    "rework_stage_transaction_id" UUID,
    "inspector_user_id" UUID NOT NULL,
    "inspected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "remarks" TEXT,

    CONSTRAINT "qc_inspections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qc_defects" (
    "id" UUID NOT NULL,
    "qc_inspection_id" UUID NOT NULL,
    "defect_type_id" UUID NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "severity" TEXT,
    "remarks" TEXT,

    CONSTRAINT "qc_defects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "defect_types" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "defect_types_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "production_orders_company_id_status_idx" ON "production_orders"("company_id", "status");

-- CreateIndex
CREATE INDEX "production_orders_sales_order_item_id_idx" ON "production_orders"("sales_order_item_id");

-- CreateIndex
CREATE INDEX "production_orders_product_id_idx" ON "production_orders"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "production_orders_company_id_order_number_key" ON "production_orders"("company_id", "order_number");

-- CreateIndex
CREATE INDEX "lots_production_order_id_idx" ON "lots"("production_order_id");

-- CreateIndex
CREATE INDEX "lots_company_id_status_idx" ON "lots"("company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "lots_company_id_lot_number_key" ON "lots"("company_id", "lot_number");

-- CreateIndex
CREATE INDEX "lot_relations_parent_lot_id_idx" ON "lot_relations"("parent_lot_id");

-- CreateIndex
CREATE INDEX "lot_relations_child_lot_id_idx" ON "lot_relations"("child_lot_id");

-- CreateIndex
CREATE INDEX "job_orders_lot_id_production_stage_id_idx" ON "job_orders"("lot_id", "production_stage_id");

-- CreateIndex
CREATE INDEX "job_orders_production_order_id_idx" ON "job_orders"("production_order_id");

-- CreateIndex
CREATE INDEX "job_orders_company_id_status_idx" ON "job_orders"("company_id", "status");

-- CreateIndex
CREATE INDEX "job_orders_production_stage_id_idx" ON "job_orders"("production_stage_id");

-- CreateIndex
CREATE INDEX "job_order_assignments_job_order_id_idx" ON "job_order_assignments"("job_order_id");

-- CreateIndex
CREATE INDEX "job_order_assignments_employee_id_idx" ON "job_order_assignments"("employee_id");

-- CreateIndex
CREATE INDEX "job_order_progress_entries_job_order_id_idx" ON "job_order_progress_entries"("job_order_id");

-- CreateIndex
CREATE INDEX "job_order_progress_entries_employee_id_idx" ON "job_order_progress_entries"("employee_id");

-- CreateIndex
CREATE INDEX "production_stage_transactions_lot_id_performed_at_idx" ON "production_stage_transactions"("lot_id", "performed_at");

-- CreateIndex
CREATE INDEX "production_stage_transactions_to_production_stage_id_idx" ON "production_stage_transactions"("to_production_stage_id");

-- CreateIndex
CREATE INDEX "production_stage_transactions_production_order_id_idx" ON "production_stage_transactions"("production_order_id");

-- CreateIndex
CREATE INDEX "qc_inspections_job_order_id_idx" ON "qc_inspections"("job_order_id");

-- CreateIndex
CREATE INDEX "qc_inspections_lot_id_idx" ON "qc_inspections"("lot_id");

-- CreateIndex
CREATE INDEX "qc_defects_qc_inspection_id_idx" ON "qc_defects"("qc_inspection_id");

-- CreateIndex
CREATE UNIQUE INDEX "defect_types_company_id_code_key" ON "defect_types"("company_id", "code");

-- CreateIndex
CREATE INDEX "material_requests_production_order_id_idx" ON "material_requests"("production_order_id");

-- AddForeignKey
ALTER TABLE "production_stages" ADD CONSTRAINT "production_stages_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_stages" ADD CONSTRAINT "production_stages_default_owner_employee_id_fkey" FOREIGN KEY ("default_owner_employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_requests" ADD CONSTRAINT "material_requests_production_order_id_fkey" FOREIGN KEY ("production_order_id") REFERENCES "production_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_sales_order_item_id_fkey" FOREIGN KEY ("sales_order_item_id") REFERENCES "sales_order_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_bom_id_fkey" FOREIGN KEY ("bom_id") REFERENCES "boms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_requested_by_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lots" ADD CONSTRAINT "lots_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lots" ADD CONSTRAINT "lots_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lots" ADD CONSTRAINT "lots_production_order_id_fkey" FOREIGN KEY ("production_order_id") REFERENCES "production_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lots" ADD CONSTRAINT "lots_uom_id_fkey" FOREIGN KEY ("uom_id") REFERENCES "units_of_measure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lots" ADD CONSTRAINT "lots_current_stage_id_fkey" FOREIGN KEY ("current_stage_id") REFERENCES "production_stages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lots" ADD CONSTRAINT "lots_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lot_relations" ADD CONSTRAINT "lot_relations_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lot_relations" ADD CONSTRAINT "lot_relations_parent_lot_id_fkey" FOREIGN KEY ("parent_lot_id") REFERENCES "lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lot_relations" ADD CONSTRAINT "lot_relations_child_lot_id_fkey" FOREIGN KEY ("child_lot_id") REFERENCES "lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lot_relations" ADD CONSTRAINT "lot_relations_performed_by_user_id_fkey" FOREIGN KEY ("performed_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_orders" ADD CONSTRAINT "job_orders_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_orders" ADD CONSTRAINT "job_orders_production_order_id_fkey" FOREIGN KEY ("production_order_id") REFERENCES "production_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_orders" ADD CONSTRAINT "job_orders_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_orders" ADD CONSTRAINT "job_orders_production_stage_id_fkey" FOREIGN KEY ("production_stage_id") REFERENCES "production_stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_orders" ADD CONSTRAINT "job_orders_source_job_order_id_fkey" FOREIGN KEY ("source_job_order_id") REFERENCES "job_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_orders" ADD CONSTRAINT "job_orders_production_line_id_fkey" FOREIGN KEY ("production_line_id") REFERENCES "production_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_order_assignments" ADD CONSTRAINT "job_order_assignments_job_order_id_fkey" FOREIGN KEY ("job_order_id") REFERENCES "job_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_order_assignments" ADD CONSTRAINT "job_order_assignments_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_order_assignments" ADD CONSTRAINT "job_order_assignments_assigned_by_user_id_fkey" FOREIGN KEY ("assigned_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_order_progress_entries" ADD CONSTRAINT "job_order_progress_entries_job_order_id_fkey" FOREIGN KEY ("job_order_id") REFERENCES "job_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_order_progress_entries" ADD CONSTRAINT "job_order_progress_entries_job_order_assignment_id_fkey" FOREIGN KEY ("job_order_assignment_id") REFERENCES "job_order_assignments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_order_progress_entries" ADD CONSTRAINT "job_order_progress_entries_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_order_progress_entries" ADD CONSTRAINT "job_order_progress_entries_recorded_by_user_id_fkey" FOREIGN KEY ("recorded_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_stage_transactions" ADD CONSTRAINT "production_stage_transactions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_stage_transactions" ADD CONSTRAINT "production_stage_transactions_production_order_id_fkey" FOREIGN KEY ("production_order_id") REFERENCES "production_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_stage_transactions" ADD CONSTRAINT "production_stage_transactions_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_stage_transactions" ADD CONSTRAINT "production_stage_transactions_from_job_order_id_fkey" FOREIGN KEY ("from_job_order_id") REFERENCES "job_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_stage_transactions" ADD CONSTRAINT "production_stage_transactions_to_job_order_id_fkey" FOREIGN KEY ("to_job_order_id") REFERENCES "job_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_stage_transactions" ADD CONSTRAINT "production_stage_transactions_from_production_stage_id_fkey" FOREIGN KEY ("from_production_stage_id") REFERENCES "production_stages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_stage_transactions" ADD CONSTRAINT "production_stage_transactions_to_production_stage_id_fkey" FOREIGN KEY ("to_production_stage_id") REFERENCES "production_stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_stage_transactions" ADD CONSTRAINT "production_stage_transactions_performed_by_user_id_fkey" FOREIGN KEY ("performed_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_inspections" ADD CONSTRAINT "qc_inspections_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_inspections" ADD CONSTRAINT "qc_inspections_production_order_id_fkey" FOREIGN KEY ("production_order_id") REFERENCES "production_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_inspections" ADD CONSTRAINT "qc_inspections_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_inspections" ADD CONSTRAINT "qc_inspections_job_order_id_fkey" FOREIGN KEY ("job_order_id") REFERENCES "job_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_inspections" ADD CONSTRAINT "qc_inspections_rework_stage_transaction_id_fkey" FOREIGN KEY ("rework_stage_transaction_id") REFERENCES "production_stage_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_inspections" ADD CONSTRAINT "qc_inspections_inspector_user_id_fkey" FOREIGN KEY ("inspector_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_defects" ADD CONSTRAINT "qc_defects_qc_inspection_id_fkey" FOREIGN KEY ("qc_inspection_id") REFERENCES "qc_inspections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_defects" ADD CONSTRAINT "qc_defects_defect_type_id_fkey" FOREIGN KEY ("defect_type_id") REFERENCES "defect_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "defect_types" ADD CONSTRAINT "defect_types_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Hand-added: the JobOrder quantity-consistency guard spans three columns
-- (completed + rejected + damaged <= planned), which can't be expressed as
-- Prisma's single-column guarded-updateMany idiom used everywhere else in
-- this codebase (e.g. MaterialRequestItem.issuedQuantity). The service
-- layer does a read-verify-write inside one transaction as the primary
-- correctness mechanism; this CHECK is the hard backstop against any future
-- direct-SQL mistake bypassing that layer.
ALTER TABLE "job_orders" ADD CONSTRAINT "job_orders_quantity_consistency_check"
  CHECK (completed_quantity + rejected_quantity + damaged_quantity <= planned_quantity);
