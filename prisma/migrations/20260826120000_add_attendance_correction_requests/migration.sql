-- HRMS gap-analysis Priority 2 item: attendance correction / regularization
-- workflow. Direct attendance edits previously had no request/approval
-- trail — this mirrors LeaveRequest's own submit -> approve/reject shape.

-- CreateEnum
CREATE TYPE "AttendanceCorrectionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "hrms_attendance_correction_requests" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "attendance_record_id" UUID,
    "attendance_date" DATE NOT NULL,
    "requested_punch_in" TIMESTAMP(3),
    "requested_punch_out" TIMESTAMP(3),
    "reason" TEXT NOT NULL,
    "status" "AttendanceCorrectionStatus" NOT NULL DEFAULT 'PENDING',
    "rejection_reason" TEXT,
    "approved_by_user_id" UUID,
    "decided_at" TIMESTAMP(3),
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hrms_attendance_correction_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "hrms_attendance_correction_requests_company_id_employee_id_idx" ON "hrms_attendance_correction_requests"("company_id", "employee_id");

-- CreateIndex
CREATE INDEX "hrms_attendance_correction_requests_company_id_status_idx" ON "hrms_attendance_correction_requests"("company_id", "status");

-- AddForeignKey
ALTER TABLE "hrms_attendance_correction_requests" ADD CONSTRAINT "hrms_attendance_correction_requests_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hrms_attendance_correction_requests" ADD CONSTRAINT "hrms_attendance_correction_requests_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hrms_attendance_correction_requests" ADD CONSTRAINT "hrms_attendance_correction_requests_attendance_record_id_fkey" FOREIGN KEY ("attendance_record_id") REFERENCES "hrms_attendance_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hrms_attendance_correction_requests" ADD CONSTRAINT "hrms_attendance_correction_requests_approved_by_user_id_fkey" FOREIGN KEY ("approved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hrms_attendance_correction_requests" ADD CONSTRAINT "hrms_attendance_correction_requests_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
