import { prisma } from "@/core/db/client";
import type { Prisma } from "@prisma/client";

export const ContractorRepository = {
  findMany: (where: Prisma.ContractorWhereInput, args: Omit<Prisma.ContractorFindManyArgs, "where">) =>
    prisma.contractor.findMany({ where, ...args }),

  count: (where: Prisma.ContractorWhereInput) => prisma.contractor.count({ where }),

  /** Top N name/code matches for this company — backs the Topbar Global
   * Search's Contractors group. */
  searchTop: (companyId: string, term: string, limit: number) =>
    prisma.contractor.findMany({
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
    prisma.contractor.findFirst({ where: { id, companyId, deletedAt: null } }),

  findByCode: (companyId: string, code: string, excludeId?: string) =>
    prisma.contractor.findFirst({
      where: { companyId, code, deletedAt: null, ...(excludeId ? { id: { not: excludeId } } : {}) },
    }),

  create: (data: Prisma.ContractorUncheckedCreateInput) => prisma.contractor.create({ data }),

  update: (id: string, data: Prisma.ContractorUncheckedUpdateInput) =>
    prisma.contractor.update({ where: { id }, data }),
};
