import { prisma } from "@/core/db/client";
import type { Prisma } from "@prisma/client";

export const AiGarmentFabricApplicationRunRepository = {
  create: (data: Prisma.AiGarmentFabricApplicationRunUncheckedCreateInput) => prisma.aiGarmentFabricApplicationRun.create({ data }),

  findActiveSince: (designDirectionId: string, freshSince: Date) =>
    prisma.aiGarmentFabricApplicationRun.findFirst({
      where: { designDirectionId, status: "IN_PROGRESS", requestedAt: { gte: freshSince } },
    }),

  markSuccess: (id: string) =>
    prisma.aiGarmentFabricApplicationRun.update({ where: { id }, data: { status: "SUCCESS", completedAt: new Date() } }),

  markFailed: (id: string, errorCategory: string, errorMessage: string) =>
    prisma.aiGarmentFabricApplicationRun.update({
      where: { id },
      data: { status: "FAILED", errorCategory, errorMessage, completedAt: new Date() },
    }),
};

export const AiGarmentFabricApplicationRepository = {
  create: (data: Prisma.AiGarmentFabricApplicationUncheckedCreateInput) => prisma.aiGarmentFabricApplication.create({ data }),

  findByDesignDirectionId: (designDirectionId: string) =>
    prisma.aiGarmentFabricApplication.findMany({ where: { designDirectionId }, orderBy: { createdAt: "desc" } }),

  /** Verify tenant ownership before any scoped action — same pattern as SampleMaterialRepository.findWithRequestOwner. */
  findWithProjectOwner: (id: string) =>
    prisma.aiGarmentFabricApplication.findUnique({ where: { id }, include: { project: { select: { id: true, companyId: true } } } }),

  /**
   * Marks exactly one fabric application APPROVED and clears any sibling in
   * the same design direction currently holding that decision, in one
   * transaction — same exclusivity idiom already proven by
   * AiGarmentDesignOptionRepository.selectExclusive and this module's own
   * AiGarmentCommercialEvaluationItemRepository.setUserRankExclusive.
   */
  approveExclusive: (designDirectionId: string, id: string) =>
    prisma.$transaction(async (tx) => {
      await tx.aiGarmentFabricApplication.updateMany({ where: { designDirectionId, id: { not: id } }, data: { decision: "PENDING" } });
      return tx.aiGarmentFabricApplication.update({ where: { id }, data: { decision: "APPROVED" } });
    }),
};
