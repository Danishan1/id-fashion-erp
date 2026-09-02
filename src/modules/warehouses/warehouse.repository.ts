import { prisma } from "@/core/db/client";
import type { Prisma } from "@prisma/client";

export const WarehouseRepository = {
  findMany: (where: Prisma.WarehouseWhereInput, args: Omit<Prisma.WarehouseFindManyArgs, "where">) =>
    prisma.warehouse.findMany({ where, ...args }),

  count: (where: Prisma.WarehouseWhereInput) => prisma.warehouse.count({ where }),

  findByIdWithLocations: (companyId: string, id: string) =>
    prisma.warehouse.findFirst({
      where: { id, companyId },
      include: { locations: { orderBy: { code: "asc" } } },
    }),

  findByCodeInBranch: (branchId: string, code: string) => prisma.warehouse.findFirst({ where: { branchId, code } }),

  create: (data: Prisma.WarehouseUncheckedCreateInput) => prisma.warehouse.create({ data }),

  update: (id: string, data: Prisma.WarehouseUncheckedUpdateInput) => prisma.warehouse.update({ where: { id }, data }),
};

export const WarehouseLocationRepository = {
  findByCode: (warehouseId: string, code: string, excludeId?: string) =>
    prisma.warehouseLocation.findFirst({
      where: { warehouseId, code, ...(excludeId ? { id: { not: excludeId } } : {}) },
    }),

  findMany: (warehouseId: string) => prisma.warehouseLocation.findMany({ where: { warehouseId }, orderBy: { code: "asc" } }),

  /** No companyId column on this model — company scoping must go through the
   * included warehouse, never assumed from a bare id lookup. */
  findByIdWithWarehouse: (id: string) =>
    prisma.warehouseLocation.findUnique({ where: { id }, include: { warehouse: { select: { id: true, companyId: true } } } }),

  create: (data: Prisma.WarehouseLocationUncheckedCreateInput) => prisma.warehouseLocation.create({ data }),

  update: (id: string, data: Prisma.WarehouseLocationUncheckedUpdateInput) =>
    prisma.warehouseLocation.update({ where: { id }, data }),
};
