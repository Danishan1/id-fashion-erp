-- Sales & Marketing Release 1 / S4 — accepted quotation → Sales Order (2026-10-29).
-- One nullable, unique column on sales_orders: the quotation revision an order
-- was converted from. The unique index is what makes conversion idempotent
-- (a retried or concurrent conversion can't create a second order).
-- Rollback: prisma/rollback/20261029090000_sales_quotation_conversion_s4.down.sql

-- AlterTable
ALTER TABLE "sales_orders" ADD COLUMN "source_quotation_revision_id" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "sales_orders_source_quotation_revision_id_key" ON "sales_orders"("source_quotation_revision_id");

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_source_quotation_revision_id_fkey" FOREIGN KEY ("source_quotation_revision_id") REFERENCES "quotation_revisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
