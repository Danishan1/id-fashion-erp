import { prisma } from "@/core/db/client";
import type { Prisma } from "@prisma/client";

export const AiGarmentValueEngineeringRunRepository = {
  create: (data: Prisma.AiGarmentValueEngineeringRunUncheckedCreateInput) => prisma.aiGarmentValueEngineeringRun.create({ data }),

  findActiveSince: (projectId: string, freshSince: Date) =>
    prisma.aiGarmentValueEngineeringRun.findFirst({
      where: { projectId, status: "IN_PROGRESS", requestedAt: { gte: freshSince } },
    }),

  markSuccess: (id: string) =>
    prisma.aiGarmentValueEngineeringRun.update({ where: { id }, data: { status: "SUCCESS", completedAt: new Date() } }),

  markFailed: (id: string, errorCategory: string, errorMessage: string) =>
    prisma.aiGarmentValueEngineeringRun.update({
      where: { id },
      data: { status: "FAILED", errorCategory, errorMessage, completedAt: new Date() },
    }),
};

export interface CreateValueEngineeringSuggestionInput {
  materialDescription: string;
  suggestedChange: string;
  costImpactDirection: "LOWER" | "SIMILAR" | "HIGHER";
  qualityRiskNotes: string;
  reasoning: string;
  sortOrder: number;
}

export const AiGarmentValueEngineeringRepository = {
  create: (
    header: Prisma.AiGarmentValueEngineeringAnalysisUncheckedCreateInput,
    suggestions: CreateValueEngineeringSuggestionInput[]
  ) =>
    prisma.aiGarmentValueEngineeringAnalysis.create({
      data: { ...header, suggestions: { create: suggestions } },
      include: { suggestions: { orderBy: { sortOrder: "asc" } } },
    }),

  /** The BOM an analysis was run against may change across runs — showing only the most recent one is the deliberate MVP scope, same as Cost Analysis's own findLatestByProjectId; older runs stay in the database (append-only) for audit, not yet surfaced in this view. */
  findLatestByProjectId: (projectId: string) =>
    prisma.aiGarmentValueEngineeringAnalysis.findFirst({
      where: { projectId },
      include: { suggestions: { orderBy: { sortOrder: "asc" } } },
      orderBy: { createdAt: "desc" },
    }),
};
