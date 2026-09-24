import { prisma } from "@/core/db/client";
import type { Prisma } from "@prisma/client";

export const ReplicateDesignProjectRepository = {
  findMany: (where: Prisma.ReplicateDesignProjectWhereInput, args: Omit<Prisma.ReplicateDesignProjectFindManyArgs, "where">) =>
    prisma.replicateDesignProject.findMany({
      where,
      include: {
        fabricProduct: { select: { id: true, styleName: true, styleCode: true } },
        createdBy: { select: { id: true, fullName: true } },
        _count: { select: { versions: true } },
      },
      ...args,
    }),

  count: (where: Prisma.ReplicateDesignProjectWhereInput) => prisma.replicateDesignProject.count({ where }),

  findAnyById: (companyId: string, id: string) => prisma.replicateDesignProject.findFirst({ where: { id, companyId } }),

  findByIdWithDetails: (companyId: string, id: string) =>
    prisma.replicateDesignProject.findFirst({
      where: { id, companyId },
      include: {
        company: { select: { name: true } },
        fabricProduct: { select: { id: true, styleName: true, styleCode: true, unitCost: true } },
        fabricSupplier: { select: { id: true, name: true } },
        createdBy: { select: { id: true, fullName: true } },
        currentVersion: { include: { currentImage: true } },
        versions: { orderBy: { versionNumber: "desc" }, include: { currentImage: true } },
        materialLines: { include: { product: { select: { id: true, styleName: true, styleCode: true } }, uom: true }, orderBy: { createdAt: "asc" } },
        dnaAnalysis: { include: { observations: { orderBy: { featureKey: "asc" } } } },
        compatibilityCheck: { include: { items: true } },
      },
    }),

  create: (data: Prisma.ReplicateDesignProjectUncheckedCreateInput) => prisma.replicateDesignProject.create({ data }),

  update: (id: string, data: Prisma.ReplicateDesignProjectUncheckedUpdateInput) =>
    prisma.replicateDesignProject.update({ where: { id }, data }),
};

export const ReplicateDesignDnaAnalysisRepository = {
  findByProjectId: (projectId: string) =>
    prisma.replicateDesignDnaAnalysis.findUnique({
      where: { projectId },
      include: { observations: { orderBy: { featureKey: "asc" } } },
    }),

  /** Full replace on re-analysis — deletes any prior observations first, same "1:1, fully replaced" convention as the sibling AI Garment Flow analyses. */
  upsertWithObservations: (
    projectId: string,
    data: Prisma.ReplicateDesignDnaAnalysisUncheckedCreateInput,
    observations: Omit<Prisma.ReplicateDesignDnaObservationUncheckedCreateInput, "analysisId">[]
  ) =>
    prisma.$transaction(async (tx) => {
      const existing = await tx.replicateDesignDnaAnalysis.findUnique({ where: { projectId } });
      if (existing) {
        await tx.replicateDesignDnaObservation.deleteMany({ where: { analysisId: existing.id } });
        await tx.replicateDesignDnaAnalysis.update({ where: { id: existing.id }, data });
        await tx.replicateDesignDnaObservation.createMany({
          data: observations.map((o) => ({ ...o, analysisId: existing.id })),
        });
        return tx.replicateDesignDnaAnalysis.findUniqueOrThrow({
          where: { id: existing.id },
          include: { observations: { orderBy: { featureKey: "asc" } } },
        });
      }
      const created = await tx.replicateDesignDnaAnalysis.create({ data });
      await tx.replicateDesignDnaObservation.createMany({
        data: observations.map((o) => ({ ...o, analysisId: created.id })),
      });
      return tx.replicateDesignDnaAnalysis.findUniqueOrThrow({
        where: { id: created.id },
        include: { observations: { orderBy: { featureKey: "asc" } } },
      });
    }),

  markStale: (projectId: string) =>
    prisma.replicateDesignDnaAnalysis.updateMany({ where: { projectId }, data: { status: "STALE" } }),

  update: (id: string, data: Prisma.ReplicateDesignDnaAnalysisUncheckedUpdateInput) =>
    prisma.replicateDesignDnaAnalysis.update({ where: { id }, data }),

  approveAllObservations: (analysisId: string, approvedByUserId: string) =>
    prisma.$transaction([
      prisma.replicateDesignDnaAnalysis.update({
        where: { id: analysisId },
        data: { status: "APPROVED", approvedByUserId, approvedAt: new Date() },
      }),
      prisma.replicateDesignDnaObservation.updateMany({
        where: { analysisId },
        data: { approvedByUserId, approvedAt: new Date() },
      }),
    ]),
};

export const ReplicateDesignDnaObservationRepository = {
  findWithAnalysisOwner: (id: string) =>
    prisma.replicateDesignDnaObservation.findUnique({ where: { id }, include: { analysis: true } }),

  update: (id: string, data: Prisma.ReplicateDesignDnaObservationUncheckedUpdateInput) =>
    prisma.replicateDesignDnaObservation.update({ where: { id }, data }),
};

export const ReplicateDesignDnaAnalysisRunRepository = {
  create: (data: Prisma.ReplicateDesignDnaAnalysisRunUncheckedCreateInput) => prisma.replicateDesignDnaAnalysisRun.create({ data }),

  markSuccess: (id: string, analysisId: string) =>
    prisma.replicateDesignDnaAnalysisRun.update({ where: { id }, data: { status: "SUCCESS", analysisId, completedAt: new Date() } }),

  markFailed: (id: string, errorCategory: string, errorMessage: string) =>
    prisma.replicateDesignDnaAnalysisRun.update({
      where: { id },
      data: { status: "FAILED", errorCategory, errorMessage, completedAt: new Date() },
    }),

  findActiveSince: (projectId: string, freshSince: Date) =>
    prisma.replicateDesignDnaAnalysisRun.findFirst({
      where: { projectId, status: "IN_PROGRESS", requestedAt: { gte: freshSince } },
    }),
};

export const ReplicateDesignMaterialLineRepository = {
  findByProjectId: (projectId: string) =>
    prisma.replicateDesignMaterialLine.findMany({
      where: { projectId },
      include: { product: { select: { id: true, styleName: true, styleCode: true } }, uom: true },
      orderBy: { createdAt: "asc" },
    }),

  findAnyById: (companyId: string, id: string) => prisma.replicateDesignMaterialLine.findFirst({ where: { id, companyId } }),

  create: (data: Prisma.ReplicateDesignMaterialLineUncheckedCreateInput) => prisma.replicateDesignMaterialLine.create({ data }),

  delete: (id: string) => prisma.replicateDesignMaterialLine.delete({ where: { id } }),
};

export const ReplicateDesignCompatibilityRepository = {
  findByProjectId: (projectId: string) =>
    prisma.replicateDesignCompatibilityCheck.findUnique({ where: { projectId }, include: { items: true } }),

  /** Full replace on re-run, same "1:1, replaced each run" convention as the DNA analysis. */
  upsertWithItems: (
    projectId: string,
    data: Prisma.ReplicateDesignCompatibilityCheckUncheckedCreateInput,
    items: Omit<Prisma.ReplicateDesignCompatibilityItemUncheckedCreateInput, "checkId">[]
  ) =>
    prisma.$transaction(async (tx) => {
      const existing = await tx.replicateDesignCompatibilityCheck.findUnique({ where: { projectId } });
      if (existing) {
        await tx.replicateDesignCompatibilityItem.deleteMany({ where: { checkId: existing.id } });
        await tx.replicateDesignCompatibilityCheck.update({ where: { id: existing.id }, data });
        await tx.replicateDesignCompatibilityItem.createMany({ data: items.map((i) => ({ ...i, checkId: existing.id })) });
        return tx.replicateDesignCompatibilityCheck.findUniqueOrThrow({ where: { id: existing.id }, include: { items: true } });
      }
      const created = await tx.replicateDesignCompatibilityCheck.create({ data });
      await tx.replicateDesignCompatibilityItem.createMany({ data: items.map((i) => ({ ...i, checkId: created.id })) });
      return tx.replicateDesignCompatibilityCheck.findUniqueOrThrow({ where: { id: created.id }, include: { items: true } });
    }),
};

export const ReplicateDesignCompatibilityRunRepository = {
  create: (data: Prisma.ReplicateDesignCompatibilityRunUncheckedCreateInput) => prisma.replicateDesignCompatibilityRun.create({ data }),

  markSuccess: (id: string, checkId: string) =>
    prisma.replicateDesignCompatibilityRun.update({ where: { id }, data: { status: "SUCCESS", checkId, completedAt: new Date() } }),

  markFailed: (id: string, errorCategory: string, errorMessage: string) =>
    prisma.replicateDesignCompatibilityRun.update({
      where: { id },
      data: { status: "FAILED", errorCategory, errorMessage, completedAt: new Date() },
    }),

  findActiveSince: (projectId: string, freshSince: Date) =>
    prisma.replicateDesignCompatibilityRun.findFirst({
      where: { projectId, status: "IN_PROGRESS", requestedAt: { gte: freshSince } },
    }),
};

export const ReplicateDesignPromptRepository = {
  create: (data: Prisma.ReplicateDesignPromptUncheckedCreateInput) => prisma.replicateDesignPrompt.create({ data }),

  markSuccess: (id: string) => prisma.replicateDesignPrompt.update({ where: { id }, data: { status: "SUCCESS", completedAt: new Date() } }),

  markSuccessWithProvider: (id: string, provider: string, model: string) =>
    prisma.replicateDesignPrompt.update({ where: { id }, data: { status: "SUCCESS", completedAt: new Date(), provider, model } }),

  markFailed: (id: string, errorCategory: string, errorMessage: string) =>
    prisma.replicateDesignPrompt.update({
      where: { id },
      data: { status: "FAILED", errorCategory, errorMessage, completedAt: new Date() },
    }),

  findActiveSince: (projectId: string, promptType: "IMAGE_GENERATE" | "IMAGE_EDIT", freshSince: Date) =>
    prisma.replicateDesignPrompt.findFirst({
      where: { projectId, promptType, status: "IN_PROGRESS", requestedAt: { gte: freshSince } },
    }),
};

export const ReplicateDesignGenerationRepository = {
  create: (data: Prisma.ReplicateDesignGenerationUncheckedCreateInput) => prisma.replicateDesignGeneration.create({ data }),

  markSuccess: (id: string) => prisma.replicateDesignGeneration.update({ where: { id }, data: { status: "SUCCESS" } }),

  markFailed: (id: string) => prisma.replicateDesignGeneration.update({ where: { id }, data: { status: "FAILED" } }),

  /** Used by applyReplicateEditVariation() to verify a preview's own parentImageId still matches the project's real current image, and to recover the originating prompt's edit spec (mode/technicalFields) for the new version. */
  findByIdWithPrompt: (id: string) => prisma.replicateDesignGeneration.findUnique({ where: { id }, include: { prompt: true } }),

  /** Mirrors AiDesignerGenerationRepository.findLatestPendingEditPreview exactly — see that comment for why this exists. */
  findLatestPendingEditPreview: (projectId: string, parentImageId: string) =>
    prisma.replicateDesignGeneration.findFirst({
      where: { projectId, parentImageId, status: "SUCCESS", prompt: { promptType: "IMAGE_EDIT" }, images: { some: { decision: "PENDING" } } },
      orderBy: { createdAt: "desc" },
      include: { images: { orderBy: { createdAt: "asc" } } },
    }),
};

export const ReplicateDesignImageRepository = {
  createMany: (data: Prisma.ReplicateDesignImageUncheckedCreateInput[]) => prisma.replicateDesignImage.createMany({ data }),

  findByGenerationId: (generationId: string) =>
    prisma.replicateDesignImage.findMany({ where: { generationId }, orderBy: { createdAt: "asc" } }),

  findByProjectId: (projectId: string) => prisma.replicateDesignImage.findMany({ where: { projectId }, orderBy: { createdAt: "desc" } }),

  findWithProjectOwner: (id: string) => prisma.replicateDesignImage.findUnique({ where: { id }, include: { project: true } }),

  update: (id: string, data: Prisma.ReplicateDesignImageUncheckedUpdateInput) => prisma.replicateDesignImage.update({ where: { id }, data }),
};

export const ReplicateDesignVersionRepository = {
  create: (data: Prisma.ReplicateDesignVersionUncheckedCreateInput) => prisma.replicateDesignVersion.create({ data }),

  findByProjectId: (projectId: string) =>
    prisma.replicateDesignVersion.findMany({
      where: { projectId },
      orderBy: { versionNumber: "desc" },
      include: {
        currentImage: true,
        createdBy: { select: { id: true, fullName: true } },
        approvedBy: { select: { id: true, fullName: true } },
        aiPrompt: { select: { id: true, promptText: true } },
      },
    }),

  count: (projectId: string) => prisma.replicateDesignVersion.count({ where: { projectId } }),

  updateApprovalStatus: (
    id: string,
    data: { approvalStatus: "UNDER_REVIEW" | "APPROVED" | "REJECTED"; approvedByUserId?: string | null; approvedAt?: Date | null }
  ) => prisma.replicateDesignVersion.update({ where: { id }, data }),
};

export const ReplicateDesignTechPackRepository = {
  create: (data: Prisma.ReplicateDesignTechPackUncheckedCreateInput) => prisma.replicateDesignTechPack.create({ data }),

  markSuccess: (
    id: string,
    data: {
      garmentAnalysisJson: Prisma.InputJsonValue;
      designerNotes: string;
      suggestedAdditionalViews: string;
      pages: { pageNumber: number; pageTitle: string; promptText: string; imageAttachmentId: string | null }[];
    }
  ) =>
    prisma.replicateDesignTechPack.update({
      where: { id },
      data: {
        status: "SUCCESS",
        garmentAnalysisJson: data.garmentAnalysisJson,
        designerNotes: data.designerNotes,
        suggestedAdditionalViews: data.suggestedAdditionalViews,
        pages: { create: data.pages },
      },
      include: { pages: { orderBy: { pageNumber: "asc" } } },
    }),

  markFailed: (id: string, errorMessage: string) =>
    prisma.replicateDesignTechPack.update({ where: { id }, data: { status: "FAILED", errorMessage } }),

  /** Only the most recent attempt is ever surfaced in the UI — older attempts stay in the database for audit (append-only, same convention as every other run-log table in this module). */
  findLatestByProjectId: (projectId: string) =>
    prisma.replicateDesignTechPack.findFirst({
      where: { projectId },
      orderBy: { createdAt: "desc" },
      include: { pages: { orderBy: { pageNumber: "asc" } } },
    }),
};

