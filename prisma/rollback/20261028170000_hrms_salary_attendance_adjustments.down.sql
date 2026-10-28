DROP TABLE IF EXISTS "hrms_leave_payment_changes";
DROP TABLE IF EXISTS "hrms_salary_attendance_adjustments";
DROP TYPE IF EXISTS "SalaryAdjustmentMode";
DELETE FROM "_prisma_migrations" WHERE migration_name = '20261028170000_hrms_salary_attendance_adjustments';
