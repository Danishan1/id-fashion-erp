// One-off, idempotent backfill for the Effective BOM / Sales Order Override
// feature (2026-09-24) — every SalesOrderItem created BEFORE that feature
// shipped has `salesOrderLineId: null`, since SalesOrderLine rows are only
// ever created by replaceItems() on createSalesOrder()/updateSalesOrder().
// A null salesOrderLineId means SalesOrderBomOverridesSection.tsx silently
// renders nothing at all for that line (it returns null with no id to fetch
// overrides against) — so every order that predates this feature and hasn't
// been re-saved since shows no "BOM Overrides" section whatsoever.
//
// This backfill creates one SalesOrderLine per orphaned SalesOrderItem with
// sourceType: "NONE" and no bomVersionId/sampleVersionId/snapshot fields —
// exactly what effective-bom.service.ts's fetchSalesOrderLineSnapshots()
// already treats as "nothing frozen to substitute," so every backfilled
// line falls through to the unchanged base Style BOM (byte-identical to
// today's behavior) while still giving the line a real, stable identity to
// attach BOM Overrides to going forward. Safe to re-run anytime — only ever
// touches items where salesOrderLineId is still null.
import pkg from "@prisma/client";
const { PrismaClient } = pkg;
import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const orphanedItems = await prisma.salesOrderItem.findMany({
  where: { salesOrderLineId: null },
  select: { id: true, salesOrderId: true, salesOrder: { select: { companyId: true, orderNumber: true } } },
  orderBy: [{ salesOrderId: "asc" }, { id: "asc" }],
});

if (orphanedItems.length === 0) {
  console.log("Nothing to backfill — every SalesOrderItem already has a salesOrderLineId.");
  process.exit(0);
}

const byOrder = new Map();
for (const item of orphanedItems) {
  if (!byOrder.has(item.salesOrderId)) byOrder.set(item.salesOrderId, []);
  byOrder.get(item.salesOrderId).push(item);
}

console.log(`Backfilling ${orphanedItems.length} item(s) across ${byOrder.size} order(s)...`);

for (const [salesOrderId, items] of byOrder) {
  const companyId = items[0].salesOrder.companyId;
  const orderNumber = items[0].salesOrder.orderNumber;

  // Line numbers must not collide with any real (already-populated) lines
  // this same order might already have from a partial prior edit.
  const existingMax = await prisma.salesOrderLine.aggregate({
    where: { salesOrderId },
    _max: { lineNumber: true },
  });
  let nextLineNumber = (existingMax._max.lineNumber ?? 0) + 1;

  await prisma.$transaction(async (tx) => {
    for (const item of items) {
      const line = await tx.salesOrderLine.create({
        data: {
          companyId,
          salesOrderId,
          lineNumber: nextLineNumber++,
          sourceType: "NONE",
        },
      });
      await tx.salesOrderItem.update({ where: { id: item.id }, data: { salesOrderLineId: line.id } });
    }
  });

  console.log(`  ${orderNumber}: created ${items.length} line(s).`);
}

console.log("Done.");
await prisma.$disconnect();
