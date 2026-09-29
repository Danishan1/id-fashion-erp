-- Barcode Management & Scanning System, Phase 1 (2026-09-29)
-- Hand-authored from `prisma migrate diff` output, excluding two pre-existing,
-- unrelated drift lines already documented elsewhere in this project's own
-- history (contractors.updated_at DROP DEFAULT; sample_requests DROP COLUMN
-- "color" — both predate this feature and are out of scope for it).

-- CreateEnum
CREATE TYPE "BarcodeEntityType" AS ENUM ('FABRIC_ROLL', 'PRODUCTION_LOT', 'CARTON', 'ITEM', 'SKU');

-- CreateEnum
CREATE TYPE "BarcodeStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- AlterEnum
ALTER TYPE "DocumentType" ADD VALUE 'FABRIC_ROLL';
ALTER TYPE "DocumentType" ADD VALUE 'SKU';

-- CreateTable
CREATE TABLE "barcodes" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "entity_type" "BarcodeEntityType" NOT NULL,
    "entity_id" UUID NOT NULL,
    "format" TEXT NOT NULL DEFAULT 'CODE128',
    "status" "BarcodeStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_by_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "barcodes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "barcodes_entity_type_entity_id_idx" ON "barcodes"("entity_type", "entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "barcodes_company_id_code_key" ON "barcodes"("company_id", "code");

-- CreateIndex: at most one ACTIVE barcode per entity, without blocking the
-- legitimate "disable a damaged label, mint a replacement" flow — the same
-- partial-unique-index technique already used for
-- sales_invoices_one_active_per_order.
CREATE UNIQUE INDEX "barcodes_one_active_per_entity"
  ON "barcodes"("company_id", "entity_type", "entity_id")
  WHERE "status" != 'DISABLED';

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_barcode_key" ON "product_variants"("barcode");

-- AddForeignKey
ALTER TABLE "barcodes" ADD CONSTRAINT "barcodes_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "barcodes" ADD CONSTRAINT "barcodes_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
