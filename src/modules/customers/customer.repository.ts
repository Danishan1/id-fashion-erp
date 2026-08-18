import { prisma } from "@/core/db/client";
import type { Prisma } from "@prisma/client";

/**
 * Thin data-access layer for Customers/Buyers — plain functions, no class, no
 * generic base type (matches this codebase's function-based style). Services
 * depend on this module instead of `@/core/db/client` directly so business
 * logic can be unit-tested by mocking these functions, without a real DB.
 */
export const CustomerRepository = {
  findMany: (where: Prisma.CustomerWhereInput, args: Omit<Prisma.CustomerFindManyArgs, "where">) =>
    prisma.customer.findMany({ where, ...args }),

  count: (where: Prisma.CustomerWhereInput) => prisma.customer.count({ where }),

  findByIdWithBuyers: (companyId: string, id: string) =>
    prisma.customer.findFirst({
      where: { id, companyId, deletedAt: null },
      include: { buyers: { orderBy: { name: "asc" } } },
    }),

  findByCode: (companyId: string, code: string, excludeId?: string) =>
    prisma.customer.findFirst({
      where: { companyId, code, deletedAt: null, ...(excludeId ? { id: { not: excludeId } } : {}) },
    }),

  create: (data: Prisma.CustomerUncheckedCreateInput) => prisma.customer.create({ data }),

  update: (id: string, data: Prisma.CustomerUncheckedUpdateInput) => prisma.customer.update({ where: { id }, data }),
};

export const BuyerRepository = {
  findByCode: (customerId: string, code: string) => prisma.buyer.findFirst({ where: { customerId, code } }),

  create: (data: Prisma.BuyerUncheckedCreateInput) => prisma.buyer.create({ data }),
};
