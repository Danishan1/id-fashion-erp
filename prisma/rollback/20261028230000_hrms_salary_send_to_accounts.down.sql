ALTER TABLE "hrms_salary_runs" DROP COLUMN IF EXISTS "sent_to_accounts_at", DROP COLUMN IF EXISTS "sent_to_accounts_by_user_id", DROP COLUMN IF EXISTS "accrual_journal_id";
-- RelatedModule.SALARY_RUN stays (Postgres cannot drop an enum value).
DELETE FROM "_prisma_migrations" WHERE migration_name = '20261028230000_hrms_salary_send_to_accounts';
