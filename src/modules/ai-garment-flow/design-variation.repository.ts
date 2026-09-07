import { prisma } from "@/core/db/client";
import type { Prisma } from "@prisma/client";

export const AiGarmentDesignVariationRunRepository = {
  create: (data: Prisma.AiGarmentDesignVariationRunUncheckedCreateInput) => prisma.aiGarmentDesignVariationRun.create({ data }),

  /** Same freshness-window pattern as AiGarmentImageGenerationRunRepository.findActiveSince — a stuck IN_PROGRESS row older than the window is treated as abandoned, not a permanent lock. */
  findActiveSince: (parentGeneratedImageId: string, freshSince: Date) =>
    prisma.aiGarmentDesignVariationRun.findFirst({
      where: { parentGeneratedImageId, status: "IN_PROGRESS", requestedAt: { gte: freshSince } },
    }),

  markSuccess: (id: string) =>
    prisma.aiGarmentDesignVariationRun.update({ where: { id }, data: { status: "SUCCESS", completedAt: new Date() } }),

  markFailed: (id: string, errorCategory: string, errorMessage: string) =>
    prisma.aiGarmentDesignVariationRun.update({
      where: { id },
      data: { status: "FAILED", errorCategory, errorMessage, completedAt: new Date() },
    }),
};

export const AiGarmentDesignVariationRepository = {
  create: (data: Prisma.AiGarmentDesignVariationUncheckedCreateInput) => prisma.aiGarmentDesignVariation.create({ data }),

  findByParentImageId: (parentGeneratedImageId: string) =>
    prisma.aiGarmentDesignVariation.findMany({
      where: { parentGeneratedImageId },
      orderBy: { variationNumber: "asc" },
    }),

  countByParentImageId: (parentGeneratedImageId: string) => prisma.aiGarmentDesignVariation.count({ where: { parentGeneratedImageId } }),

  /** Verify tenant ownership before any scoped action — same pattern as AiGarmentGeneratedImageRepository.findWithProjectOwner. */
  findWithProjectOwner: (id: string) =>
    prisma.aiGarmentDesignVariation.findUnique({
      where: { id },
      include: { project: { select: { id: true, companyId: true } } },
    }),

  update: (id: string, data: Prisma.AiGarmentDesignVariationUncheckedUpdateInput) =>
    prisma.aiGarmentDesignVariation.update({ where: { id }, data }),
};
