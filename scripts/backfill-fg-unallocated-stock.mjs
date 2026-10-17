// Finished Goods Inventory module (FGI-050 prerequisite, §4.7 point 1 of
// docs/FINISHED_GOODS_INVENTORY_IMPLEMENTATION_PLAN.md) — the one-time
// historical backfill this plan has always described as "Phase-0-adjacent"
// but which was never actually built nor run in any earlier phase (confirmed
// by reading Phase 0/1's own evidence sections before writing this).
//
// There is no way to retroactively know which physical units of existing
// Finished Goods stock belong to which colour/size. This script does NOT
// fabricate a guess, backfill an arbitrary split, or silently zero anything
// out — it creates exactly one FinishedGoodsStockBalance row per
// (companyId, productId, warehouseId) with productVariantId = NULL,
// warehouseLocationId = NULL, stockStatus = SALEABLE, representing "this
// much stock exists but we don't yet know which variant it is."
//
// Refinement over the plan's own literal wording, confident and deliberate
// (not a silent deviation — recorded here and in the implementation plan's
// own evidence section): the unallocated quantity inserted is
//   StockBalance.quantityOnHand - sum(existing FinishedGoodsStockBalance rows
//   for that same key, across every variant/location/status)
// rather than blindly the WHOLE flat balance. This matters because some
// styles may already have real, variant-tracked stock posted through this
// module (e.g. a Production receipt that happened before this backfill ever
// ran) -- inserting an unallocated row for the FULL flat total in that case
// would double-count real stock and make FGI-013's own reconciliation report
// flag a phantom drift the instant it runs. Computing the remainder instead
// means sum(FinishedGoodsStockBalance) === StockBalance holds by
// construction immediately after this script runs, for every key it
// touches -- which is exactly what FGI-013's reconciliation report checks.
//
// Idempotent and safe to re-run: a (companyId, productId, warehouseId) pair
// whose remainder is already zero (or negative, which should never happen
// under correct usage but is treated as zero rather than ever inserting a
// negative balance) is skipped outright, so re-running this after further
// reconciliation allocations have reduced the unallocated bucket correctly
// inserts nothing further for that key.
//
// Scoped to FINISHED_GOODS-typed warehouses only (Warehouse.type is a
// WarehouseType[] array since the 2026-09-02 multi-select change) -- a raw-
// material warehouse's own StockBalance is untouched by this script, exactly
// as this whole module leaves every raw-material workflow untouched.
import pkg from "@prisma/client";
const { PrismaClient } = pkg;
import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const EPSILON = 0.0001;

async function run() {
  const warehouses = await prisma.warehouse.findMany({
    where: { type: { has: "FINISHED_GOODS" } },
    select: { id: true, companyId: true, code: true, name: true },
  });
  if (warehouses.length === 0) {
    console.log("No FINISHED_GOODS-typed warehouses found — nothing to backfill.");
    return;
  }
  const warehouseIds = warehouses.map((w) => w.id);
  const warehouseById = new Map(warehouses.map((w) => [w.id, w]));

  const balances = await prisma.stockBalance.findMany({
    where: { warehouseId: { in: warehouseIds }, quantityOnHand: { gt: 0 } },
    select: { companyId: true, productId: true, warehouseId: true, quantityOnHand: true },
  });
  if (balances.length === 0) {
    console.log("No non-zero StockBalance rows at any FINISHED_GOODS warehouse — nothing to backfill.");
    return;
  }

  let created = 0;
  let skippedAlreadyReconciled = 0;

  for (const balance of balances) {
    const alreadyTracked = await prisma.finishedGoodsStockBalance.aggregate({
      where: { companyId: balance.companyId, productId: balance.productId, warehouseId: balance.warehouseId },
      _sum: { quantityOnHand: true },
    });
    const flat = Number(balance.quantityOnHand);
    const tracked = Number(alreadyTracked._sum.quantityOnHand ?? 0);
    const remainder = flat - tracked;

    if (remainder <= EPSILON) {
      skippedAlreadyReconciled++;
      continue;
    }

    const existingUnallocated = await prisma.finishedGoodsStockBalance.findFirst({
      where: {
        companyId: balance.companyId,
        productId: balance.productId,
        warehouseId: balance.warehouseId,
        productVariantId: null,
        warehouseLocationId: null,
        stockStatus: "SALEABLE",
      },
    });

    if (existingUnallocated) {
      // Already backfilled once for this key -- a re-run should never
      // double-insert. Top the existing row up only if the remainder grew
      // (shouldn't happen under correct usage, but safe either way) by
      // setting it to the freshly computed remainder rather than blindly
      // incrementing, since the remainder is an absolute recomputation, not
      // a delta.
      if (Math.abs(Number(existingUnallocated.quantityOnHand) - remainder) > EPSILON) {
        await prisma.finishedGoodsStockBalance.update({
          where: { id: existingUnallocated.id },
          data: { quantityOnHand: remainder },
        });
        console.log(
          `Updated existing unallocated row for product ${balance.productId} at warehouse ${warehouseById.get(balance.warehouseId)?.code}: ${existingUnallocated.quantityOnHand} -> ${remainder}`
        );
      }
      continue;
    }

    await prisma.finishedGoodsStockBalance.create({
      data: {
        companyId: balance.companyId,
        productId: balance.productId,
        warehouseId: balance.warehouseId,
        productVariantId: null,
        warehouseLocationId: null,
        stockStatus: "SALEABLE",
        quantityOnHand: remainder,
      },
    });
    created++;
    console.log(
      `Created unallocated FinishedGoodsStockBalance: product ${balance.productId}, warehouse ${warehouseById.get(balance.warehouseId)?.code}, quantity ${remainder}`
    );
  }

  console.log(`\nDone. Created/updated ${created} unallocated row(s). Skipped ${skippedAlreadyReconciled} already-fully-reconciled key(s).`);
}

run()
  .catch((err) => {
    console.error("Backfill failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
