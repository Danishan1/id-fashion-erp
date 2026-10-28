-- Rollback for 20261028130000_payment_request_invoice_lines.
DROP TABLE IF EXISTS "payment_request_invoice_lines";
ALTER TABLE "payment_requests"
  DROP COLUMN IF EXISTS "invoice_date",
  DROP COLUMN IF EXISTS "invoice_discount_total",
  DROP COLUMN IF EXISTS "invoice_grand_total",
  DROP COLUMN IF EXISTS "invoice_gst_total",
  DROP COLUMN IF EXISTS "invoice_number",
  DROP COLUMN IF EXISTS "invoice_taxable_total",
  DROP COLUMN IF EXISTS "is_itc_applicable",
  DROP COLUMN IF EXISTS "is_raw_material_for_production",
  DROP COLUMN IF EXISTS "is_reverse_charge",
  DROP COLUMN IF EXISTS "pay_to_gstin",
  DROP COLUMN IF EXISTS "place_of_supply_state_code";
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261028130000_payment_request_invoice_lines';
