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

  // Every active stage for this company, in floor order — the picker list
  // for the "restrict this role to these stages" UI.
  findActiveProductionStages: (companyId: string) =>
    prisma.productionStage.findMany({
      where: { companyId, isActive: true },
      select: { id: true, name: true, code: true, sequence: true },
      orderBy: { sequence: "asc" },
    }),

  findGrantedStageIds: (roleId: string) =>
    prisma.roleProductionStageAccess.findMany({ where: { roleId }, select: { productionStageId: true } }),

  // Full replace, one transaction — an empty `stageIds` array means
  // "unrestricted" (the row set is simply empty), not a no-op — matches
  // PermissionService.getAllowedProductionStageIds()'s own "zero rows =
  // unrestricted" contract exactly.
  replaceStageAccessInTx: (roleId: string, stageIds: string[]) =>
    prisma.$transaction([
      prisma.roleProductionStageAccess.deleteMany({ where: { roleId } }),
      prisma.roleProductionStageAccess.createMany({ data: stageIds.map((productionStageId) => ({ roleId, productionStageId })) }),
    ]),

  findActiveBranches: (companyId: string) =>
    prisma.branch.findMany({
      where: { companyId, isActive: true },
      select: { id: true, name: true, code: true },
      orderBy: { name: "asc" },
    }),

  findGrantedBranchIds: (roleId: string) => prisma.roleBranchAccess.findMany({ where: { roleId }, select: { branchId: true } }),

  // Same "empty array = unrestricted, not a no-op" contract as
  // replaceStageAccessInTx above, mirrored for RoleBranchAccess.
  replaceBranchAccessInTx: (roleId: string, branchIds: string[]) =>
    prisma.$transaction([
      prisma.roleBranchAccess.deleteMany({ where: { roleId } }),
      prisma.roleBranchAccess.createMany({ data: branchIds.map((branchId) => ({ roleId, branchId })) }),
    ]),
};
