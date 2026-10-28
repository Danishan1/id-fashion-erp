DROP TABLE IF EXISTS "hrms_salary_run_events";
DROP TABLE IF EXISTS "hrms_salary_run_line_edits";
DROP TABLE IF EXISTS "hrms_salary_run_lines";
DROP TABLE IF EXISTS "hrms_salary_runs";
DROP TYPE IF EXISTS "SalaryRunStatus";
DELETE FROM "_prisma_migrations" WHERE migration_name = '20261028190000_hrms_salary_runs';
