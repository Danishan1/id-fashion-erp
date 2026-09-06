import { prisma } from "@/core/db/client";
import type { Prisma } from "@prisma/client";

export const AiGarmentDevelopmentBriefRunRepository = {
  create: (data: Prisma.AiGarmentDevelopmentBriefRunUncheckedCreateInput) =>
    prisma.aiGarmentDevelopmentBriefRun.create({ data }),

  findActiveSince: (projectId: string, freshSince: Date) =>
    prisma.aiGarmentDevelopmentBriefRun.findFirst({
      where: { projectId, status: "IN_PROGRESS", requestedAt: { gte: freshSince } },
    }),

  markSuccess: (id: string) =>
    prisma.aiGarmentDevelopmentBriefRun.update({ where: { id }, data: { status: "SUCCESS", completedAt: new Date() } }),

  markFailed: (id: string, errorCategory: string, errorMessage: string) =>
    prisma.aiGarmentDevelopmentBriefRun.update({
      where: { id },
      data: { status: "FAILED", errorCategory, errorMessage, completedAt: new Date() },
    }),

  findById: (id: string) => prisma.aiGarmentDevelopmentBriefRun.findUnique({ where: { id } }),
};

export const AiGarmentDesignDirectionRepository = {
  findByProjectId: (projectId: string) =>
    prisma.aiGarmentDesignDirection.findMany({ where: { projectId }, orderBy: { overallScore: "desc" } }),

  /** Verify tenant ownership before any scoped action — same pattern as SampleMaterialRepository.findWithRequestOwner. */
  findWithProjectOwner: (id: string) =>
    prisma.aiGarmentDesignDirection.findUnique({ where: { id }, include: { project: true } }),

  createMany: (rows: Prisma.AiGarmentDesignDirectionUncheckedCreateInput[]) =>
    prisma.aiGarmentDesignDirection.createMany({ data: rows }),

  update: (id: string, data: Prisma.AiGarmentDesignDirectionUncheckedUpdateInput) =>
    prisma.aiGarmentDesignDirection.update({ where: { id }, data }),

  /** Recomputes isRecommendedForVisualisation across every non-REJECTED direction in the project, in one transaction — top ~30% by overallScore (min 1). */
  recomputeRecommendations: (projectId: string) =>
    prisma.$transaction(async (tx) => {
      const eligible = await tx.aiGarmentDesignDirection.findMany({
        where: { projectId, status: { not: "REJECTED" } },
        orderBy: { overallScore: "desc" },
        select: { id: true },
      });
      const recommendedCount = Math.max(1, Math.round(eligible.length * 0.3));
      const recommendedIds = eligible.slice(0, recommendedCount).map((d) => d.id);

      await tx.aiGarmentDesignDirection.updateMany({
        where: { projectId },
        data: { isRecommendedForVisualisation: false },
      });
      if (recommendedIds.length > 0) {
        await tx.aiGarmentDesignDirection.updateMany({
          where: { id: { in: recommendedIds } },
          data: { isRecommendedForVisualisation: true },
        });
      }
    }),

  countByStatus: (projectId: string, status: "APPROVED") => prisma.aiGarmentDesignDirection.count({ where: { projectId, status } }),
};
