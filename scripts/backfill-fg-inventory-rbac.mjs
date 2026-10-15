// Backfills the Permission/RolePermission rows for the "fg_inventory" module
// into an existing dev database — this module's own Permission catalog rows
// were never seeded against the real dev DB (it was built and verified
// entirely against the disposable FGI scratch database; `prisma db seed` is
// not safe to re-run against a real dev DB with existing data). Purely
// additive and idempotent: Permission.createMany + skipDuplicates, and
// RolePermission.upsert per existing company's own matching Role rows —
// matches this project's own established pattern for exactly this situation
// (Expenses/Dispatch/marketing/hrms_* RBAC rows were all backfilled the
// same way after being added to rbac.ts without a full reseed).
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const MODULE = "fg_inventory";
const ACTIONS = ["view", "create", "edit", "delete", "approve", "reject", "post", "cancel", "export", "print"];

// Mirrors src/config/rbac.ts's own real ROLE_PERMISSIONS grants for
// fg_inventory EXACTLY (independently re-confirmed via
// `awk '/^  [A-Z_]+: \{/ {role=$1} /fg_inventory:/ {print role, $0}'
// src/config/rbac.ts` before writing this, not guessed from memory) — copied
// verbatim rather than importing the TS config (this is a plain .mjs script,
// kept dependency-free from the TS build). SUPER_ADMIN/VIEWER aren't literal
// `fg_inventory:` lines in rbac.ts — both are built programmatically via
// `MODULES.map(...)` (every module, all actions for SUPER_ADMIN / "view"
// only for VIEWER), confirmed by reading those two role definitions directly.
const GRANTS_BY_ROLE = {
  SUPER_ADMIN: ACTIONS,
  VIEWER: ["view"],
  MANAGEMENT: ["view", "approve", "export"],
  PRODUCTION_MANAGER: ["view"],
  QC_MANAGER: ["view"],
  STORE_MANAGER: ["view", "create", "edit", "post", "export", "print"],
  DISPATCH_MANAGER: ["view"],
  WAREHOUSE_USER: ["view", "create", "edit"],
};

async function main() {
  const permissionKey = (action) => `${MODULE}.${action}`;

  console.log("Seeding fg_inventory Permission catalog rows...");
  await prisma.permission.createMany({
    data: ACTIONS.map((action) => ({ key: permissionKey(action), module: MODULE, description: `${action} access for ${MODULE}` })),
    skipDuplicates: true,
  });

  const permissions = await prisma.permission.findMany({ where: { module: MODULE } });
  const permissionIdByKey = new Map(permissions.map((p) => [p.key, p.id]));
  console.log(`Permission rows present: ${permissions.length}`);

  const roles = await prisma.role.findMany({ where: { name: { in: Object.keys(GRANTS_BY_ROLE) } } });
  console.log(`Found ${roles.length} matching roles across all companies.`);

  let upserted = 0;
  for (const role of roles) {
    const actions = GRANTS_BY_ROLE[role.name] ?? [];
    for (const action of actions) {
      const permissionId = permissionIdByKey.get(permissionKey(action));
      if (!permissionId) continue;
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId } },
        update: {},
        create: { roleId: role.id, permissionId },
      });
      upserted += 1;
    }
  }
  console.log(`RolePermission rows upserted (idempotent): ${upserted}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
