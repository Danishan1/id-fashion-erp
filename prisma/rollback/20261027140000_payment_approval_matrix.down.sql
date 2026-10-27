-- Rollback for 20261027140000_payment_approval_matrix
ALTER TABLE "payment_requests" DROP CONSTRAINT IF EXISTS "payment_requests_approval_rule_id_fkey";
ALTER TABLE "payment_requests" DROP COLUMN IF EXISTS "approval_plan_json", DROP COLUMN IF EXISTS "approval_rule_id", DROP COLUMN IF EXISTS "approver_may_pay", DROP COLUMN IF EXISTS "current_approval_level", DROP COLUMN IF EXISTS "current_approver_role_ids", DROP COLUMN IF EXISTS "current_approver_user_ids", DROP COLUMN IF EXISTS "current_level_any_approver", DROP COLUMN IF EXISTS "required_approval_levels";
DROP TABLE IF EXISTS "payment_request_approvals";
DROP TABLE IF EXISTS "payment_approval_rule_approvers";
DROP TABLE IF EXISTS "payment_approval_rules";
DROP TYPE IF EXISTS "PaymentApprovalDecision";
DELETE FROM "permissions" WHERE "module" = 'payment_request_settings';
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261027140000_payment_approval_matrix';
