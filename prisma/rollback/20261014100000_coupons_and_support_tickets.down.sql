-- Rollback of 20261014100000_coupons_and_support_tickets (Platform SaaS Phase 5).
-- DATA LOSS: every coupon, redemption, support ticket, ticket message and
-- ticket attachment row. Uploaded ticket files stay on disk (orphaned).
-- Payments keep their final amount; the list/discount/free-months detail is lost.

DROP TABLE IF EXISTS "support_ticket_attachments";
DROP TABLE IF EXISTS "support_ticket_messages";
DROP TABLE IF EXISTS "support_tickets";
DROP TABLE IF EXISTS "coupon_redemptions";
DROP TABLE IF EXISTS "coupon_plans";

ALTER TABLE "subscription_payments" DROP CONSTRAINT IF EXISTS "subscription_payments_discount_check";
ALTER TABLE "subscription_payments" DROP CONSTRAINT IF EXISTS "subscription_payments_coupon_id_fkey";
ALTER TABLE "subscription_payments"
  DROP COLUMN IF EXISTS "coupon_id",
  DROP COLUMN IF EXISTS "discount_amount",
  DROP COLUMN IF EXISTS "free_months",
  DROP COLUMN IF EXISTS "list_amount";

DROP TABLE IF EXISTS "coupons";

DROP TYPE IF EXISTS "CouponDiscountType";
DROP TYPE IF EXISTS "SupportTicketStatus";
DROP TYPE IF EXISTS "SupportTicketPriority";
DROP TYPE IF EXISTS "SupportTicketCategory";
DROP TYPE IF EXISTS "SupportTicketAuthorType";

-- DocumentType gained 'SUPPORT_TICKET'. Postgres can't drop an enum value, so
-- rebuild the type without it (every column of that type is converted).
DELETE FROM "document_sequences" WHERE "document_type"::text = 'SUPPORT_TICKET';
DO $$
DECLARE
  labels text;
  col record;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'DocumentType' AND e.enumlabel = 'SUPPORT_TICKET'
  ) THEN
    RETURN;
  END IF;
  SELECT string_agg(quote_literal(e.enumlabel), ', ' ORDER BY e.enumsortorder) INTO labels
  FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
  WHERE t.typname = 'DocumentType' AND e.enumlabel <> 'SUPPORT_TICKET';
  ALTER TYPE "DocumentType" RENAME TO "DocumentType_old";
  EXECUTE format('CREATE TYPE "DocumentType" AS ENUM (%s)', labels);
  FOR col IN
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND udt_name = 'DocumentType_old'
  LOOP
    EXECUTE format(
      'ALTER TABLE %I ALTER COLUMN %I TYPE "DocumentType" USING %I::text::"DocumentType"',
      col.table_name, col.column_name, col.column_name
    );
  END LOOP;
  DROP TYPE "DocumentType_old";
END $$;

DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261014100000_coupons_and_support_tickets';
