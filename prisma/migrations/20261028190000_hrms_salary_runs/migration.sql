-- CreateEnum
CREATE TYPE "SalaryRunStatus" AS ENUM ('DRAFT', 'APPROVED', 'FINALISED');


-- CreateTable
CREATE TABLE "hrms_salary_runs" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "status" "SalaryRunStatus" NOT NULL DEFAULT 'DRAFT',
    "generated_by_user_id" UUID NOT NULL,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approved_by_user_id" UUID,
    "approved_at" TIMESTAMP(3),
    "finalised_by_user_id" UUID,
    "finalised_at" TIMESTAMP(3),
    "sent_back_reason" TEXT,
    "reopen_reason" TEXT,
    "total_gross" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "total_deductions" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "total_net" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hrms_salary_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hrms_salary_run_lines" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "employee_code" TEXT NOT NULL,
    "employee_name" TEXT NOT NULL,
    "setup_json" JSONB NOT NULL,
    "calendar_days" INTEGER NOT NULL,
    "system_present_days" DECIMAL(6,2) NOT NULL,
    "system_paid_leave_days" DECIMAL(6,2) NOT NULL,
    "auto_paid_leave_days" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "unpaid_leave_days" DECIMAL(6,2) NOT NULL,
    "absent_days" DECIMAL(6,2) NOT NULL,
    "weekend_days" DECIMAL(6,2) NOT NULL,
    "holiday_days" DECIMAL(6,2) NOT NULL,
    "system_extra_days" DECIMAL(6,2) NOT NULL,
    "overtime_hours" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "attendance_percent" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "has_no_punches" BOOLEAN NOT NULL DEFAULT false,
    "present_days" DECIMAL(6,2),
    "paid_leave_days" DECIMAL(6,2),
    "extra_days" DECIMAL(6,2),
    "arrears_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "arrears_reason" TEXT,
    "amounts_json" JSONB NOT NULL,
    "gross_amount" DECIMAL(18,2) NOT NULL,
    "total_deductions" DECIMAL(18,2) NOT NULL,
    "net_amount" DECIMAL(18,2) NOT NULL,
    "leave_spend_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hrms_salary_run_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hrms_salary_run_line_edits" (
    "id" UUID NOT NULL,
    "line_id" UUID NOT NULL,
    "field" TEXT NOT NULL,
    "old_value" TEXT,
    "new_value" TEXT,
    "reason" TEXT NOT NULL,
    "edited_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hrms_salary_run_line_edits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hrms_salary_run_events" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hrms_salary_run_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "hrms_salary_runs_company_id_year_month_key" ON "hrms_salary_runs"("company_id", "year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "hrms_salary_run_lines_run_id_employee_id_key" ON "hrms_salary_run_lines"("run_id", "employee_id");

-- CreateIndex
CREATE INDEX "hrms_salary_run_line_edits_line_id_idx" ON "hrms_salary_run_line_edits"("line_id");

-- CreateIndex
CREATE INDEX "hrms_salary_run_events_run_id_idx" ON "hrms_salary_run_events"("run_id");

-- AddForeignKey
ALTER TABLE "hrms_salary_runs" ADD CONSTRAINT "hrms_salary_runs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hrms_salary_run_lines" ADD CONSTRAINT "hrms_salary_run_lines_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "hrms_salary_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hrms_salary_run_lines" ADD CONSTRAINT "hrms_salary_run_lines_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hrms_salary_run_line_edits" ADD CONSTRAINT "hrms_salary_run_line_edits_line_id_fkey" FOREIGN KEY ("line_id") REFERENCES "hrms_salary_run_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hrms_salary_run_events" ADD CONSTRAINT "hrms_salary_run_events_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "hrms_salary_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Hand-added checks
ALTER TABLE "hrms_salary_runs" ADD CONSTRAINT "hrms_salary_runs_month_check" CHECK ("month" BETWEEN 1 AND 12);
ALTER TABLE "hrms_salary_run_lines" ADD CONSTRAINT "hrms_salary_run_lines_amounts_check"
  CHECK ("net_amount" >= 0 AND "gross_amount" >= 0 AND "total_deductions" >= 0
    AND ("present_days" IS NULL OR "present_days" >= 0) AND ("paid_leave_days" IS NULL OR "paid_leave_days" >= 0)
    AND ("extra_days" IS NULL OR "extra_days" >= 0));
