import { prisma } from "@/core/db/client";
import type { Prisma } from "@prisma/client";

export const AiGarmentCommercialEvaluationRunRepository = {
  create: (data: Prisma.AiGarmentCommercialEvaluationRunUncheckedCreateInput) => prisma.aiGarmentCommercialEvaluationRun.create({ data }),

  findActiveSince: (projectId: string, freshSince: Date) =>
    prisma.aiGarmentCommercialEvaluationRun.findFirst({
      where: { projectId, status: "IN_PROGRESS", requestedAt: { gte: freshSince } },
    }),

  markSuccess: (id: string) =>
    prisma.aiGarmentCommercialEvaluationRun.update({ where: { id }, data: { status: "SUCCESS", completedAt: new Date() } }),

  markFailed: (id: string, errorCategory: string, errorMessage: string) =>
    prisma.aiGarmentCommercialEvaluationRun.update({
      where: { id },
      data: { status: "FAILED", errorCategory, errorMessage, completedAt: new Date() },
    }),
};

const EVALUATION_WITH_ITEMS_INCLUDE = {
  items: {
    include: { designDirection: { select: { id: true, designDirectionName: true, overallScore: true, commercialClassification: true } } },
  },
} satisfies Prisma.AiGarmentCommercialEvaluationInclude;

export const AiGarmentCommercialEvaluationRepository = {
  /** One transaction — a partial failure can never leave a header with no items or items with no header. */
  create: (
    data: Prisma.AiGarmentCommercialEvaluationUncheckedCreateInput,
    items: Omit<Prisma.AiGarmentCommercialEvaluationItemUncheckedCreateInput, "evaluationId">[]
  ) =>
    prisma.$transaction(async (tx) => {
      const evaluation = await tx.aiGarmentCommercialEvaluation.create({ data });
      await tx.aiGarmentCommercialEvaluationItem.createMany({
        data: items.map((item) => ({ ...item, evaluationId: evaluation.id })),
      });
      return evaluation.id;
    }),

  /** The comparison set may change across runs — showing only the most recent evaluation is the deliberate MVP scope; older ones stay in the database (append-only) for audit, not surfaced in this view yet. */
  findLatestByProjectId: (projectId: string) =>
    prisma.aiGarmentCommercialEvaluation.findFirst({
      where: { projectId },
      orderBy: { createdAt: "desc" },
      include: EVALUATION_WITH_ITEMS_INCLUDE,
    }),

  findById: (id: string) => prisma.aiGarmentCommercialEvaluation.findUnique({ where: { id }, include: EVALUATION_WITH_ITEMS_INCLUDE }),
};

export const AiGarmentCommercialEvaluationItemRepository = {
  /** Verify tenant ownership before any scoped action — same pattern as SampleMaterialRepository.findWithRequestOwner. */
  findWithProjectOwner: (id: string) =>
    prisma.aiGarmentCommercialEvaluationItem.findUnique({
      where: { id },
      include: { evaluation: { include: { project: { select: { id: true, companyId: true } } } } },
    }),

  /**
   * Marks exactly one item's userRank and clears any sibling in the same
   * evaluation currently holding that same rank, in one transaction — a
   * partial failure can never leave two items both overridden to FIRST_CHOICE.
   * Setting `userRank: null` only ever clears the target item itself (there's
   * no sibling to clear a "no override" state from).
   */
  setUserRankExclusive: (evaluationId: string, itemId: string, userRank: "FIRST_CHOICE" | "SECOND_CHOICE" | "THIRD_CHOICE" | null) =>
    prisma.$transaction(async (tx) => {
      if (userRank) {
        await tx.aiGarmentCommercialEvaluationItem.updateMany({
          where: { evaluationId, userRank, id: { not: itemId } },
          data: { userRank: null },
        });
      }
      return tx.aiGarmentCommercialEvaluationItem.update({ where: { id: itemId }, data: { userRank } });
    }),
};
