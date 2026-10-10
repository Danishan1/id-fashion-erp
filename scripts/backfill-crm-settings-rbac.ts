// One-off, idempotent backfill for the Advanced CRM rebuild (2026-10-01):
// rbac.ts gained a new module ("crm_settings") and a new action ("view_all").
// `prisma db seed` isn't safe to re-run on an existing database, so this adds
// only what's new:
//   1. the Permission catalog rows for every key involving crm_settings or view_all;
//   2. each system role's grants for exactly those keys, per ROLE_PERMISSIONS.
// Grants for every other module are left alone, so permissions an admin has
// deliberately removed elsewhere stay removed. Safe to re-run (upserts).
//
// Run: npx tsx scripts/backfill-crm-settings-rbac.ts
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { MODULES, ACTIONS, ROLE_PERMISSIONS, permissionKey } from "../src/config/rbac";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

const isNew = (module: string, action: string) => module === "crm_settings" || action === "view_all";

async function main() {
  const rows = MODULES.flatMap((module) =>
    ACTIONS.filter((action) => isNew(module, action)).map((action) => ({
      key: permissionKey(module, action),
      module,
      description: `${action} access for ${module}`,
    }))
  );
  const created = await prisma.permission.createMany({ data: rows, skipDuplicates: true });
  console.log(`Permission catalog: ${created.count} new row(s) (of ${rows.length} needed).`);

  const permissionIdByKey = new Map(
    (await prisma.permission.findMany({ where: { key: { in: rows.map((r) => r.key) } } })).map((p) => [p.key, p.id])
  );

  let granted = 0;
  for (const [roleName, modules] of Object.entries(ROLE_PERMISSIONS)) {
    const keys = Object.entries(modules).flatMap(([module, actions]) =>
      (actions ?? []).filter((action) => isNew(module, action)).map((action) => permissionKey(module as (typeof MODULES)[number], action))
    );
    if (keys.length === 0) continue;

    const roles = await prisma.role.findMany({ where: { name: roleName }, select: { id: true } });
    for (const role of roles) {
      for (const key of keys) {
        const permissionId = permissionIdByKey.get(key);
        if (!permissionId) throw new Error(`Permission catalog row ${key} is missing.`);
        await prisma.rolePermission.upsert({
          where: { roleId_permissionId: { roleId: role.id, permissionId } },
          update: {},
          create: { roleId: role.id, permissionId },
        });
        granted++;
      }
    }
    console.log(`  ${roleName}: ${keys.join(", ")} (${roles.length} role row(s))`);
  }
  console.log(`Done. ${granted} grant(s) ensured.`);
}

main().finally(() => prisma.$disconnect());
