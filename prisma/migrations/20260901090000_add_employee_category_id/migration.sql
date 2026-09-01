-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "employee_category_id" UUID;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_employee_category_id_fkey" FOREIGN KEY ("employee_category_id") REFERENCES "employee_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
