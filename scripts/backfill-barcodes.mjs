// One-off, idempotent backfill for the Barcode Management & Scanning System,
// Phase 1 (2026-09-29). Mirrors prisma/seed.ts's own Permission/Role/
// RolePermission loop exactly (upsert/skipDuplicates throughout, safe to
// re-run anytime) — `prisma db seed` is not safe to re-run against a live
// dev DB with real data (documented project convention), so this replays
// only the additive permission-catalog portion of seed.ts's logic against
// the current src/config/rbac.ts, which now includes the new "barcodes"
// module and "scan"/"edit"/"create"/"print" actions on it.
//
// ALSO backfills a Barcode registry row for every PRE-EXISTING entity that
// predates this feature — FabricRoll, Lot, and raw-material Product (ITEM) —
// using the exact same "reuse an existing unique value" rule the live
// minting code uses (FabricRoll gets a freshly minted FR-#### code, since
// its own rollNumber isn't unique; Lot reuses lotNumber verbatim; Product
// reuses styleCode verbatim). Every insert is guarded by a real DB unique
// constraint (barcodes_one_active_per_entity / barcodes_company_id_code_key)
// so re-running this script never creates a duplicate.
//
// Deliberately NOT backfilled here (documented scope trim, not an
// oversight): CARTON (a dispatch's cartons are deleted and recreated on
// every edit — see dispatch.repository.ts's setCartons — so a historical
// backfill would be stale the moment anyone next edits that dispatch's
// cartons; a fresh barcode is minted automatically the next time cartons
// are saved) and SKU (ProductVariant — minted on demand via the "Generate
// Barcode" button already built into Masters → Styles → Variants; a bulk
// backfill across every historical variant was judged lower value than the
// on-demand path for Phase 1).
import pkg from "@prisma/client";
const { PrismaClient } = pkg;
import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";
import { MODULES, ACTIONS, ROLES, ROLE_PERMISSIONS, permissionKey } from "../src/config/rbac.ts";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

console.log("Seeding permission catalog (adds barcodes.* rows)...");
const permissionRows = MODULES.flatMap((module) =>
  ACTIONS.map((action) => ({
    key: permissionKey(module, action),
    module,
    description: `${action} access for ${module}`,
  }))
);
await prisma.permission.createMany({ data: permissionRows, skipDuplicates: true });
const allPermissions = await prisma.permission.findMany();
const permissionIdByKey = new Map(allPermissions.map((p) => [p.key, p.id]));

function requirePermissionId(key) {
  const id = permissionIdByKey.get(key);
  if (!id) throw new Error(`Unknown permission key: ${key} — Permission catalog row missing.`);
  return id;
}

const companies = await prisma.company.findMany({ select: { id: true, name: true } });
console.log(`Found ${companies.length} companies.`);

const MASTER_CODE_YEAR = 0;

/** Mirrors DocumentNumberingService's own previewNextMasterCode + advanceMasterCodeSequence, inlined here since this script can't import that TypeScript module's own `@/` path-aliased dependency chain outside Next's bundler. */
async function mintMasterCode(companyId, documentType, prefix) {
  const existing = await prisma.documentSequence.findFirst({
    where: { companyId, branchId: null, documentType, fiscalYear: MASTER_CODE_YEAR },
  });
  const next = (existing ? Number(existing.currentNumber) : 0) + 1;
  const code = `${prefix}-${String(next).padStart(5, "0")}`;
  if (existing) {
    await prisma.documentSequence.update({ where: { id: existing.id }, data: { currentNumber: { increment: 1 } } });
  } else {
    await prisma.documentSequence.create({
      data: { companyId, branchId: null, documentType, prefix, fiscalYear: MASTER_CODE_YEAR, currentNumber: 1 },
    });
  }
  return code;
}

async function registerIfMissing(companyId, entityType, entityId, code) {
  const existing = await prisma.barcode.findFirst({ where: { companyId, entityType, entityId, status: "ACTIVE" } });
  if (existing) return false;
  try {
    await prisma.barcode.create({ data: { companyId, code, entityType, entityId } });
    return true;
  } catch (err) {
    if (err?.code === "P2002") return false; // genuine race or a code collision — skip, never crash the whole backfill
    throw err;
  }
}

for (const company of companies) {
  console.log(`\n--- ${company.name} (${company.id}) ---`);

  for (const roleName of ROLES) {
    const role = await prisma.role.upsert({
      where: { companyId_name: { companyId: company.id, name: roleName } },
      update: {},
      create: { companyId: company.id, name: roleName, isSystemRole: true },
    });

    const modulesForRole = ROLE_PERMISSIONS[roleName];
    const rolePermissionData = Object.entries(modulesForRole).flatMap(([module, actions]) =>
      (actions ?? []).map((action) => ({ roleId: role.id, permissionId: requirePermissionId(permissionKey(module, action)) }))
    );

    for (const rp of rolePermissionData) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: rp.roleId, permissionId: rp.permissionId } },
        update: {},
        create: rp,
      });
    }
    console.log(`  ${roleName}: ${rolePermissionData.length} grants ensured (role ${role.id})`);
  }

  // Fabric Rolls — mint a fresh FR-##### code per roll with none yet.
  const rolls = await prisma.fabricRoll.findMany({ where: { companyId: company.id }, select: { id: true } });
  let rollsRegistered = 0;
  for (const roll of rolls) {
    const code = await mintMasterCode(company.id, "FABRIC_ROLL", "FR");
    if (await registerIfMissing(company.id, "FABRIC_ROLL", roll.id, code)) rollsRegistered++;
  }
  console.log(`  Fabric Rolls: ${rollsRegistered} of ${rolls.length} newly registered.`);

  // Production Lots — reuse lotNumber verbatim (already unique per company).
  const lots = await prisma.lot.findMany({ where: { companyId: company.id }, select: { id: true, lotNumber: true } });
  let lotsRegistered = 0;
  for (const lot of lots) {
    if (await registerIfMissing(company.id, "PRODUCTION_LOT", lot.id, lot.lotNumber)) lotsRegistered++;
  }
  console.log(`  Production Lots: ${lotsRegistered} of ${lots.length} newly registered.`);

  // Raw-material Products (ITEM) — reuse styleCode verbatim.
  const materials = await prisma.product.findMany({
    where: { companyId: company.id, itemType: "RAW_MATERIAL" },
    select: { id: true, styleCode: true },
  });
  let materialsRegistered = 0;
  for (const material of materials) {
    if (await registerIfMissing(company.id, "ITEM", material.id, material.styleCode)) materialsRegistered++;
  }
  console.log(`  Raw Materials (ITEM): ${materialsRegistered} of ${materials.length} newly registered.`);
}

console.log("\nDone.");
await prisma.$disconnect();
