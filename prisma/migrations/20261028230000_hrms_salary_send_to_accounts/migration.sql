-- AlterEnum
ALTER TYPE "RelatedModule" ADD VALUE 'SALARY_RUN';

ALTER TABLE "hrms_salary_runs" ADD COLUMN     "accrual_journal_id" UUID,
ADD COLUMN     "sent_to_accounts_at" TIMESTAMP(3),
ADD COLUMN     "sent_to_accounts_by_user_id" UUID;


