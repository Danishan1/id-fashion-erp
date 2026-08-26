-- Wire Employee.designation (free-text string) to the real Designation master
-- (HRMS gap-analysis Priority 1 item #1, 2026-08-26).
--
-- Order matters: add the new column, backfill it from the existing free-text
-- data (creating any missing Designation master rows so no data is silently
-- lost), add the FK constraint, then drop the old string column. Mirrors the
-- same string->FK cutover already done once for Product.category/season in
-- Phase 3, except this time real data exists on both sides, so a genuine
-- backfill is required (that earlier migration had zero existing rows).

-- 1. Add the new column (nullable, no FK yet).
ALTER TABLE "employees" ADD COLUMN "designation_id" UUID;

-- 2. Backfill: match each employee's free-text designation to an existing
-- Designation master row by exact (company_id, name).
UPDATE "employees" e
SET "designation_id" = d.id
FROM "designations" d
WHERE e."company_id" = d."company_id"
  AND e."designation" = d."name"
  AND e."designation_id" IS NULL;

-- 3. For any employee designation string with no matching master row, create
-- one now (one row per distinct company_id+designation combination) instead
-- of silently dropping that data on the column-drop below.
INSERT INTO "designations" (id, company_id, code, name, is_active, created_at, updated_at)
SELECT gen_random_uuid(),
       e.company_id,
       upper(regexp_replace(e.designation, '[^a-zA-Z0-9]+', '-', 'g')),
       e.designation,
       true,
       now(),
       now()
FROM "employees" e
WHERE e."designation" IS NOT NULL
  AND e."designation_id" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "designations" d2
    WHERE d2.company_id = e.company_id AND d2.name = e.designation
  )
GROUP BY e.company_id, e.designation;

-- 4. Re-run the match now that any missing designations were created above.
UPDATE "employees" e
SET "designation_id" = d.id
FROM "designations" d
WHERE e."company_id" = d."company_id"
  AND e."designation" = d."name"
  AND e."designation_id" IS NULL;

-- 5. Add the FK constraint (SET NULL on delete — losing the Designation
-- master row should never cascade-delete the Employee).
ALTER TABLE "employees"
  ADD CONSTRAINT "employees_designation_id_fkey"
  FOREIGN KEY ("designation_id") REFERENCES "designations"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- 6. Drop the old free-text column — its data is now fully represented by
-- designation_id (this is a real cutover, not a shim: no code reads the old
-- column after this migration).
ALTER TABLE "employees" DROP COLUMN "designation";
