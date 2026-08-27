-- Add BOM versioning + approval gate (docs/PRACTICAL_BUSINESS_READY_AUDIT.md Section 4 / Phase 1 item 1).
-- Hand-authored (not a raw `prisma migrate diff` output) to preserve every
-- existing bom_items row and boms.notes value across the restructuring —
-- a plain diff would drop bom_items.bom_id and boms.notes with data loss.

-- 1. New enum + bom_versions table.
CREATE TYPE "BomVersionStatus" AS ENUM ('DRAFT', 'APPROVED', 'SUPERSEDED');

CREATE TABLE "bom_versions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "bom_id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL,
    "status" "BomVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approved_by_user_id" UUID,
    "approved_at" TIMESTAMP(3),

    CONSTRAINT "bom_versions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "bom_versions_bom_id_version_number_key" ON "bom_versions"("bom_id", "version_number");

ALTER TABLE "bom_versions" ADD CONSTRAINT "bom_versions_bom_id_fkey" FOREIGN KEY ("bom_id") REFERENCES "boms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bom_versions" ADD CONSTRAINT "bom_versions_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bom_versions" ADD CONSTRAINT "bom_versions_approved_by_user_id_fkey" FOREIGN KEY ("approved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 2. New columns on boms (nullable/defaulted for now — populated below).
ALTER TABLE "boms" ADD COLUMN "current_version_number" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "boms" ADD COLUMN "approved_version_id" UUID;

-- 3. New nullable column on bom_items (populated below, then locked NOT NULL).
ALTER TABLE "bom_items" ADD COLUMN "bom_version_id" UUID;

-- 4. Backfill: one version 1 per existing Bom, carrying over its notes.
--    A Bom that already has real lines is treated as APPROVED — those lines
--    are already what MRP/Production have been silently relying on, so
--    auto-approving preserves current behavior with zero disruption. A Bom
--    with zero lines gets an empty DRAFT version 1 instead, so
--    currentVersionNumber stays consistent even for an as-yet-unauthored BOM.
INSERT INTO "bom_versions" ("id", "bom_id", "version_number", "status", "notes", "created_by_user_id", "created_at", "approved_by_user_id", "approved_at")
SELECT
  gen_random_uuid(),
  b."id",
  1,
  'APPROVED',
  b."notes",
  (SELECT u."id" FROM "users" u WHERE u."company_id" = b."company_id" ORDER BY u."created_at" ASC LIMIT 1),
  b."created_at",
  (SELECT u."id" FROM "users" u WHERE u."company_id" = b."company_id" ORDER BY u."created_at" ASC LIMIT 1),
  b."updated_at"
FROM "boms" b
WHERE EXISTS (SELECT 1 FROM "bom_items" bi WHERE bi."bom_id" = b."id");

INSERT INTO "bom_versions" ("id", "bom_id", "version_number", "status", "notes", "created_by_user_id", "created_at")
SELECT
  gen_random_uuid(),
  b."id",
  1,
  'DRAFT',
  b."notes",
  (SELECT u."id" FROM "users" u WHERE u."company_id" = b."company_id" ORDER BY u."created_at" ASC LIMIT 1),
  b."created_at"
FROM "boms" b
WHERE NOT EXISTS (SELECT 1 FROM "bom_items" bi WHERE bi."bom_id" = b."id");

-- 5. Point every existing bom_items row at its new version 1.
UPDATE "bom_items" bi
SET "bom_version_id" = bv."id"
FROM "bom_versions" bv
WHERE bv."bom_id" = bi."bom_id" AND bv."version_number" = 1;

-- 6. Roll the new boms columns forward.
UPDATE "boms" SET "current_version_number" = 1;

UPDATE "boms" b
SET "approved_version_id" = bv."id"
FROM "bom_versions" bv
WHERE bv."bom_id" = b."id" AND bv."version_number" = 1 AND bv."status" = 'APPROVED';

-- 7. Lock bom_version_id NOT NULL, wire its FK/index, then drop the old
--    bom_id column + boms.notes (both now fully superseded and backfilled).
ALTER TABLE "bom_items" ALTER COLUMN "bom_version_id" SET NOT NULL;
ALTER TABLE "bom_items" ADD CONSTRAINT "bom_items_bom_version_id_fkey" FOREIGN KEY ("bom_version_id") REFERENCES "bom_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "bom_items_bom_version_id_idx" ON "bom_items"("bom_version_id");

ALTER TABLE "bom_items" DROP CONSTRAINT "bom_items_bom_id_fkey";
DROP INDEX "bom_items_bom_id_idx";
ALTER TABLE "bom_items" DROP COLUMN "bom_id";

ALTER TABLE "boms" DROP COLUMN "notes";

-- 8. Final constraint/index on boms.approved_version_id.
CREATE UNIQUE INDEX "boms_approved_version_id_key" ON "boms"("approved_version_id");
ALTER TABLE "boms" ADD CONSTRAINT "boms_approved_version_id_fkey" FOREIGN KEY ("approved_version_id") REFERENCES "bom_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
