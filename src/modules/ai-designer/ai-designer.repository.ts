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

  /** Used by applyEditVariation() to verify a preview's own parentImageId still matches the project's real current image, and to recover the originating prompt's edit spec (mode/technicalFields) for the new version. */
  findByIdWithPrompt: (id: string) => prisma.aiDesignerGeneration.findUnique({ where: { id }, include: { prompt: true } }),
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
      include: {
        currentImage: true,
        createdBy: { select: { id: true, fullName: true } },
        approvedBy: { select: { id: true, fullName: true } },
        aiPrompt: { select: { id: true, promptText: true } },
      },
    }),

  count: (projectId: string) => prisma.aiDesignerVersion.count({ where: { projectId } }),

  updateApprovalStatus: (
    id: string,
    data: { approvalStatus: "UNDER_REVIEW" | "APPROVED" | "REJECTED"; approvedByUserId?: string | null; approvedAt?: Date | null }
  ) => prisma.aiDesignerVersion.update({ where: { id }, data }),
};

export const AiDesignerTechPackRepository = {
  create: (data: Prisma.AiDesignerTechPackUncheckedCreateInput) => prisma.aiDesignerTechPack.create({ data }),

  markSuccess: (
    id: string,
    data: {
      garmentAnalysisJson: Prisma.InputJsonValue;
      designerNotes: string;
      suggestedAdditionalViews: string;
      pages: { pageNumber: number; pageTitle: string; imageAttachmentId: string | null }[];
    }
  ) =>
    prisma.aiDesignerTechPack.update({
      where: { id },
      data: {
        status: "SUCCESS",
        garmentAnalysisJson: data.garmentAnalysisJson,
        // Frozen at the same moment as garmentAnalysisJson itself -- the two
        // are byte-identical only right here; every subsequent edit only
        // ever touches garmentAnalysisJson, never this column, so it always
        // reflects what the AI originally said (see updateTechPackField's
        // own "Revert to AI-generated" support in ai-designer.service.ts).
        originalGarmentAnalysisJson: data.garmentAnalysisJson,
        designerNotes: data.designerNotes,
        suggestedAdditionalViews: data.suggestedAdditionalViews,
        pages: { create: data.pages },
      },
      include: { pages: { orderBy: { pageNumber: "asc" } } },
    }),

  markFailed: (id: string, errorMessage: string) =>
    prisma.aiDesignerTechPack.update({ where: { id }, data: { status: "FAILED", errorMessage } }),

  /** Only the most recent attempt/revision is ever surfaced in the UI — older ones stay in the database for audit (append-only, same convention as every other AI Designer run-log table). A revision is just another row of this same model, so this needs no query change to correctly surface it. */
  findLatestByProjectId: (projectId: string) =>
    prisma.aiDesignerTechPack.findFirst({
      where: { projectId },
      orderBy: { createdAt: "desc" },
      include: { pages: { orderBy: { pageNumber: "asc" } } },
    }),

  /** Company-scoped single lookup, for the field-edit/approve/revert actions, which all operate on one already-known tech pack id. */
  findByIdScoped: (companyId: string, id: string) =>
    prisma.aiDesignerTechPack.findFirst({
      where: { id, companyId },
      include: { pages: { orderBy: { pageNumber: "asc" } } },
    }),

  update: (id: string, data: Prisma.AiDesignerTechPackUncheckedUpdateInput) =>
    prisma.aiDesignerTechPack.update({
      where: { id },
      data,
      include: { pages: { orderBy: { pageNumber: "asc" } } },
    }),

  /**
   * Forks a brand-new row from an already-APPROVED tech pack, preserving the
   * parent completely untouched -- see the model's own doc comment in
   * schema.prisma. `pages` are copied verbatim (same real imageAttachmentIds,
   * no re-upload).
   */
  createRevision: (parent: {
    id: string;
    companyId: string;
    projectId: string;
    garmentAnalysisJson: Prisma.InputJsonValue;
    originalGarmentAnalysisJson: Prisma.InputJsonValue;
    designerNotes: string | null;
    suggestedAdditionalViews: string | null;
    revisionNumber: number;
    createdByUserId: string;
    pages: { pageNumber: number; pageTitle: string; promptText: string | null; imageAttachmentId: string | null }[];
  }) =>
    prisma.aiDesignerTechPack.create({
      data: {
        companyId: parent.companyId,
        projectId: parent.projectId,
        status: "SUCCESS",
        approvalStatus: "DRAFT",
        garmentAnalysisJson: parent.garmentAnalysisJson,
        originalGarmentAnalysisJson: parent.originalGarmentAnalysisJson,
        designerNotes: parent.designerNotes,
        suggestedAdditionalViews: parent.suggestedAdditionalViews,
        revisionNumber: parent.revisionNumber + 1,
        parentTechPackId: parent.id,
        createdByUserId: parent.createdByUserId,
        pages: { create: parent.pages },
      },
      include: { pages: { orderBy: { pageNumber: "asc" } } },
    }),
};

export const AiDesignerProductDesignAttributeRepository = {
  findMany: (companyId: string) =>
    prisma.aiDesignerProductDesignAttribute.findMany({
      where: { companyId },
      orderBy: [{ categoryName: "asc" }, { sortOrder: "asc" }],
    }),

  findActiveByCategory: (companyId: string, categoryName: string) =>
    prisma.aiDesignerProductDesignAttribute.findMany({
      where: { companyId, categoryName, isActive: true },
      orderBy: { sortOrder: "asc" },
    }),

  findAnyById: (companyId: string, id: string) =>
    prisma.aiDesignerProductDesignAttribute.findFirst({ where: { id, companyId } }),

  findByKey: (companyId: string, categoryName: string, attributeKey: string) =>
    prisma.aiDesignerProductDesignAttribute.findFirst({ where: { companyId, categoryName, attributeKey } }),

  create: (data: Prisma.AiDesignerProductDesignAttributeUncheckedCreateInput) =>
    prisma.aiDesignerProductDesignAttribute.create({ data }),

  update: (id: string, data: Prisma.AiDesignerProductDesignAttributeUncheckedUpdateInput) =>
    prisma.aiDesignerProductDesignAttribute.update({ where: { id }, data }),
};

export const AiDesignerOptionReferenceImageRepository = {
  findMany: (companyId: string) => prisma.aiDesignerOptionReferenceImage.findMany({ where: { companyId } }),

  findByValue: (companyId: string, optionValue: string) =>
    prisma.aiDesignerOptionReferenceImage.findFirst({ where: { companyId, optionValue } }),

  /** Replaces the attachmentId if a row for this (companyId, optionValue) already exists, else creates one. */
  upsert: (data: { companyId: string; optionValue: string; attachmentId: string; createdByUserId: string }) =>
    prisma.aiDesignerOptionReferenceImage.upsert({
      where: { companyId_optionValue: { companyId: data.companyId, optionValue: data.optionValue } },
      create: data,
      update: { attachmentId: data.attachmentId },
    }),

  deleteByValue: (companyId: string, optionValue: string) =>
    prisma.aiDesignerOptionReferenceImage.delete({ where: { companyId_optionValue: { companyId, optionValue } } }),
};
