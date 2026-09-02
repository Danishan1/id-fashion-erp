-- CreateEnum
CREATE TYPE "EmployeePayType" AS ENUM ('FIXED_SALARY', 'PIECE_RATE');

-- CreateEnum
CREATE TYPE "ProgressEntrySource" AS ENUM ('SUPERVISOR', 'SELF');

-- CreateEnum
CREATE TYPE "ProgressEntryApprovalStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "dearness_allowance" DECIMAL(18,2),
ADD COLUMN     "fixed_monthly_salary" DECIMAL(18,2),
ADD COLUMN     "pay_type" "EmployeePayType",
ADD COLUMN     "piece_rate_per_unit" DECIMAL(18,4),
ADD COLUMN     "self_entry_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "travel_allowance" DECIMAL(18,2);

-- AlterTable
-- updated_at is added with a temporary DEFAULT so the NOT NULL constraint can
-- apply to pre-existing rows; those rows are then backfilled to match their
-- own created_at (more historically accurate than "now"), and the default is
-- dropped afterward since Prisma Client sets this column explicitly on every
-- write going forward (matching every other @updatedAt column in this schema,
-- none of which carry a DB-level default).
ALTER TABLE "job_order_progress_entries" ADD COLUMN     "approval_remark" TEXT,
ADD COLUMN     "approval_status" "ProgressEntryApprovalStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
ADD COLUMN     "approved_at" TIMESTAMP(3),
ADD COLUMN     "approved_by_user_id" UUID,
ADD COLUMN     "entered_by" "ProgressEntrySource" NOT NULL DEFAULT 'SUPERVISOR',
ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "job_order_progress_entries" SET "updated_at" = "created_at";

ALTER TABLE "job_order_progress_entries" ALTER COLUMN "updated_at" DROP DEFAULT;

-- CreateIndex
CREATE INDEX "job_order_progress_entries_approval_status_idx" ON "job_order_progress_entries"("approval_status");

-- AddForeignKey
ALTER TABLE "job_order_progress_entries" ADD CONSTRAINT "job_order_progress_entries_approved_by_user_id_fkey" FOREIGN KEY ("approved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
