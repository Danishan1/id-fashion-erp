import { prisma } from "@/core/db/client";
import type { Prisma } from "@prisma/client";

export const AiGarmentBuyerCommentsRunRepository = {
  create: (data: Prisma.AiGarmentBuyerCommentsRunUncheckedCreateInput) => prisma.aiGarmentBuyerCommentsRun.create({ data }),

  findActiveSince: (projectId: string, freshSince: Date) =>
    prisma.aiGarmentBuyerCommentsRun.findFirst({
      where: { projectId, status: "IN_PROGRESS", requestedAt: { gte: freshSince } },
    }),

  markSuccess: (id: string) =>
    prisma.aiGarmentBuyerCommentsRun.update({ where: { id }, data: { status: "SUCCESS", completedAt: new Date() } }),

  markFailed: (id: string, errorCategory: string, errorMessage: string) =>
    prisma.aiGarmentBuyerCommentsRun.update({
      where: { id },
      data: { status: "FAILED", errorCategory, errorMessage, completedAt: new Date() },
    }),
};

export interface CreateBuyerCommentCategorySummaryInput {
  category: "FIT" | "CONSTRUCTION" | "FABRIC" | "COLOR" | "TRIM" | "PRICING" | "OTHER";
  summary: string;
  evidenceExcerpt: string;
  sortOrder: number;
}

export const AiGarmentBuyerCommentsRepository = {
  create: (
    header: Prisma.AiGarmentBuyerCommentsAnalysisUncheckedCreateInput,
    categories: CreateBuyerCommentCategorySummaryInput[]
  ) =>
    prisma.aiGarmentBuyerCommentsAnalysis.create({
      data: { ...header, categories: { create: categories } },
      include: { categories: { orderBy: { sortOrder: "asc" } } },
    }),

  /** The real feedback an analysis was run against may keep growing — showing only the most recent summary is the deliberate MVP scope, same as Cost Analysis/Value Engineering's own findLatestByProjectId; older runs stay in the database (append-only) for audit, not yet surfaced in this view. */
  findLatestByProjectId: (projectId: string) =>
    prisma.aiGarmentBuyerCommentsAnalysis.findFirst({
      where: { projectId },
      include: { categories: { orderBy: { sortOrder: "asc" } } },
      orderBy: { createdAt: "desc" },
    }),
};
