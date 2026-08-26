-- HRMS gap-analysis Priority 2 item: leave carry-forward automation.
-- Manually-triggered batch computation (this project has no job runner —
-- see customer-segments.service.ts's own note), one row per
-- employee+leaveType+target-year, unique constraint doubling as the
-- re-run idempotency guard.

-- CreateTable
CREATE TABLE "hrms_leave_balance_carry_forwards" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "leave_type_id" UUID NOT NULL,
    "from_year" INTEGER NOT NULL,
    "to_year" INTEGER NOT NULL,
    "carried_days" DECIMAL(6,2) NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hrms_leave_balance_carry_forwards_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "hrms_leave_balance_carry_forwards_company_id_employee_id_le_key" ON "hrms_leave_balance_carry_forwards"("company_id", "employee_id", "leave_type_id", "to_year");

-- AddForeignKey
ALTER TABLE "hrms_leave_balance_carry_forwards" ADD CONSTRAINT "hrms_leave_balance_carry_forwards_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hrms_leave_balance_carry_forwards" ADD CONSTRAINT "hrms_leave_balance_carry_forwards_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hrms_leave_balance_carry_forwards" ADD CONSTRAINT "hrms_leave_balance_carry_forwards_leave_type_id_fkey" FOREIGN KEY ("leave_type_id") REFERENCES "hrms_leave_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hrms_leave_balance_carry_forwards" ADD CONSTRAINT "hrms_leave_balance_carry_forwards_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
