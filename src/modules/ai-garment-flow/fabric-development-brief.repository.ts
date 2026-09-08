import { prisma } from "@/core/db/client";
import type { Prisma } from "@prisma/client";

export const AiGarmentFabricDevelopmentRunRepository = {
  create: (data: Prisma.AiGarmentFabricDevelopmentRunUncheckedCreateInput) =>
    prisma.aiGarmentFabricDevelopmentRun.create({ data }),

  findActiveSince: (projectId: string, freshSince: Date) =>
    prisma.aiGarmentFabricDevelopmentRun.findFirst({
      where: { projectId, status: "IN_PROGRESS", requestedAt: { gte: freshSince } },
    }),

  markSuccess: (id: string) =>
    prisma.aiGarmentFabricDevelopmentRun.update({ where: { id }, data: { status: "SUCCESS", completedAt: new Date() } }),

  markFailed: (id: string, errorCategory: string, errorMessage: string) =>
    prisma.aiGarmentFabricDevelopmentRun.update({
      where: { id },
      data: { status: "FAILED", errorCategory, errorMessage, completedAt: new Date() },
    }),

  findById: (id: string) => prisma.aiGarmentFabricDevelopmentRun.findUnique({ where: { id } }),
};
