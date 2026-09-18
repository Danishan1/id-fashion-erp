// One-off, idempotent backfill for the Production Module Advanced Upgrade
// (2026-09-18) — Piece-Rate ("piece_rate" module + "override" action) and
// External Unit User ("EXTERNAL_UNIT_USER" role). Mirrors prisma/seed.ts's
// own Permission/Role/RolePermission loop exactly (upsert/skipDuplicates
// throughout, safe to re-run anytime), scoped to every EXISTING company —
// `prisma db seed` is not safe to re-run against a live dev DB with real
// data (documented project convention), so this replays only the additive
// permission-catalog portion of seed.ts's logic against the current
// src/config/rbac.ts, which now includes everything new.
import pkg from "@prisma/client";
const { PrismaClient } = pkg;
import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";
import { MODULES, ACTIONS, ROLES, ROLE_PERMISSIONS, permissionKey } from "../src/config/rbac.ts";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

console.log("Seeding permission catalog (adds piece_rate.* and *.override rows)...");
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
}

console.log("\nDone.");
await prisma.$disconnect();
