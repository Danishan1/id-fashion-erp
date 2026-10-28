DROP TABLE IF EXISTS "hrms_employee_salary_components";
DROP TABLE IF EXISTS "hrms_employee_salary_settings";
DROP TABLE IF EXISTS "hrms_salary_statutory_settings";
DROP TYPE IF EXISTS "SalaryComponentKind";
DROP TYPE IF EXISTS "SalaryStatutoryKind";
DELETE FROM "_prisma_migrations" WHERE migration_name = '20261028150000_hrms_salary_setup';
