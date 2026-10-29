-- Rollback for 20261028280000_sales_quotations_s3. Run before the S2 down script.
-- Loses approval/issue/send/decision data, the quotation timeline and the
-- Sales & Marketing settings. Quotations already ISSUED / ACCEPTED / REJECTED
-- keep that status (S2 code only edits DRAFT and cancels DRAFT).
BEGIN;
DROP TABLE IF EXISTS "quotation_events";
DROP TABLE IF EXISTS "sales_marketing_settings";
ALTER TABLE "quotation_revisions"
    DROP COLUMN IF EXISTS "revision_reason",
    DROP COLUMN IF EXISTS "previous_revision_id",
    DROP COLUMN IF EXISTS "approval_required",
    DROP COLUMN IF EXISTS "approval_reasons",
    DROP COLUMN IF EXISTS "submitted_at",
    DROP COLUMN IF EXISTS "submitted_by_user_id",
    DROP COLUMN IF EXISTS "approved_at",
    DROP COLUMN IF EXISTS "approved_by_user_id",
    DROP COLUMN IF EXISTS "approval_comment",
    DROP COLUMN IF EXISTS "issued_at",
    DROP COLUMN IF EXISTS "issued_by_user_id",
    DROP COLUMN IF EXISTS "document_snapshot",
    DROP COLUMN IF EXISTS "sent_at",
    DROP COLUMN IF EXISTS "sent_by_user_id",
    DROP COLUMN IF EXISTS "sent_to",
    DROP COLUMN IF EXISTS "sent_method",
    DROP COLUMN IF EXISTS "customer_decision_at",
    DROP COLUMN IF EXISTS "decision_recorded_at",
    DROP COLUMN IF EXISTS "decision_recorded_by_id",
    DROP COLUMN IF EXISTS "decision_method",
    DROP COLUMN IF EXISTS "customer_reference",
    DROP COLUMN IF EXISTS "decision_comment";
DELETE FROM "permissions" WHERE "module" = 'sales_marketing_settings';
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261028280000_sales_quotations_s3';
COMMIT;
