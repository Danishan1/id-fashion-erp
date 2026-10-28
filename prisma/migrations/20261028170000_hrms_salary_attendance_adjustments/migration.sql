-- CreateEnum
CREATE TYPE "SalaryAdjustmentMode" AS ENUM ('FIXED_HOURS', 'OFFICE_TIME', 'FULL_DAY');


-- CreateTable
CREATE TABLE "hrms_salary_attendance_adjustments" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "attendance_date" DATE NOT NULL,
    "mode" "SalaryAdjustmentMode" NOT NULL,
    "hours" DECIMAL(5,2),
    "actual_hours" DECIMAL(5,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removed_at" TIMESTAMP(3),
    "removed_by_user_id" UUID,
    "remove_reason" TEXT,

    CONSTRAINT "hrms_salary_attendance_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hrms_leave_payment_changes" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "leave_day_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "from_type" "LeavePaymentType" NOT NULL,
    "to_type" "LeavePaymentType" NOT NULL,
    "from_remaining" DECIMAL(4,2) NOT NULL DEFAULT 0,
    "from_carry" DECIMAL(4,2) NOT NULL DEFAULT 0,
    "reason" TEXT NOT NULL,
    "changed_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hrms_leave_payment_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "hrms_salary_attendance_adjustments_company_id_employee_id_a_idx" ON "hrms_salary_attendance_adjustments"("company_id", "employee_id", "attendance_date");

-- CreateIndex
CREATE INDEX "hrms_leave_payment_changes_leave_day_id_idx" ON "hrms_leave_payment_changes"("leave_day_id");

-- CreateIndex
CREATE INDEX "hrms_leave_payment_changes_company_id_employee_id_idx" ON "hrms_leave_payment_changes"("company_id", "employee_id");

-- AddForeignKey
ALTER TABLE "hrms_salary_attendance_adjustments" ADD CONSTRAINT "hrms_salary_attendance_adjustments_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hrms_salary_attendance_adjustments" ADD CONSTRAINT "hrms_salary_attendance_adjustments_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hrms_leave_payment_changes" ADD CONSTRAINT "hrms_leave_payment_changes_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hrms_leave_payment_changes" ADD CONSTRAINT "hrms_leave_payment_changes_leave_day_id_fkey" FOREIGN KEY ("leave_day_id") REFERENCES "hrms_leave_days"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Hand-added: one active adjustment per employee per day; sane hours.
CREATE UNIQUE INDEX "hrms_salary_attendance_adjustments_one_active_per_day"
  ON "hrms_salary_attendance_adjustments"("employee_id", "attendance_date") WHERE "removed_at" IS NULL;
ALTER TABLE "hrms_salary_attendance_adjustments" ADD CONSTRAINT "hrms_salary_attendance_adjustments_hours_check"
  CHECK (("mode" = 'FULL_DAY' AND "hours" IS NULL) OR ("mode" <> 'FULL_DAY' AND "hours" > 0 AND "hours" <= 24));
ALTER TABLE "hrms_leave_payment_changes" ADD CONSTRAINT "hrms_leave_payment_changes_type_check" CHECK ("from_type" <> "to_type");
