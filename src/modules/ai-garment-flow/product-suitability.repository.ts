import { prisma } from "@/core/db/client";
import type { Prisma } from "@prisma/client";

const SUITABILITY_WITH_ITEMS_INCLUDE = {
  items: {
    include: { productType: { select: { id: true, code: true, name: true } } },
    orderBy: { productType: { name: "asc" } },
  },
  approvedBy: { select: { id: true, fullName: true } },
} satisfies Prisma.AiGarmentProductSuitabilityInclude;

export const AiGarmentProductSuitabilityRepository = {
  findByProjectId: (projectId: string) =>
    prisma.aiGarmentProductSuitability.findUnique({
      where: { projectId },
      include: SUITABILITY_WITH_ITEMS_INCLUDE,
    }),

  /** Verify tenant ownership before any scoped action — same pattern as SampleVersionRepository.findWithRequestOwner. */
  findByIdWithProjectOwner: (id: string) =>
    prisma.aiGarmentProductSuitability.findUnique({
      where: { id },
      include: { project: true, items: true },
    }),

  /**
   * Fully replaces the assessment for a project: deletes every existing item
   * row, upserts the header (analysisVersion always the caller-computed next
   * value), and inserts the new item set — one transaction, so a re-run can
   * never leave a mix of old and new rows. Mirrors
   * AiGarmentFabricAnalysisRepository.replaceForProject exactly.
   */
  replaceForProject: (
    projectId: string,
    header: Prisma.AiGarmentProductSuitabilityUncheckedCreateInput,
    items: Omit<Prisma.AiGarmentProductSuitabilityItemUncheckedCreateInput, "suitabilityId">[]
  ) =>
    prisma.$transaction(async (tx) => {
      const existing = await tx.aiGarmentProductSuitability.findUnique({ where: { projectId } });
      if (existing) {
        await tx.aiGarmentProductSuitabilityItem.deleteMany({ where: { suitabilityId: existing.id } });
      }

      const suitability = await tx.aiGarmentProductSuitability.upsert({
        where: { projectId },
        create: header,
        update: header,
      });

      await tx.aiGarmentProductSuitabilityItem.createMany({
        data: items.map((i) => ({ ...i, suitabilityId: suitability.id })),
      });

      return suitability;
    }),

  approveWithItems: (suitabilityId: string, approvedByUserId: string) =>
    prisma.$transaction(async (tx) => {
      const approvedAt = new Date();
      const suitability = await tx.aiGarmentProductSuitability.update({
        where: { id: suitabilityId },
        data: { status: "APPROVED", approvedByUserId, approvedAt },
      });
      await tx.aiGarmentProductSuitabilityItem.updateMany({
        where: { suitabilityId },
        data: { approvedByUserId, approvedAt },
      });
      return suitability;
    }),

  updateStatus: (id: string, status: Prisma.AiGarmentProductSuitabilityUncheckedUpdateInput["status"]) =>
    prisma.aiGarmentProductSuitability.update({ where: { id }, data: { status } }),
};

export const AiGarmentProductSuitabilityItemRepository = {
  /** Verify tenant ownership before any scoped edit — same pattern as SampleMaterialRepository.findWithRequestOwner. */
  findWithSuitabilityOwner: (id: string) =>
    prisma.aiGarmentProductSuitabilityItem.findUnique({
      where: { id },
      include: { suitability: { include: { project: true } } },
    }),

  update: (id: string, data: Prisma.AiGarmentProductSuitabilityItemUncheckedUpdateInput) =>
    prisma.aiGarmentProductSuitabilityItem.update({ where: { id }, data }),
};

export const AiGarmentProductSuitabilityRunRepository = {
  /** A run still "IN_PROGRESS" more recently than `freshSince` blocks a new one — an older stuck row (e.g. from a crashed request) is treated as abandoned and does not block re-assessment forever. */
  findActiveSince: (projectId: string, freshSince: Date) =>
    prisma.aiGarmentProductSuitabilityRun.findFirst({
      where: { projectId, status: "IN_PROGRESS", requestedAt: { gte: freshSince } },
    }),

  create: (data: Prisma.AiGarmentProductSuitabilityRunUncheckedCreateInput) => prisma.aiGarmentProductSuitabilityRun.create({ data }),

  markSuccess: (id: string, suitabilityId: string) =>
    prisma.aiGarmentProductSuitabilityRun.update({
      where: { id },
      data: { status: "SUCCESS", suitabilityId, completedAt: new Date() },
    }),

  markFailed: (id: string, errorCategory: string, errorMessage: string) =>
    prisma.aiGarmentProductSuitabilityRun.update({
      where: { id },
      data: { status: "FAILED", errorCategory, errorMessage, completedAt: new Date() },
    }),
};
