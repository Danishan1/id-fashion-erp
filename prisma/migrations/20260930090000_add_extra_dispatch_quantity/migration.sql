-- Extra Dispatch Quantity (2026-09-30)
-- Excludes two unrelated, pre-existing drift statements the raw `prisma
-- migrate diff` output also produced (ALTER TABLE "contractors" ALTER COLUMN
-- "updated_at" DROP DEFAULT; ALTER TABLE "sample_requests" DROP COLUMN
-- "color") — both are already-documented drift from unrelated prior work,
-- not part of this feature.

-- CreateEnum
CREATE TYPE "ExtraDispatchReason" AS ENUM ('CUSTOMER_REQUEST', 'REPLACEMENT', 'FREE_FOC', 'SAMPLE', 'PROMOTIONAL', 'PACKING_ADJUSTMENT', 'OTHER');

-- AlterTable
ALTER TABLE "dispatch_items" ADD COLUMN     "extra_dispatch_quantity" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "extra_dispatch_reason" "ExtraDispatchReason",
ADD COLUMN     "extra_dispatch_remarks" TEXT,
ADD COLUMN     "regular_dispatch_quantity" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "source_lot_id" UUID;

-- AlterTable
ALTER TABLE "sales_order_items" ADD COLUMN     "regular_dispatched_quantity" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "dispatch_settings" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "allow_extra_dispatch" BOOLEAN NOT NULL DEFAULT true,
    "extra_dispatch_approval_required" BOOLEAN NOT NULL DEFAULT false,
    "extra_dispatch_approval_threshold_qty" INTEGER,
    "extra_dispatch_approval_threshold_percent" DECIMAL(5,2),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dispatch_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "dispatch_settings_company_id_key" ON "dispatch_settings"("company_id");

-- CreateIndex
CREATE INDEX "dispatch_items_source_lot_id_idx" ON "dispatch_items"("source_lot_id");

-- AddForeignKey
ALTER TABLE "dispatch_settings" ADD CONSTRAINT "dispatch_settings_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispatch_items" ADD CONSTRAINT "dispatch_items_source_lot_id_fkey" FOREIGN KEY ("source_lot_id") REFERENCES "lots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Data backfill — every dispatch physically shipped BEFORE this feature
-- existed was, by construction (the old hard-reject guard), 100% Regular:
-- extra dispatch was structurally impossible. Preserve that historical fact
-- exactly rather than leaving old rows silently showing Regular=0/Extra=0.
UPDATE "dispatch_items" SET "regular_dispatch_quantity" = "dispatched_quantity";
UPDATE "sales_order_items" SET "regular_dispatched_quantity" = "dispatched_quantity";
