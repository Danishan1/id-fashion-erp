import { prisma } from "@/core/db/client";

export const RoleAdminRepository = {
  findMany: (companyId: string) =>
    prisma.role.findMany({
      where: { companyId },
      select: { id: true, name: true, description: true, isSystemRole: true, _count: { select: { rolePermissions: true, userBranchRoles: true } } },
      orderBy: { name: "asc" },
    }),

  findById: (companyId: string, id: string) =>
    prisma.role.findFirst({ where: { id, companyId }, select: { id: true, name: true, description: true, isSystemRole: true, companyId: true } }),

  findByName: (companyId: string, name: string) => prisma.role.findFirst({ where: { companyId, name }, select: { id: true } }),

  create: (companyId: string, data: { name: string; description: string | null }) =>
    prisma.role.create({ data: { companyId, ...data }, select: { id: true, name: true, description: true, isSystemRole: true } }),

  // The full, global permission catalog — Permission has no companyId (it's
  // shared across every tenant, seeded once), so this is the same 230-row
  // list for every company.
  findPermissionCatalog: () => prisma.permission.findMany({ select: { id: true, key: true, module: true, description: true } }),

  findGrantedPermissionIds: (roleId: string) =>
    prisma.rolePermission.findMany({ where: { roleId }, select: { permissionId: true } }),

  // Full replace, one transaction — same "replaceItems" shape already used
  // by Sales/Purchase Order and BOM's item lists elsewhere in this project.
  replacePermissionsInTx: (roleId: string, permissionIds: string[]) =>
    prisma.$transaction([
      prisma.rolePermission.deleteMany({ where: { roleId } }),
      prisma.rolePermission.createMany({ data: permissionIds.map((permissionId) => ({ roleId, permissionId })) }),
    ]),
};
