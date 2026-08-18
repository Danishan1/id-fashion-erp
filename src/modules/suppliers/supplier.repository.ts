import { prisma } from "@/core/db/client";
import type { Prisma } from "@prisma/client";

export const SupplierRepository = {
  findMany: (where: Prisma.SupplierWhereInput, args: Omit<Prisma.SupplierFindManyArgs, "where">) =>
    prisma.supplier.findMany({ where, ...args }),

  count: (where: Prisma.SupplierWhereInput) => prisma.supplier.count({ where }),

  findById: (companyId: string, id: string) =>
    prisma.supplier.findFirst({ where: { id, companyId, deletedAt: null } }),

  findByCode: (companyId: string, code: string, excludeId?: string) =>
    prisma.supplier.findFirst({
      where: { companyId, code, deletedAt: null, ...(excludeId ? { id: { not: excludeId } } : {}) },
    }),

  create: (data: Prisma.SupplierUncheckedCreateInput) => prisma.supplier.create({ data }),

  update: (id: string, data: Prisma.SupplierUncheckedUpdateInput) => prisma.supplier.update({ where: { id }, data }),
};
