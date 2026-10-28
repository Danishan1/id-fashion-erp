DROP TABLE IF EXISTS "hrms_salary_advance_recoveries";
DROP TABLE IF EXISTS "hrms_salary_advances";
ALTER TABLE "hrms_salary_run_lines" DROP CONSTRAINT IF EXISTS "hrms_salary_run_lines_installment_check", DROP COLUMN IF EXISTS "installment_amount", DROP COLUMN IF EXISTS "installment_json";
-- PaymentRequestType.SALARY_ADVANCE stays (Postgres cannot drop an enum value); delete any SALARY_ADVANCE payment requests first if needed.
DELETE FROM "_prisma_migrations" WHERE migration_name = '20261028210000_hrms_salary_advances';
