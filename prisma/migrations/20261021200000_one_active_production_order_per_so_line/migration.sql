-- One active (non-cancelled) Production Order per Sales Order line.
-- The service already checks this, but two simultaneous requests could both
-- pass that check (QA finding S-10). Partial unique index, same pattern as
-- sales_invoices_one_active_per_order. Not expressible in schema.prisma.
CREATE UNIQUE INDEX "production_orders_one_active_per_so_line"
  ON "production_orders" ("sales_order_item_id")
  WHERE "sales_order_item_id" IS NOT NULL AND "status" <> 'CANCELLED';
