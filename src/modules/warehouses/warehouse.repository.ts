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
  findByCode: (warehouseId: string, code: string) => prisma.warehouseLocation.findFirst({ where: { warehouseId, code } }),

  create: (data: Prisma.WarehouseLocationUncheckedCreateInput) => prisma.warehouseLocation.create({ data }),
};
