-- Rollback for 20261028260000_sales_enquiries_s1 (Sales Enquiries, S1).
-- Drops the sales fields and the activity timeline — sales stage, owner,
-- follow-ups, CRM company/contact links, qualification and notes are lost.
-- Enquiries, their lines and Merchandising's sampling workflow are untouched.
-- CRM opportunity links (crm_opportunity_erp_links) are CRM data and are kept.
BEGIN;

DROP TABLE IF EXISTS "buyer_enquiry_activities";

DROP INDEX IF EXISTS "buyer_enquiries_company_id_sales_stage_idx";
DROP INDEX IF EXISTS "buyer_enquiries_company_id_owner_user_id_idx";
DROP INDEX IF EXISTS "buyer_enquiries_company_id_next_follow_up_date_idx";

ALTER TABLE "buyer_enquiries"
    DROP CONSTRAINT IF EXISTS "buyer_enquiries_owner_user_id_fkey",
    DROP CONSTRAINT IF EXISTS "buyer_enquiries_crm_company_id_fkey",
    DROP CONSTRAINT IF EXISTS "buyer_enquiries_crm_contact_id_fkey",
    DROP COLUMN IF EXISTS "subject",
    DROP COLUMN IF EXISTS "sales_stage",
    DROP COLUMN IF EXISTS "stage_before_hold",
    DROP COLUMN IF EXISTS "stage_changed_at",
    DROP COLUMN IF EXISTS "priority",
    DROP COLUMN IF EXISTS "owner_user_id",
    DROP COLUMN IF EXISTS "next_follow_up_date",
    DROP COLUMN IF EXISTS "crm_company_id",
    DROP COLUMN IF EXISTS "crm_contact_id",
    DROP COLUMN IF EXISTS "estimated_value",
    DROP COLUMN IF EXISTS "expected_decision_date",
    DROP COLUMN IF EXISTS "next_action",
    DROP COLUMN IF EXISTS "qualification_notes",
    DROP COLUMN IF EXISTS "closure_reason",
    DROP COLUMN IF EXISTS "closed_at";

DROP TYPE IF EXISTS "SalesEnquiryActivityType";
DROP TYPE IF EXISTS "SalesEnquiryPriority";
DROP TYPE IF EXISTS "SalesEnquiryStage";

DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261028260000_sales_enquiries_s1';

COMMIT;
