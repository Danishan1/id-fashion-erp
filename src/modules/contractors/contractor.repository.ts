import { prisma } from "@/core/db/client";
import type { Prisma } from "@prisma/client";

/** Stages ordered by the contractor's own working sequence. */
export const CONTRACTOR_STAGES_INCLUDE = {
  stages: {
    orderBy: { sequence: "asc" as const },
    select: {
      id: true,
      sequence: true,
      productionStageId: true,
      productionStage: { select: { id: true, code: true, name: true, sequence: true, isActive: true } },
    },
  },
} satisfies Prisma.ContractorInclude;

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
    prisma.contractor.findFirst({ where: { id, companyId, deletedAt: null }, include: CONTRACTOR_STAGES_INCLUDE }),

  /** Company-scoped stage lookup used to validate a contractor's stage list. */
  findStagesByIds: (companyId: string, ids: string[]) =>
    prisma.productionStage.findMany({ where: { companyId, id: { in: ids } }, select: { id: true, isActive: true, name: true } }),

  replaceStagesInTx: async (tx: Prisma.TransactionClient, contractorId: string, stageIds: string[]) => {
    await tx.contractorStage.deleteMany({ where: { contractorId } });
    if (stageIds.length) {
      await tx.contractorStage.createMany({
        data: stageIds.map((productionStageId, index) => ({ contractorId, productionStageId, sequence: index })),
      });
    }
  },

  findByCode: (companyId: string, code: string, excludeId?: string) =>
    prisma.contractor.findFirst({
      where: { companyId, code, deletedAt: null, ...(excludeId ? { id: { not: excludeId } } : {}) },
    }),

  create: (data: Prisma.ContractorUncheckedCreateInput) => prisma.contractor.create({ data }),

  createInTx: (tx: Prisma.TransactionClient, data: Prisma.ContractorUncheckedCreateInput) => tx.contractor.create({ data }),

  updateInTx: (tx: Prisma.TransactionClient, id: string, data: Prisma.ContractorUncheckedUpdateInput) =>
    tx.contractor.update({ where: { id }, data }),

  update: (id: string, data: Prisma.ContractorUncheckedUpdateInput) =>
    prisma.contractor.update({ where: { id }, data }),
};
