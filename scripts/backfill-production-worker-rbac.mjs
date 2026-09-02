// One-off, idempotent backfill — adds the new PRODUCTION_WORKER role (with its
// permission grants) and grants PRODUCTION_SUPERVISOR the new "approve"
// action on "production", for every existing company. Safe to re-run anytime
// (upsert throughout). `prisma db seed` is not safe to re-run against a live
// dev DB with real data (documented project convention), so this mirrors only
// the additive role/role_permission portion of seed.ts's own logic, scoped to
// exactly what changed in src/config/rbac.ts on 2026-09-02.
import pkg from "@prisma/client";
const { PrismaClient } = pkg;
import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const PRODUCTION_WORKER_GRANTS = [
  { module: "dashboard", action: "view" },
  { module: "production", action: "view" },
  { module: "production", action: "create" },
];

const allPermissions = await prisma.permission.findMany();
const permissionIdByKey = new Map(allPermissions.map((p) => [p.key, p.id]));

function requirePermissionId(module, action) {
  const key = `${module}.${action}`;
  const id = permissionIdByKey.get(key);
  if (!id) throw new Error(`Unknown permission key: ${key} — Permission catalog row missing.`);
  return id;
}

const companies = await prisma.company.findMany({ select: { id: true, name: true } });
console.log(`Found ${companies.length} companies.`);

for (const company of companies) {
  console.log(`\n--- ${company.name} (${company.id}) ---`);

  const workerRole = await prisma.role.upsert({
    where: { companyId_name: { companyId: company.id, name: "PRODUCTION_WORKER" } },
    update: {},
    create: { companyId: company.id, name: "PRODUCTION_WORKER", isSystemRole: true },
  });
  console.log(`PRODUCTION_WORKER role: ${workerRole.id}`);

  for (const { module, action } of PRODUCTION_WORKER_GRANTS) {
    const permissionId = requirePermissionId(module, action);
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: workerRole.id, permissionId } },
      update: {},
      create: { roleId: workerRole.id, permissionId },
    });
  }
  console.log(`  granted: ${PRODUCTION_WORKER_GRANTS.map((g) => `${g.module}.${g.action}`).join(", ")}`);

  const supervisorRole = await prisma.role.findUnique({
    where: { companyId_name: { companyId: company.id, name: "PRODUCTION_SUPERVISOR" } },
  });
  if (supervisorRole) {
    const approveId = requirePermissionId("production", "approve");
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: supervisorRole.id, permissionId: approveId } },
      update: {},
      create: { roleId: supervisorRole.id, permissionId: approveId },
    });
    console.log(`PRODUCTION_SUPERVISOR (${supervisorRole.id}): granted production.approve`);
  } else {
    console.log(`PRODUCTION_SUPERVISOR role not found for this company — skipped.`);
  }
}

console.log("\nDone.");
await prisma.$disconnect();
