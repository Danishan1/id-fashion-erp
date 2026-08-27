-- AlterEnum
ALTER TYPE "EmployeeAdvanceStatus" ADD VALUE 'DRAFT';

-- AlterTable
ALTER TABLE "employee_advances" ALTER COLUMN "status" SET DEFAULT 'DRAFT';
