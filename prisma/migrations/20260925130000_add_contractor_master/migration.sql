-- Promote "Job-Work Contractor" from a Supplier flag into its own master
-- (2026-09-25). Hand-authored (not the raw `prisma migrate diff` output
-- verbatim) because the live dev DB has real data crossing this boundary:
-- one Supplier ("HP Cotton") is referenced by a real JobWorkOrder
-- (JWO-2026-00001) and a real external-unit User login
-- (hpcotton.jobwork@indradhar.com) — both need to be re-pointed at a real,
-- newly-created Contractor row, not just have their FK columns renamed.
--
-- NOTE: deliberately excludes the unrelated `ALTER TYPE "AIProviderCapability"
-- ADD VALUE 'MASK_EDIT'` line the raw diff also reported — that's
-- pre-existing drift from migration 20260924100000_add_mask_edit_capability
-- never having been applied to this dev DB, unrelated to this change.

-- 1. The DocumentType.CONTRACTOR value itself was added in the preceding
--    migration (20260925125900_add_contractor_document_type) — Postgres
--    refuses to use a new enum value in the same transaction it was added
--    in, so it had to be a separate, earlier-applied migration.

-- 2. The new Contractor table itself.
CREATE TABLE "contractors" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contact_person" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contractors_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "contractors_company_id_code_key" ON "contractors"("company_id", "code");

ALTER TABLE "contractors" ADD CONSTRAINT "contractors_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 3. Data migration — one real Contractor row per Supplier that is EITHER
--    already flagged is_job_work_contractor = true OR actually referenced
--    by a real JobWorkOrder/User (the flag alone proved to drift from real
--    usage during this session — the flag on HP Cotton had been toggled
--    back to false, but its real JobWorkOrder and User login still point
--    at it). Fresh, real sequential codes assigned per company via
--    ROW_NUMBER(), never reusing the old Supplier code (a Contractor is a
--    different identity now, not a renamed Supplier).
INSERT INTO "contractors" ("id", "company_id", "code", "name", "contact_person", "phone", "email", "address", "is_active", "created_at", "updated_at")
SELECT
  gen_random_uuid(),
  s."company_id",
  'CONTR-' || LPAD(ROW_NUMBER() OVER (PARTITION BY s."company_id" ORDER BY s."created_at")::text, 5, '0'),
  s."name",
  s."contact_person",
  s."phone",
  s."email",
  s."address",
  s."is_active",
  s."created_at",
  s."updated_at"
FROM "suppliers" s
WHERE s."is_job_work_contractor" = true
   OR s."id" IN (SELECT "supplier_id" FROM "job_work_orders")
   OR s."id" IN (SELECT "supplier_id" FROM "users" WHERE "supplier_id" IS NOT NULL);

-- 4. job_work_orders.supplier_id -> contractor_id (NOT NULL, like the
--    original column — added nullable first so the backfill UPDATE can
--    run, then tightened).
ALTER TABLE "job_work_orders" ADD COLUMN "contractor_id" UUID;

UPDATE "job_work_orders" jwo
SET "contractor_id" = c."id"
FROM "suppliers" s
JOIN "contractors" c ON c."company_id" = s."company_id" AND c."name" = s."name" AND c."code" LIKE 'CONTR-%'
WHERE jwo."supplier_id" = s."id";

ALTER TABLE "job_work_orders" ALTER COLUMN "contractor_id" SET NOT NULL;

ALTER TABLE "job_work_orders" DROP CONSTRAINT "job_work_orders_supplier_id_fkey";
DROP INDEX "job_work_orders_supplier_id_idx";
ALTER TABLE "job_work_orders" DROP COLUMN "supplier_id";

CREATE INDEX "job_work_orders_contractor_id_idx" ON "job_work_orders"("contractor_id");
ALTER TABLE "job_work_orders" ADD CONSTRAINT "job_work_orders_contractor_id_fkey"
  FOREIGN KEY ("contractor_id") REFERENCES "contractors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 5. piece_rate_cards.supplier_id -> contractor_id (nullable both before and
--    after — confirmed zero real rows use this column yet, no backfill
--    needed, just the rename).
ALTER TABLE "piece_rate_cards" DROP CONSTRAINT "piece_rate_cards_supplier_id_fkey";
DROP INDEX "piece_rate_cards_company_id_supplier_id_production_operatio_idx";
ALTER TABLE "piece_rate_cards" ADD COLUMN "contractor_id" UUID;
ALTER TABLE "piece_rate_cards" DROP COLUMN "supplier_id";
CREATE INDEX "piece_rate_cards_company_id_contractor_id_production_operat_idx" ON "piece_rate_cards"("company_id", "contractor_id", "production_operation_id");
ALTER TABLE "piece_rate_cards" ADD CONSTRAINT "piece_rate_cards_contractor_id_fkey"
  FOREIGN KEY ("contractor_id") REFERENCES "contractors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 6. piece_rate_earnings.supplier_id -> contractor_id (nullable, confirmed
--    zero real rows use this column yet).
ALTER TABLE "piece_rate_earnings" DROP CONSTRAINT "piece_rate_earnings_supplier_id_fkey";
DROP INDEX "piece_rate_earnings_company_id_supplier_id_idx";
ALTER TABLE "piece_rate_earnings" ADD COLUMN "contractor_id" UUID;
ALTER TABLE "piece_rate_earnings" DROP COLUMN "supplier_id";
CREATE INDEX "piece_rate_earnings_company_id_contractor_id_idx" ON "piece_rate_earnings"("company_id", "contractor_id");
ALTER TABLE "piece_rate_earnings" ADD CONSTRAINT "piece_rate_earnings_contractor_id_fkey"
  FOREIGN KEY ("contractor_id") REFERENCES "contractors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 7. production_route_stages.preferred_supplier_id -> preferred_contractor_id
--    (nullable, confirmed unused by any application code and zero real
--    rows reference it).
ALTER TABLE "production_route_stages" DROP CONSTRAINT "production_route_stages_preferred_supplier_id_fkey";
ALTER TABLE "production_route_stages" ADD COLUMN "preferred_contractor_id" UUID;
ALTER TABLE "production_route_stages" DROP COLUMN "preferred_supplier_id";
ALTER TABLE "production_route_stages" ADD CONSTRAINT "production_route_stages_preferred_contractor_id_fkey"
  FOREIGN KEY ("preferred_contractor_id") REFERENCES "contractors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 8. users.supplier_id -> contractor_id, backfilling the one real
--    external-unit login (hpcotton.jobwork@indradhar.com) to point at its
--    new Contractor row instead of the old Supplier row.
ALTER TABLE "users" ADD COLUMN "contractor_id" UUID;

UPDATE "users" u
SET "contractor_id" = c."id"
FROM "suppliers" s
JOIN "contractors" c ON c."company_id" = s."company_id" AND c."name" = s."name" AND c."code" LIKE 'CONTR-%'
WHERE u."supplier_id" = s."id";

ALTER TABLE "users" DROP CONSTRAINT "users_supplier_id_fkey";
DROP INDEX "users_supplier_id_key";
ALTER TABLE "users" DROP COLUMN "supplier_id";

CREATE UNIQUE INDEX "users_contractor_id_key" ON "users"("contractor_id");
ALTER TABLE "users" ADD CONSTRAINT "users_contractor_id_fkey"
  FOREIGN KEY ("contractor_id") REFERENCES "contractors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 9. Drop the now-superseded flag on Supplier.
ALTER TABLE "suppliers" DROP COLUMN "is_job_work_contractor";

-- 10. Seed the CONTRACTOR master-code counter so previewNextMasterCode()
--     continues from the real number of rows just migrated, per company —
--     matches DocumentNumberingService's own "master codes never reset,
--     branch_id is always null" convention exactly.
INSERT INTO "document_sequences" ("id", "company_id", "branch_id", "document_type", "prefix", "fiscal_year", "current_number", "padding_length")
SELECT gen_random_uuid(), c."company_id", NULL, 'CONTRACTOR', 'CONTR', 0, COUNT(*), 5
FROM "contractors" c
GROUP BY c."company_id";
