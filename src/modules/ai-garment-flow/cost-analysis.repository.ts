import { prisma } from "@/core/db/client";
import type { Prisma } from "@prisma/client";

export const AiGarmentCostAnalysisRunRepository = {
  create: (data: Prisma.AiGarmentCostAnalysisRunUncheckedCreateInput) => prisma.aiGarmentCostAnalysisRun.create({ data }),

  findActiveSince: (projectId: string, freshSince: Date) =>
    prisma.aiGarmentCostAnalysisRun.findFirst({
      where: { projectId, status: "IN_PROGRESS", requestedAt: { gte: freshSince } },
    }),

  markSuccess: (id: string) =>
    prisma.aiGarmentCostAnalysisRun.update({ where: { id }, data: { status: "SUCCESS", completedAt: new Date() } }),

  markFailed: (id: string, errorCategory: string, errorMessage: string) =>
    prisma.aiGarmentCostAnalysisRun.update({
      where: { id },
      data: { status: "FAILED", errorCategory, errorMessage, completedAt: new Date() },
    }),
};

export const AiGarmentCostAnalysisRepository = {
  create: (data: Prisma.AiGarmentCostAnalysisUncheckedCreateInput) => prisma.aiGarmentCostAnalysis.create({ data }),

  /** The design/BOM/real-costing context an analysis was run against may change across runs — showing only the most recent one is the deliberate MVP scope, same as Commercial Evaluation's own findLatestByProjectId; older runs stay in the database (append-only) for audit, not yet surfaced in this view. */
  findLatestByProjectId: (projectId: string) =>
    prisma.aiGarmentCostAnalysis.findFirst({ where: { projectId }, orderBy: { createdAt: "desc" } }),
};
