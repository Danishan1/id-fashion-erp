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

  /** Top N name/code matches for this company — backs the Topbar Global
   * Search's Customers group. */
  searchTop: (companyId: string, term: string, limit: number) =>
    prisma.customer.findMany({
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

  // Company-scoped via the parent customer, matching this project's
  // established tenant-scoping convention for every by-id lookup.
  findByIdForCustomer: (companyId: string, customerId: string, id: string) =>
    prisma.buyer.findFirst({ where: { id, customerId, customer: { companyId } } }),

  create: (data: Prisma.BuyerUncheckedCreateInput) => prisma.buyer.create({ data }),

  update: (id: string, data: Prisma.BuyerUncheckedUpdateInput) => prisma.buyer.update({ where: { id }, data }),
};
