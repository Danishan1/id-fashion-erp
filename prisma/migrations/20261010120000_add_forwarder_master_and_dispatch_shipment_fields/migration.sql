-- Forwarder Master + Dispatch shipment fields (Phase C, Dispatch/Production/
-- Forwarder/Barcode Management Enhancement, 2026-10-10).
--
-- Hand-authored from `prisma migrate diff`'s raw output, with one line
-- deliberately removed: the diff also includes
--   ALTER TABLE "sample_requests" DROP COLUMN "color";
-- which is a pre-existing, unrelated drift (a column that exists in the live
-- dev DB but was never added to schema.prisma — already documented in
-- CLAUDE.md as a known gap). Per this initiative's own Part 16 migration-
-- safety rule ("do not drop existing business tables/columns; prefer
-- additive, backward-compatible changes"), that drop is excluded here —
-- resolving that drift is a separate, unrelated task, not part of this one.

-- CreateEnum
CREATE TYPE "ForwarderType" AS ENUM ('COURIER', 'ROAD', 'RAIL', 'AIR', 'OTHER');

-- AlterEnum
ALTER TYPE "DocumentType" ADD VALUE 'FORWARDER';

-- AlterTable
ALTER TABLE "dispatches" ADD COLUMN     "awb_number" TEXT,
ADD COLUMN     "driver_details" TEXT,
ADD COLUMN     "expected_delivery_date" DATE,
ADD COLUMN     "forwarder_id" UUID,
ADD COLUMN     "freight_charges" DECIMAL(18,2),
ADD COLUMN     "lr_number" TEXT,
ADD COLUMN     "shipment_remarks" TEXT;

-- CreateTable
CREATE TABLE "forwarders" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "ForwarderType" NOT NULL DEFAULT 'COURIER',
    "contact_person" TEXT,
    "phone" TEXT,
    "alt_phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "country" TEXT,
    "postal_code" TEXT,
    "gstin" TEXT,
    "remarks" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "forwarders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "forwarders_company_id_code_key" ON "forwarders"("company_id", "code");

-- AddForeignKey
ALTER TABLE "forwarders" ADD CONSTRAINT "forwarders_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispatches" ADD CONSTRAINT "dispatches_forwarder_id_fkey" FOREIGN KEY ("forwarder_id") REFERENCES "forwarders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
