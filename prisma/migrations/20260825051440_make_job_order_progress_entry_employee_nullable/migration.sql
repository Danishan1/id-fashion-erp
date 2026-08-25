-- DropForeignKey
ALTER TABLE "job_order_progress_entries" DROP CONSTRAINT "job_order_progress_entries_employee_id_fkey";

-- AlterTable
ALTER TABLE "job_order_progress_entries" ALTER COLUMN "employee_id" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "job_order_progress_entries" ADD CONSTRAINT "job_order_progress_entries_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
