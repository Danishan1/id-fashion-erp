import { prisma } from "@/core/db/client";
import type { Prisma } from "@prisma/client";

export const SupplierRepository = {
  findMany: (where: Prisma.SupplierWhereInput, args: Omit<Prisma.SupplierFindManyArgs, "where">) =>
    prisma.supplier.findMany({ where, include: { category: true }, ...args }),

  count: (where: Prisma.SupplierWhereInput) => prisma.supplier.count({ where }),

  /** Top N name/code matches for this company — backs the Topbar Global
   * Search's Suppliers group. */
  searchTop: (companyId: string, term: string, limit: number) =>
    prisma.supplier.findMany({
      where: {
        companyId,
        deletedAt: null,
        OR: [
          { name: { contains: term, mode: "insensitive" as const } },
          { code: { contains: term, mode: "insensitive" as const } },
        ],
      },
      select: { id: true, name: true, code: true },
      orderBy: { createdAt: "desc" },
      take: limit,
    }),

  findById: (companyId: string, id: string) =>
    prisma.supplier.findFirst({ where: { id, companyId, deletedAt: null }, include: { category: true } }),

  findByCode: (companyId: string, code: string, excludeId?: string) =>
    prisma.supplier.findFirst({
      where: { companyId, code, deletedAt: null, ...(excludeId ? { id: { not: excludeId } } : {}) },
    }),

  create: (data: Prisma.SupplierUncheckedCreateInput) => prisma.supplier.create({ data }),

  update: (id: string, data: Prisma.SupplierUncheckedUpdateInput) => prisma.supplier.update({ where: { id }, data }),
};
