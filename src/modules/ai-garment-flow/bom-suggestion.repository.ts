import { prisma } from "@/core/db/client";
import type { Prisma } from "@prisma/client";

export const AiGarmentBomSuggestionRunRepository = {
  create: (data: Prisma.AiGarmentBomSuggestionRunUncheckedCreateInput) => prisma.aiGarmentBomSuggestionRun.create({ data }),

  findActiveSince: (designDirectionId: string, freshSince: Date) =>
    prisma.aiGarmentBomSuggestionRun.findFirst({
      where: { designDirectionId, status: "IN_PROGRESS", requestedAt: { gte: freshSince } },
    }),

  markSuccess: (id: string) =>
    prisma.aiGarmentBomSuggestionRun.update({ where: { id }, data: { status: "SUCCESS", completedAt: new Date() } }),

  markFailed: (id: string, errorCategory: string, errorMessage: string) =>
    prisma.aiGarmentBomSuggestionRun.update({
      where: { id },
      data: { status: "FAILED", errorCategory, errorMessage, completedAt: new Date() },
    }),
};

export const AiGarmentBomSuggestionRepository = {
  createMany: (data: Prisma.AiGarmentBomSuggestionCreateManyInput[]) => prisma.aiGarmentBomSuggestion.createMany({ data }),

  findByDesignDirectionId: (designDirectionId: string) =>
    prisma.aiGarmentBomSuggestion.findMany({ where: { designDirectionId }, orderBy: { createdAt: "desc" } }),

  /** Verify tenant ownership before any scoped action — same pattern as SampleMaterialRepository.findWithRequestOwner. */
  findWithProjectOwner: (id: string) =>
    prisma.aiGarmentBomSuggestion.findUnique({ where: { id }, include: { project: { select: { id: true, companyId: true } } } }),

  markAdded: (id: string, resolvedBomItemId: string) =>
    prisma.aiGarmentBomSuggestion.update({ where: { id }, data: { decision: "ADDED", resolvedBomItemId } }),

  markDismissed: (id: string) => prisma.aiGarmentBomSuggestion.update({ where: { id }, data: { decision: "DISMISSED" } }),
};
