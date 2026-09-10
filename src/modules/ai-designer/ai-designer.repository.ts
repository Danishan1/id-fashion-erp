import { prisma } from "@/core/db/client";
import type { Prisma } from "@prisma/client";

export const AiDesignerProjectRepository = {
  findMany: (where: Prisma.AiDesignerProjectWhereInput, args: Omit<Prisma.AiDesignerProjectFindManyArgs, "where">) =>
    prisma.aiDesignerProject.findMany({
      where,
      include: {
        fabricProduct: { select: { id: true, styleName: true, styleCode: true } },
        createdBy: { select: { id: true, fullName: true } },
        _count: { select: { versions: true } },
      },
      ...args,
    }),

  count: (where: Prisma.AiDesignerProjectWhereInput) => prisma.aiDesignerProject.count({ where }),

  findAnyById: (companyId: string, id: string) => prisma.aiDesignerProject.findFirst({ where: { id, companyId } }),

  findByIdWithDetails: (companyId: string, id: string) =>
    prisma.aiDesignerProject.findFirst({
      where: { id, companyId },
      include: {
        fabricProduct: { select: { id: true, styleName: true, styleCode: true, unitCost: true } },
        fabricSupplier: { select: { id: true, name: true } },
        createdBy: { select: { id: true, fullName: true } },
        currentVersion: { include: { currentImage: true } },
        versions: { orderBy: { versionNumber: "desc" }, include: { currentImage: true } },
      },
    }),

  create: (data: Prisma.AiDesignerProjectUncheckedCreateInput) => prisma.aiDesignerProject.create({ data }),

  update: (id: string, data: Prisma.AiDesignerProjectUncheckedUpdateInput) =>
    prisma.aiDesignerProject.update({ where: { id }, data }),
};

export const AiDesignerPromptRepository = {
  create: (data: Prisma.AiDesignerPromptUncheckedCreateInput) => prisma.aiDesignerPrompt.create({ data }),

  markSuccess: (id: string) =>
    prisma.aiDesignerPrompt.update({ where: { id }, data: { status: "SUCCESS", completedAt: new Date() } }),

  /** Like markSuccess, but also corrects provider/model to whichever one actually served the request — with AIProviderManager's automatic failover, that can genuinely differ from the value recorded when the row was first created (before any provider was resolved). */
  markSuccessWithProvider: (id: string, provider: string, model: string) =>
    prisma.aiDesignerPrompt.update({ where: { id }, data: { status: "SUCCESS", completedAt: new Date(), provider, model } }),

  markFailed: (id: string, errorCategory: string, errorMessage: string) =>
    prisma.aiDesignerPrompt.update({
      where: { id },
      data: { status: "FAILED", errorCategory, errorMessage, completedAt: new Date() },
    }),

  /** A stuck IN_PROGRESS row older than the freshness window is treated as abandoned, not a permanent lock — same discipline as every AI Garment Flow run-log table. */
  findActiveSince: (projectId: string, promptType: "FABRIC_ANALYSIS" | "IMAGE_GENERATE" | "IMAGE_EDIT", freshSince: Date) =>
    prisma.aiDesignerPrompt.findFirst({
      where: { projectId, promptType, status: "IN_PROGRESS", requestedAt: { gte: freshSince } },
    }),
};

export const AiDesignerGenerationRepository = {
  create: (data: Prisma.AiDesignerGenerationUncheckedCreateInput) => prisma.aiDesignerGeneration.create({ data }),

  markSuccess: (id: string) => prisma.aiDesignerGeneration.update({ where: { id }, data: { status: "SUCCESS" } }),

  markFailed: (id: string) => prisma.aiDesignerGeneration.update({ where: { id }, data: { status: "FAILED" } }),
};

export const AiDesignerImageRepository = {
  createMany: (data: Prisma.AiDesignerImageUncheckedCreateInput[]) => prisma.aiDesignerImage.createMany({ data }),

  findByGenerationId: (generationId: string) =>
    prisma.aiDesignerImage.findMany({ where: { generationId }, orderBy: { createdAt: "asc" } }),

  findByProjectId: (projectId: string) =>
    prisma.aiDesignerImage.findMany({ where: { projectId }, orderBy: { createdAt: "desc" } }),

  findById: (id: string) => prisma.aiDesignerImage.findUnique({ where: { id } }),

  /** Verifies tenant ownership before any scoped image action, same pattern as SampleMaterialRepository.findWithRequestOwner. */
  findWithProjectOwner: (id: string) =>
    prisma.aiDesignerImage.findUnique({ where: { id }, include: { project: true } }),

  update: (id: string, data: Prisma.AiDesignerImageUncheckedUpdateInput) =>
    prisma.aiDesignerImage.update({ where: { id }, data }),
};

export const AiDesignerVersionRepository = {
  create: (data: Prisma.AiDesignerVersionUncheckedCreateInput) => prisma.aiDesignerVersion.create({ data }),

  findByProjectId: (projectId: string) =>
    prisma.aiDesignerVersion.findMany({
      where: { projectId },
      orderBy: { versionNumber: "desc" },
      include: { currentImage: true, createdBy: { select: { id: true, fullName: true } } },
    }),

  count: (projectId: string) => prisma.aiDesignerVersion.count({ where: { projectId } }),
};
