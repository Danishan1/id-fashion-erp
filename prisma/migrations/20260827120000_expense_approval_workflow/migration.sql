-- CreateEnum
CREATE TYPE "ExpenseApprovalStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'PAID', 'CANCELLED');

-- AlterEnum
ALTER TYPE "RelatedModule" ADD VALUE 'EMPLOYEE_ADVANCE_SETTLEMENT';

-- AlterTable: add the new columns first (all nullable, non-destructive)
ALTER TABLE "expenses" ADD COLUMN     "approved_at" TIMESTAMP(3),
ADD COLUMN     "approved_by_user_id" UUID,
ADD COLUMN     "rejected_at" TIMESTAMP(3),
ADD COLUMN     "rejected_by_user_id" UUID,
ADD COLUMN     "rejection_reason" TEXT;

-- Convert the status column to the new enum, mapping old values forward
-- rather than a destructive drop+recreate — DRAFT (still being decided) ->
-- PENDING_APPROVAL, POSTED (was paid in one step) -> PAID, CANCELLED stays.
ALTER TABLE "expenses" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "expenses" ALTER COLUMN "status" TYPE "ExpenseApprovalStatus" USING (
  CASE status::text
    WHEN 'DRAFT' THEN 'PENDING_APPROVAL'
    WHEN 'POSTED' THEN 'PAID'
    WHEN 'CANCELLED' THEN 'CANCELLED'
  END
)::"ExpenseApprovalStatus";
ALTER TABLE "expenses" ALTER COLUMN "status" SET DEFAULT 'PENDING_APPROVAL';

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_approved_by_user_id_fkey" FOREIGN KEY ("approved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_rejected_by_user_id_fkey" FOREIGN KEY ("rejected_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
