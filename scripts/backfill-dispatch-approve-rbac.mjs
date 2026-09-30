// One-off, idempotent backfill — grants MANAGEMENT the new "approve" action
// on "dispatch" (Extra Dispatch Quantity, 2026-09-30), for every existing
// company. The Permission catalog row itself (dispatch.approve) already
// exists — seed.ts builds the full MODULES x ACTIONS cross-product
// regardless of which roles are actually granted a given action — only the
// role_permissions link is missing. Safe to re-run anytime (upsert).
import pkg from "@prisma/client";
const { PrismaClient } = pkg;
import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const permission = await prisma.permission.findUnique({ where: { key: "dispatch.approve" } });
if (!permission) throw new Error("Permission catalog row dispatch.approve is missing — check MODULES/ACTIONS in rbac.ts.");

const managementRoles = await prisma.role.findMany({ where: { name: "MANAGEMENT" }, select: { id: true, companyId: true } });
console.log(`Found ${managementRoles.length} MANAGEMENT role(s).`);

for (const role of managementRoles) {
  await prisma.rolePermission.upsert({
    where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
    update: {},
    create: { roleId: role.id, permissionId: permission.id },
  });
  console.log(`  granted dispatch.approve to MANAGEMENT (company ${role.companyId})`);
}

console.log("Done.");
await prisma.$disconnect();
