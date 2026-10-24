// One-off, idempotent backfill for the Attendance module port (2026-10-23).
// Grants every company's system roles the hrms_attendance / hrms_leave
// actions that src/config/rbac.ts now lists for them (employee self-service,
// manager approvals, MANAGEMENT override). Only ADDS role_permissions rows —
// never removes anything, so an admin's own edits stay untouched.
//
//   node --experimental-strip-types --no-warnings scripts/backfill-attendance-rbac.mjs [--dry-run]
import pkg from "@prisma/client";
const { PrismaClient } = pkg;
import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";
import { ROLES, ROLE_PERMISSIONS, permissionKey } from "../src/config/rbac.ts";

const dryRun = process.argv.includes("--dry-run");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const MODULES = ["hrms_attendance", "hrms_leave"];

const idByKey = new Map((await prisma.permission.findMany({ select: { id: true, key: true } })).map((p) => [p.key, p.id]));
const roles = await prisma.role.findMany({
  where: { name: { in: [...ROLES] } },
  select: { id: true, name: true, companyId: true, rolePermissions: { select: { permissionId: true } } },
});

let added = 0;
for (const role of roles) {
  const held = new Set(role.rolePermissions.map((rp) => rp.permissionId));
  const keys = MODULES.flatMap((m) => (ROLE_PERMISSIONS[role.name]?.[m] ?? []).map((a) => permissionKey(m, a)));
  for (const key of keys) {
    const permissionId = idByKey.get(key);
    if (!permissionId) throw new Error(`Permission ${key} missing — run scripts/sync-permission-catalog.mjs first.`);
    if (held.has(permissionId)) continue;
    added++;
    if (!dryRun) await prisma.rolePermission.create({ data: { roleId: role.id, permissionId } });
  }
}
console.log(`${dryRun ? "[dry run] would grant" : "Granted"} ${added} role permission(s) across ${roles.length} system role(s).`);
await prisma.$disconnect();
