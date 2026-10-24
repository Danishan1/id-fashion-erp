-- CreateEnum
CREATE TYPE "AttendanceWeekday" AS ENUM ('SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY');

-- CreateEnum
CREATE TYPE "AttendanceSessionStatus" AS ENUM ('PRESENT', 'PRESENT_FROM_OUTSIDE', 'REMOTE');

-- CreateEnum
CREATE TYPE "AttendanceSessionSource" AS ENUM ('SELF_PUNCH', 'MANUAL', 'REGULARIZATION');

-- CreateEnum
CREATE TYPE "AttendanceRegularizationType" AS ENUM ('MISSED_PUNCH', 'MISSED_LOGOUT', 'CHANGE_LOGIN', 'CHANGE_LOGOUT', 'LEAVE_NOT_TAKEN', 'EMERGENCY_LEAVE');

-- CreateEnum
CREATE TYPE "OutdoorRejectionStatus" AS ENUM ('PENDING', 'IN_PROCESS', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AttendanceOvertimeStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "LeaveDurationType" AS ENUM ('FULL', 'F_HALF', 'S_HALF', 'QR1', 'QR2', 'QR3', 'QR4');

-- CreateEnum
CREATE TYPE "LeavePaymentType" AS ENUM ('PAID', 'NOT_PAID');

-- CreateEnum
CREATE TYPE "LeaveAllocationType" AS ENUM ('MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'YEARLY');


ALTER TABLE "hrms_attendance_correction_requests" ADD COLUMN     "date_from" DATE,
ADD COLUMN     "date_to" DATE,
ADD COLUMN     "leave_type_id" UUID,
ADD COLUMN     "remark" TEXT,
ADD COLUMN     "session_id" UUID,
ADD COLUMN     "type" "AttendanceRegularizationType" NOT NULL DEFAULT 'MISSED_PUNCH';


ALTER TABLE "hrms_leave_types" ADD COLUMN     "allocation_type" "LeaveAllocationType" NOT NULL DEFAULT 'MONTHLY',
ADD COLUMN     "quota_per_period" DECIMAL(6,2) NOT NULL DEFAULT 0;



-- CreateTable
CREATE TABLE "hrms_attendance_settings" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "default_weekends" "AttendanceWeekday"[] DEFAULT ARRAY['SUNDAY']::"AttendanceWeekday"[],
    "gps_accuracy_meters" INTEGER NOT NULL DEFAULT 50,
    "max_session_hours" INTEGER NOT NULL DEFAULT 18,
    "status_tolerance_minutes" INTEGER NOT NULL DEFAULT 15,
    "face_match_threshold" DECIMAL(4,2) NOT NULL DEFAULT 0.45,
    "face_match_frames" INTEGER NOT NULL DEFAULT 3,
    "require_face" BOOLEAN NOT NULL DEFAULT true,
    "updated_by_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hrms_attendance_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hrms_attendance_locations" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "radius_meters" INTEGER NOT NULL DEFAULT 100,
    "address" TEXT,
    "branch_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hrms_attendance_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hrms_employee_attendance_profiles" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "use_company_weekends" BOOLEAN NOT NULL DEFAULT true,
    "weekends" "AttendanceWeekday"[] DEFAULT ARRAY[]::"AttendanceWeekday"[],
    "overtime_rate_per_hour" DECIMAL(18,2),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hrms_employee_attendance_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hrms_employee_face_photos" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "storage_key" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "uploaded_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hrms_employee_face_photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hrms_attendance_sessions" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "attendance_record_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "check_in_at" TIMESTAMP(3) NOT NULL,
    "check_out_at" TIMESTAMP(3),
    "status" "AttendanceSessionStatus" NOT NULL DEFAULT 'PRESENT',
    "source" "AttendanceSessionSource" NOT NULL DEFAULT 'SELF_PUNCH',
    "is_login_from_office" BOOLEAN NOT NULL DEFAULT true,
    "is_logout_from_office" BOOLEAN NOT NULL DEFAULT true,
    "in_latitude" DOUBLE PRECISION,
    "in_longitude" DOUBLE PRECISION,
    "in_accuracy_meters" DOUBLE PRECISION,
    "in_address" TEXT,
    "in_location_id" UUID,
    "in_distance_meters" DOUBLE PRECISION,
    "in_selfie_key" TEXT,
    "in_selfie_mime" TEXT,
    "out_latitude" DOUBLE PRECISION,
    "out_longitude" DOUBLE PRECISION,
    "out_accuracy_meters" DOUBLE PRECISION,
    "out_address" TEXT,
    "out_location_id" UUID,
    "out_distance_meters" DOUBLE PRECISION,
    "out_selfie_key" TEXT,
    "out_selfie_mime" TEXT,
    "in_face_photo_id" UUID,
    "out_face_photo_id" UUID,
    "remarks" TEXT,
    "created_by_user_id" UUID NOT NULL,
    "updated_by_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hrms_attendance_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hrms_overtime_records" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "attendance_date" DATE NOT NULL,
    "hours" DECIMAL(5,2) NOT NULL,
    "worked_hours" DECIMAL(5,2) NOT NULL,
    "shift_hours" DECIMAL(5,2) NOT NULL,
    "reason" TEXT,
    "status" "AttendanceOvertimeStatus" NOT NULL DEFAULT 'PENDING',
    "rejection_reason" TEXT,
    "decided_by_user_id" UUID,
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hrms_overtime_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hrms_outdoor_rejections" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "original_check_in" TIMESTAMP(3) NOT NULL,
    "original_check_out" TIMESTAMP(3),
    "trimmed_check_in" TIMESTAMP(3) NOT NULL,
    "trimmed_check_out" TIMESTAMP(3),
    "rejected_reason" TEXT,
    "status" "OutdoorRejectionStatus" NOT NULL DEFAULT 'PENDING',
    "clarification_reason" TEXT,
    "clarification_proof_key" TEXT,
    "clarification_proof_mime" TEXT,
    "clarification_proof_name" TEXT,
    "clarified_at" TIMESTAMP(3),
    "rejected_by_user_id" UUID NOT NULL,
    "rejected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_by_user_id" UUID,
    "decided_at" TIMESTAMP(3),
    "is_revoked" BOOLEAN NOT NULL DEFAULT false,
    "revoked_by_user_id" UUID,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "hrms_outdoor_rejections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hrms_leave_balances" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "leave_type_id" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "allocated" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "used" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "remaining" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "carry_forward" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "is_adjusted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hrms_leave_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hrms_leave_days" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "leave_request_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "leave_date" DATE NOT NULL,
    "duration_type" "LeaveDurationType" NOT NULL DEFAULT 'FULL',
    "fraction" DECIMAL(4,2) NOT NULL,
    "is_sandwich" BOOLEAN NOT NULL DEFAULT false,
    "payment_type" "LeavePaymentType",
    "paid_from_remaining" DECIMAL(4,2) NOT NULL DEFAULT 0,
    "paid_from_carry" DECIMAL(4,2) NOT NULL DEFAULT 0,
    "leave_balance_id" UUID,
    "taken" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hrms_leave_days_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hrms_auto_leave_history" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "leave_type_id" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "used" DECIMAL(6,2) NOT NULL,
    "pre_remaining" DECIMAL(6,2) NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hrms_auto_leave_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hrms_attendance_month_closes" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "snapshot_json" JSONB NOT NULL,
    "closed_by_user_id" UUID NOT NULL,
    "closed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hrms_attendance_month_closes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "hrms_attendance_settings_company_id_key" ON "hrms_attendance_settings"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "hrms_attendance_locations_company_id_name_key" ON "hrms_attendance_locations"("company_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "hrms_employee_attendance_profiles_employee_id_key" ON "hrms_employee_attendance_profiles"("employee_id");

-- CreateIndex
CREATE INDEX "hrms_employee_face_photos_employee_id_idx" ON "hrms_employee_face_photos"("employee_id");

-- CreateIndex
CREATE INDEX "hrms_attendance_sessions_employee_id_check_in_at_idx" ON "hrms_attendance_sessions"("employee_id", "check_in_at");

-- CreateIndex
CREATE INDEX "hrms_attendance_sessions_company_id_check_in_at_idx" ON "hrms_attendance_sessions"("company_id", "check_in_at");

-- CreateIndex
CREATE INDEX "hrms_attendance_sessions_attendance_record_id_idx" ON "hrms_attendance_sessions"("attendance_record_id");

-- CreateIndex
CREATE INDEX "hrms_overtime_records_company_id_status_idx" ON "hrms_overtime_records"("company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "hrms_overtime_records_employee_id_attendance_date_key" ON "hrms_overtime_records"("employee_id", "attendance_date");

-- CreateIndex
CREATE INDEX "hrms_outdoor_rejections_company_id_status_idx" ON "hrms_outdoor_rejections"("company_id", "status");

-- CreateIndex
CREATE INDEX "hrms_outdoor_rejections_employee_id_idx" ON "hrms_outdoor_rejections"("employee_id");

-- CreateIndex
CREATE INDEX "hrms_leave_balances_company_id_year_month_idx" ON "hrms_leave_balances"("company_id", "year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "hrms_leave_balances_employee_id_leave_type_id_year_month_key" ON "hrms_leave_balances"("employee_id", "leave_type_id", "year", "month");

-- CreateIndex
CREATE INDEX "hrms_leave_days_employee_id_leave_date_idx" ON "hrms_leave_days"("employee_id", "leave_date");

-- CreateIndex
CREATE INDEX "hrms_leave_days_leave_request_id_idx" ON "hrms_leave_days"("leave_request_id");

-- CreateIndex
CREATE UNIQUE INDEX "hrms_auto_leave_history_employee_id_leave_type_id_year_mont_key" ON "hrms_auto_leave_history"("employee_id", "leave_type_id", "year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "hrms_attendance_month_closes_company_id_year_month_key" ON "hrms_attendance_month_closes"("company_id", "year", "month");

-- AddForeignKey
ALTER TABLE "hrms_attendance_settings" ADD CONSTRAINT "hrms_attendance_settings_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hrms_attendance_locations" ADD CONSTRAINT "hrms_attendance_locations_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hrms_employee_attendance_profiles" ADD CONSTRAINT "hrms_employee_attendance_profiles_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hrms_employee_attendance_profiles" ADD CONSTRAINT "hrms_employee_attendance_profiles_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hrms_employee_face_photos" ADD CONSTRAINT "hrms_employee_face_photos_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hrms_employee_face_photos" ADD CONSTRAINT "hrms_employee_face_photos_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hrms_attendance_sessions" ADD CONSTRAINT "hrms_attendance_sessions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hrms_attendance_sessions" ADD CONSTRAINT "hrms_attendance_sessions_attendance_record_id_fkey" FOREIGN KEY ("attendance_record_id") REFERENCES "hrms_attendance_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hrms_attendance_sessions" ADD CONSTRAINT "hrms_attendance_sessions_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hrms_attendance_sessions" ADD CONSTRAINT "hrms_attendance_sessions_in_location_id_fkey" FOREIGN KEY ("in_location_id") REFERENCES "hrms_attendance_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hrms_attendance_sessions" ADD CONSTRAINT "hrms_attendance_sessions_out_location_id_fkey" FOREIGN KEY ("out_location_id") REFERENCES "hrms_attendance_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hrms_overtime_records" ADD CONSTRAINT "hrms_overtime_records_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hrms_overtime_records" ADD CONSTRAINT "hrms_overtime_records_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hrms_overtime_records" ADD CONSTRAINT "hrms_overtime_records_decided_by_user_id_fkey" FOREIGN KEY ("decided_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hrms_outdoor_rejections" ADD CONSTRAINT "hrms_outdoor_rejections_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hrms_outdoor_rejections" ADD CONSTRAINT "hrms_outdoor_rejections_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hrms_outdoor_rejections" ADD CONSTRAINT "hrms_outdoor_rejections_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "hrms_attendance_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hrms_outdoor_rejections" ADD CONSTRAINT "hrms_outdoor_rejections_rejected_by_user_id_fkey" FOREIGN KEY ("rejected_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hrms_leave_balances" ADD CONSTRAINT "hrms_leave_balances_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hrms_leave_balances" ADD CONSTRAINT "hrms_leave_balances_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hrms_leave_balances" ADD CONSTRAINT "hrms_leave_balances_leave_type_id_fkey" FOREIGN KEY ("leave_type_id") REFERENCES "hrms_leave_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hrms_leave_days" ADD CONSTRAINT "hrms_leave_days_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hrms_leave_days" ADD CONSTRAINT "hrms_leave_days_leave_request_id_fkey" FOREIGN KEY ("leave_request_id") REFERENCES "hrms_leave_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hrms_leave_days" ADD CONSTRAINT "hrms_leave_days_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hrms_leave_days" ADD CONSTRAINT "hrms_leave_days_leave_balance_id_fkey" FOREIGN KEY ("leave_balance_id") REFERENCES "hrms_leave_balances"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hrms_auto_leave_history" ADD CONSTRAINT "hrms_auto_leave_history_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hrms_auto_leave_history" ADD CONSTRAINT "hrms_auto_leave_history_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hrms_attendance_month_closes" ADD CONSTRAINT "hrms_attendance_month_closes_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Only one open self-punch session per employee (race guard for Punch IN).
CREATE UNIQUE INDEX "hrms_attendance_sessions_one_open_self_punch"
  ON "hrms_attendance_sessions" ("employee_id")
  WHERE "check_out_at" IS NULL AND "source" = 'SELF_PUNCH';

ALTER TABLE "hrms_attendance_sessions"
  ADD CONSTRAINT "hrms_attendance_sessions_out_after_in_check"
  CHECK ("check_out_at" IS NULL OR "check_out_at" > "check_in_at");

ALTER TABLE "hrms_overtime_records"
  ADD CONSTRAINT "hrms_overtime_records_hours_check" CHECK ("hours" >= 0);

ALTER TABLE "hrms_leave_balances"
  ADD CONSTRAINT "hrms_leave_balances_non_negative_check"
  CHECK ("allocated" >= 0 AND "used" >= 0 AND "remaining" >= 0 AND "carry_forward" >= 0);

-- Backfill: every existing day record with a punch-in becomes one MANUAL session.
INSERT INTO "hrms_attendance_sessions"
  ("id", "company_id", "attendance_record_id", "employee_id", "check_in_at", "check_out_at",
   "status", "source", "created_by_user_id", "updated_at")
SELECT gen_random_uuid(), r."company_id", r."id", r."employee_id", r."punch_in",
       CASE WHEN r."punch_out" > r."punch_in" THEN r."punch_out" ELSE NULL END,
       'PRESENT', 'MANUAL', r."recorded_by_user_id", CURRENT_TIMESTAMP
FROM "hrms_attendance_records" r
WHERE r."punch_in" IS NOT NULL;
