// Permission catalog sync — run on every deploy, after `prisma migrate deploy`.
// Safe to re-run any time (Platform SaaS Phase 6, PLAT-031).
//
//   node --experimental-strip-types scripts/sync-permission-catalog.mjs [--dry-run]
//
// What it does, for the catalog in src/config/rbac.ts:
//   1. Adds every missing permission row (module × action).
//   2. For permission keys that did not exist before this run, grants them to
//      every company's system roles exactly as ROLE_PERMISSIONS says. A key that
//      never existed can't have been removed by an admin, so this never undoes
//      an admin's own permission edits.
//   3. Makes sure every company's SUPER_ADMIN role holds its full grant set.
//      SUPER_ADMIN's matrix is locked in the UI, so this is always safe.
// It never deletes anything: stale catalog keys are only reported.
import pkg from "@prisma/client";
const { PrismaClient } = pkg;
import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";
import { MODULES, ACTIONS, ROLES, ROLE_PERMISSIONS, permissionKey } from "../src/config/rbac.ts";

const dryRun = process.argv.includes("--dry-run");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

const wanted = MODULES.flatMap((module) =>
  ACTIONS.map((action) => ({ key: permissionKey(module, action), module, description: `${action} access for ${module}` }))
);
const wantedKeys = new Set(wanted.map((p) => p.key));

const existing = await prisma.permission.findMany({ select: { key: true } });
const existingKeys = new Set(existing.map((p) => p.key));
const newKeys = new Set(wanted.filter((p) => !existingKeys.has(p.key)).map((p) => p.key));
const staleKeys = [...existingKeys].filter((k) => !wantedKeys.has(k));

console.log(`Catalog: ${wanted.length} wanted, ${existingKeys.size} present, ${newKeys.size} to add.`);
if (staleKeys.length) console.log(`Stale keys left in place (not in rbac.ts): ${staleKeys.length}`);

if (!dryRun && newKeys.size) {
  await prisma.permission.createMany({ data: wanted.filter((p) => newKeys.has(p.key)), skipDuplicates: true });
}
const idByKey = new Map((await prisma.permission.findMany({ select: { id: true, key: true } })).map((p) => [p.key, p.id]));

function grantsFor(roleName) {
  return Object.entries(ROLE_PERMISSIONS[roleName] ?? {}).flatMap(([module, actions]) =>
    (actions ?? []).map((action) => permissionKey(module, action))
  );
}

const companies = await prisma.company.findMany({ select: { id: true, name: true }, orderBy: { createdAt: "asc" } });
let totalGranted = 0;
for (const company of companies) {
  const roles = await prisma.role.findMany({
    where: { companyId: company.id, name: { in: [...ROLES] } },
    select: { id: true, name: true, rolePermissions: { select: { permissionId: true } } },
  });
  let granted = 0;
  for (const role of roles) {
    const held = new Set(role.rolePermissions.map((rp) => rp.permissionId));
    const keys = grantsFor(role.name).filter((k) => role.name === "SUPER_ADMIN" || newKeys.has(k));
    // In a dry run, brand-new keys have no id yet — count them as pending grants.
    const pending = keys.filter((k) => {
      const id = idByKey.get(k);
      return id ? !held.has(id) : newKeys.has(k);
    });
    const rows = pending.map((k) => idByKey.get(k)).filter(Boolean).map((permissionId) => ({ roleId: role.id, permissionId }));
    if (!dryRun && rows.length) await prisma.rolePermission.createMany({ data: rows, skipDuplicates: true });
    granted += pending.length;
  }
  totalGranted += granted;
  console.log(`  ${company.name}: ${granted} role grants ${dryRun ? "would be " : ""}added`);
}

console.log(`${dryRun ? "[dry run] " : ""}Done — ${newKeys.size} permissions, ${totalGranted} role grants.`);
if (!dryRun) console.log("Restart the app (or wait for the permission cache to expire) so signed-in users pick this up.");
await prisma.$disconnect();
