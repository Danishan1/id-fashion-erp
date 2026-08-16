import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";
import { MODULES, ACTIONS, ROLES, ROLE_PERMISSIONS, permissionKey } from "../src/config/rbac";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("Seeding currencies...");
  await prisma.currency.createMany({
    data: [
      { code: "USD", name: "US Dollar", symbol: "$", decimalPlaces: 2 },
      { code: "INR", name: "Indian Rupee", symbol: "₹", decimalPlaces: 2 },
      { code: "EUR", name: "Euro", symbol: "€", decimalPlaces: 2 },
    ],
    skipDuplicates: true,
  });

  console.log("Seeding company + branch...");
  const company = await prisma.company.upsert({
    where: { taxRegistrationNo: "DEMO-TAX-0001" },
    update: {},
    create: {
      name: "Indradhar Garments Pvt. Ltd.",
      legalName: "Indradhar Garments Pvt. Ltd.",
      taxRegistrationNo: "DEMO-TAX-0001",
      baseCurrencyCode: "INR",
      fiscalYearStartMonth: 4,
      isActive: true,
    },
  });

  const branch = await prisma.branch.upsert({
    where: { companyId_code: { companyId: company.id, code: "HO" } },
    update: {},
    create: {
      companyId: company.id,
      code: "HO",
      name: "Head Office & Factory",
      type: "FACTORY",
    },
  });

  console.log("Seeding permission catalog...");
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

  console.log("Seeding roles + role_permissions...");
  const roleIdByName = new Map<string, string>();
  for (const roleName of ROLES) {
    const role = await prisma.role.upsert({
      where: { companyId_name: { companyId: company.id, name: roleName } },
      update: {},
      create: {
        companyId: company.id,
        name: roleName,
        isSystemRole: true,
      },
    });
    roleIdByName.set(roleName, role.id);

    const modulesForRole = ROLE_PERMISSIONS[roleName];
    const rolePermissionData = Object.entries(modulesForRole).flatMap(([module, actions]) =>
      (actions ?? []).map((action) => {
        const key = permissionKey(module as (typeof MODULES)[number], action);
        const permissionId = permissionIdByKey.get(key);
        if (!permissionId) throw new Error(`Unknown permission key: ${key}`);
        return { roleId: role.id, permissionId };
      })
    );

    for (const rp of rolePermissionData) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: rp.roleId, permissionId: rp.permissionId } },
        update: {},
        create: rp,
      });
    }
  }

  console.log("Seeding Super Admin user...");
  const superAdminEmail = "admin@indradhar.com";
  const superAdminPassword = "ChangeMe123!";
  const passwordHash = await bcrypt.hash(superAdminPassword, 12);

  const superAdminUser = await prisma.user.upsert({
    where: { email: superAdminEmail },
    update: {},
    create: {
      companyId: company.id,
      defaultBranchId: branch.id,
      email: superAdminEmail,
      passwordHash,
      fullName: "Super Admin",
      status: "ACTIVE",
    },
  });

  const superAdminRoleId = roleIdByName.get("SUPER_ADMIN")!;
  await prisma.userBranchRole.upsert({
    where: {
      userId_branchId_roleId: {
        userId: superAdminUser.id,
        branchId: branch.id,
        roleId: superAdminRoleId,
      },
    },
    update: {},
    create: {
      userId: superAdminUser.id,
      branchId: branch.id,
      roleId: superAdminRoleId,
    },
  });

  console.log("\nSeed complete.");
  console.log(`  Company:  ${company.name} (${company.id})`);
  console.log(`  Branch:   ${branch.name} (${branch.code})`);
  console.log(`  Login:    ${superAdminEmail} / ${superAdminPassword}`);
  console.log("  ⚠ Change this password immediately in a non-dev environment.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
