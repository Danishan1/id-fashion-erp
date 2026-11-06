-- Sales & Marketing Release 1 / S2 — Quotations core (2026-10-28).
-- Adds quotations (header) → quotation_revisions (commercial content, totals)
-- → quotation_lines, the QUOTATION document type (QUO-YYYY-#####, numbered
-- company-wide) and attachment module, and a new permission module
-- "sales_quotations" in the SALES_MARKETING package.
-- Rollback: prisma/rollback/20261028270000_sales_quotations_s2.down.sql

-- AlterEnum
ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'QUOTATION';

-- AlterEnum
ALTER TYPE "RelatedModule" ADD VALUE IF NOT EXISTS 'QUOTATION';

-- CreateEnum
CREATE TYPE "QuotationStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ISSUED', 'ACCEPTED', 'REJECTED', 'CONVERTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "QuotationRevisionStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ISSUED', 'SUPERSEDED', 'ACCEPTED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "QuotationLineType" AS ENUM ('STYLE', 'DESIGN', 'FREE_TEXT');

-- CreateTable
CREATE TABLE "quotations" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "quotation_number" TEXT NOT NULL,
    "buyer_enquiry_id" UUID,
    "customer_id" UUID,
    "buyer_id" UUID,
    "prospect_name" TEXT,
    "crm_company_id" UUID,
    "crm_contact_id" UUID,
    "owner_user_id" UUID,
    "status" "QuotationStatus" NOT NULL DEFAULT 'DRAFT',
    "current_revision_number" INTEGER NOT NULL DEFAULT 1,
    "cancelled_at" TIMESTAMP(3),
    "cancellation_reason" TEXT,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quotations_pkey" PRIMARY KEY ("id"),
    -- A quotation is for a Customer or a named prospect, never neither.
    CONSTRAINT "quotations_party_check" CHECK ("customer_id" IS NOT NULL OR "prospect_name" IS NOT NULL)
);

-- CreateTable
CREATE TABLE "quotation_revisions" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "quotation_id" UUID NOT NULL,
    "revision_number" INTEGER NOT NULL,
    "status" "QuotationRevisionStatus" NOT NULL DEFAULT 'DRAFT',
    "title" TEXT NOT NULL,
    "quotation_date" DATE NOT NULL,
    "valid_until" DATE NOT NULL,
    "currency_code" CHAR(3) NOT NULL,
    "company_state_code" VARCHAR(2),
    "place_of_supply_state_code" VARCHAR(2),
    "is_inter_state" BOOLEAN NOT NULL DEFAULT false,
    "billing_address" TEXT,
    "shipping_address" TEXT,
    "payment_terms_days" INTEGER,
    "delivery_terms" TEXT,
    "introduction" TEXT,
    "customer_notes" TEXT,
    "internal_notes" TEXT,
    "terms_and_conditions" TEXT,
    "freight_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "freight_tax_rate_id" UUID,
    "freight_gst_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "freight_tax_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "other_charges_label" TEXT,
    "other_charges_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "other_charges_tax_rate_id" UUID,
    "other_charges_gst_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "other_charges_tax_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "subtotal_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "discount_total" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "taxable_total" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "charges_total" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "cgst_total" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "sgst_total" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "igst_total" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "tax_total" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "grand_total" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_user_id" UUID NOT NULL,
    "updated_by_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quotation_revisions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "quotation_revisions_validity_check" CHECK ("valid_until" >= "quotation_date"),
    CONSTRAINT "quotation_revisions_amounts_check" CHECK ("freight_amount" >= 0 AND "other_charges_amount" >= 0)
);

-- CreateTable
CREATE TABLE "quotation_lines" (
    "id" UUID NOT NULL,
    "revision_id" UUID NOT NULL,
    "line_number" INTEGER NOT NULL,
    "line_type" "QuotationLineType" NOT NULL,
    "product_id" UUID,
    "sample_request_id" UUID,
    "buyer_enquiry_line_id" UUID,
    "description" TEXT NOT NULL,
    "color_size_remarks" TEXT,
    "customer_reference" TEXT,
    "quantity" DECIMAL(18,3) NOT NULL,
    "uom_id" UUID,
    "unit_price" DECIMAL(18,2) NOT NULL,
    "discount_percent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "tax_rate_id" UUID,
    "gst_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "gross_amount" DECIMAL(18,2) NOT NULL,
    "discount_amount" DECIMAL(18,2) NOT NULL,
    "taxable_amount" DECIMAL(18,2) NOT NULL,
    "cgst_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "cgst_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "sgst_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "sgst_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "igst_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "igst_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "tax_amount" DECIMAL(18,2) NOT NULL,
    "line_total" DECIMAL(18,2) NOT NULL,
    "requested_delivery_date" DATE,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quotation_lines_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "quotation_lines_values_check" CHECK ("quantity" > 0 AND "unit_price" >= 0 AND "discount_percent" >= 0 AND "discount_percent" <= 100 AND "gst_rate" >= 0)
);

-- CreateIndex
CREATE UNIQUE INDEX "quotations_company_id_quotation_number_key" ON "quotations"("company_id", "quotation_number");
CREATE INDEX "quotations_company_id_status_idx" ON "quotations"("company_id", "status");
CREATE INDEX "quotations_company_id_owner_user_id_idx" ON "quotations"("company_id", "owner_user_id");
CREATE INDEX "quotations_buyer_enquiry_id_idx" ON "quotations"("buyer_enquiry_id");
CREATE INDEX "quotations_customer_id_idx" ON "quotations"("customer_id");
CREATE UNIQUE INDEX "quotation_revisions_quotation_id_revision_number_key" ON "quotation_revisions"("quotation_id", "revision_number");
CREATE UNIQUE INDEX "quotation_lines_revision_id_line_number_key" ON "quotation_lines"("revision_id", "line_number");
CREATE INDEX "quotation_lines_product_id_idx" ON "quotation_lines"("product_id");

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_buyer_enquiry_id_fkey" FOREIGN KEY ("buyer_enquiry_id") REFERENCES "buyer_enquiries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "buyers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_crm_company_id_fkey" FOREIGN KEY ("crm_company_id") REFERENCES "crm_companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_crm_contact_id_fkey" FOREIGN KEY ("crm_contact_id") REFERENCES "crm_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quotation_revisions" ADD CONSTRAINT "quotation_revisions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quotation_revisions" ADD CONSTRAINT "quotation_revisions_quotation_id_fkey" FOREIGN KEY ("quotation_id") REFERENCES "quotations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quotation_revisions" ADD CONSTRAINT "quotation_revisions_freight_tax_rate_id_fkey" FOREIGN KEY ("freight_tax_rate_id") REFERENCES "tax_rates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "quotation_revisions" ADD CONSTRAINT "quotation_revisions_other_charges_tax_rate_id_fkey" FOREIGN KEY ("other_charges_tax_rate_id") REFERENCES "tax_rates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "quotation_revisions" ADD CONSTRAINT "quotation_revisions_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quotation_lines" ADD CONSTRAINT "quotation_lines_revision_id_fkey" FOREIGN KEY ("revision_id") REFERENCES "quotation_revisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "quotation_lines" ADD CONSTRAINT "quotation_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "quotation_lines" ADD CONSTRAINT "quotation_lines_sample_request_id_fkey" FOREIGN KEY ("sample_request_id") REFERENCES "sample_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "quotation_lines" ADD CONSTRAINT "quotation_lines_buyer_enquiry_line_id_fkey" FOREIGN KEY ("buyer_enquiry_line_id") REFERENCES "buyer_enquiry_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "quotation_lines" ADD CONSTRAINT "quotation_lines_uom_id_fkey" FOREIGN KEY ("uom_id") REFERENCES "units_of_measure"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "quotation_lines" ADD CONSTRAINT "quotation_lines_tax_rate_id_fkey" FOREIGN KEY ("tax_rate_id") REFERENCES "tax_rates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Permission module "sales_quotations" (every catalog action).
WITH actions(action) AS (
  VALUES ('view'), ('create'), ('edit'), ('delete'), ('approve'), ('reject'), ('post'),
         ('cancel'), ('export'), ('print'), ('override'), ('scan'), ('view_all')
)
INSERT INTO "permissions" ("id", "key", "module", "description", "created_at")
SELECT gen_random_uuid(), 'sales_quotations.' || a.action, 'sales_quotations', a.action || ' access for sales_quotations', now()
FROM actions a
ON CONFLICT ("key") DO NOTHING;

-- Same roles as Sales & Marketing: copy every sales_marketing.<action> role grant and user override.
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at")
SELECT gen_random_uuid(), rp."role_id", np."id", now()
FROM "role_permissions" rp
JOIN "permissions" op ON op."id" = rp."permission_id" AND op."module" = 'sales_marketing'
JOIN "permissions" np ON np."key" = 'sales_quotations' || substring(op."key" FROM position('.' IN op."key"))
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

INSERT INTO "user_permission_overrides" ("id", "company_id", "user_id", "permission_id", "effect", "reason", "created_by_user_id", "created_at")
SELECT gen_random_uuid(), o."company_id", o."user_id", np."id", o."effect", o."reason", o."created_by_user_id", now()
FROM "user_permission_overrides" o
JOIN "permissions" op ON op."id" = o."permission_id" AND op."module" = 'sales_marketing'
JOIN "permissions" np ON np."key" = 'sales_quotations' || substring(op."key" FROM position('.' IN op."key"))
ON CONFLICT ("user_id", "permission_id") DO NOTHING;

-- Plus what src/config/rbac.ts adds for the built-in roles: Management approves
-- / rejects (S3) and prints, Merchandisers cancel their drafts.
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at")
SELECT gen_random_uuid(), r."id", p."id", now()
FROM "roles" r
JOIN "permissions" p ON p."key" IN ('sales_quotations.approve', 'sales_quotations.reject', 'sales_quotations.print')
WHERE r."is_system_role" AND r."name" = 'MANAGEMENT'
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at")
SELECT gen_random_uuid(), r."id", p."id", now()
FROM "roles" r
JOIN "permissions" p ON p."key" = 'sales_quotations.cancel'
WHERE r."is_system_role" AND r."name" = 'MERCHANDISER'
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
