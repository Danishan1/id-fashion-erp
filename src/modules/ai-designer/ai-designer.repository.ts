import { prisma } from "@/core/db/client";
import type { AiDesignerPromptType, Prisma } from "@prisma/client";

export const AiDesignerProjectRepository = {
  findMany: (where: Prisma.AiDesignerProjectWhereInput, args: Omit<Prisma.AiDesignerProjectFindManyArgs, "where">) =>
    prisma.aiDesignerProject.findMany({
      where,
      include: {
        fabricProduct: { select: { id: true, styleName: true, styleCode: true } },
        createdBy: { select: { id: true, fullName: true } },
        _count: { select: { versions: true } },
        currentVersion: { select: { versionNumber: true, currentImage: { select: { id: true, imageAttachmentId: true } } } },
      },
      ...args,
    }),

  count: (where: Prisma.AiDesignerProjectWhereInput) => prisma.aiDesignerProject.count({ where }),

  findAnyById: (companyId: string, id: string) => prisma.aiDesignerProject.findFirst({ where: { id, companyId } }),

  findByIdWithDetails: (companyId: string, id: string) =>
    prisma.aiDesignerProject.findFirst({
      where: { id, companyId },
      include: {
        company: { select: { name: true } },
        fabricProduct: { select: { id: true, styleName: true, styleCode: true, unitCost: true } },
        fabricSupplier: { select: { id: true, name: true } },
        createdBy: { select: { id: true, fullName: true } },
        currentVersion: { include: { currentImage: true } },
        versions: { orderBy: { versionNumber: "desc" }, include: { currentImage: true } },
        sketchAnalysis: { include: { observations: { orderBy: { featureKey: "asc" } } } },
        pieces: { orderBy: { pieceIndex: "asc" } },
      },
    }),

  create: (data: Prisma.AiDesignerProjectUncheckedCreateInput) => prisma.aiDesignerProject.create({ data }),

  update: (id: string, data: Prisma.AiDesignerProjectUncheckedUpdateInput) =>
    prisma.aiDesignerProject.update({ where: { id }, data }),
};

/**
 * Multi-piece Set support (2026-09-22) — full-replace-on-save, same contract
 * as RoleProductionStageAccess/SupplierMaterialCategory elsewhere in this
 * codebase: replaceAll(projectId, []) is a real state (clears every piece,
 * flipping the project back to behaving like it has none), not a no-op.
 */
export const AiDesignerProjectPieceRepository = {
  findByProjectId: (projectId: string) =>
    prisma.aiDesignerProjectPiece.findMany({ where: { projectId }, orderBy: { pieceIndex: "asc" } }),

  replaceAll: (companyId: string, projectId: string, pieces: { pieceLabel: string; productCategory: string | null; designNotes: string | null }[]) =>
    prisma.$transaction(async (tx) => {
      await tx.aiDesignerProjectPiece.deleteMany({ where: { projectId } });
      if (pieces.length === 0) return [];
      await tx.aiDesignerProjectPiece.createMany({
        data: pieces.map((p, i) => ({
          companyId,
          projectId,
          pieceIndex: i,
          pieceLabel: p.pieceLabel,
          productCategory: p.productCategory,
          designNotes: p.designNotes,
        })),
      });
      return tx.aiDesignerProjectPiece.findMany({ where: { projectId }, orderBy: { pieceIndex: "asc" } });
    }),
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
  findActiveSince: (projectId: string, promptType: AiDesignerPromptType, freshSince: Date) =>
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

  /**
   * A real, previously-missing "restore the AI Variations tab" query — the
   * Edit Design workspace's own `preview` state was only ever set by the
   * generation call that just completed, with nothing to repopulate it on a
   * fresh page load/re-navigation, so a genuinely successful edit could sit
   * PENDING in the database while the workspace showed an empty "Generate a
   * preview to see variations here" as if nothing had happened. Scoped to
   * IMAGE_EDIT (QUICK/TECHNICAL/AI_PROMPT/MASK all share this promptType —
   * Embellishments applies immediately with no preview step, and the
   * initial Generate Design call has no parentImageId at all), the
   * project's own CURRENT image (a stale preview from before an
   * intervening change is never resurrected — matches
   * applyEditVariation()'s own staleness guard), and only when at least one
   * image is still undecided.
   */
  findLatestPendingEditPreview: (projectId: string, parentImageId: string) =>
    prisma.aiDesignerGeneration.findFirst({
      where: { projectId, parentImageId, status: "SUCCESS", prompt: { promptType: "IMAGE_EDIT" }, images: { some: { decision: "PENDING" } } },
      orderBy: { createdAt: "desc" },
      include: { images: { orderBy: { createdAt: "asc" } } },
    }),

  /** New Design flow's colour variants — every successful generation of one prompt type, newest first. */
  findManyByProjectAndPromptType: (projectId: string, promptType: AiDesignerPromptType) =>
    prisma.aiDesignerGeneration.findMany({
      where: { projectId, status: "SUCCESS", prompt: { promptType } },
      orderBy: { createdAt: "desc" },
      include: {
        images: {
          orderBy: { createdAt: "asc" },
          include: { sketch: { select: { id: true, imageAttachmentId: true, decision: true, createdAt: true } } },
        },
      },
    }),
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

  /** The CAD sketch currently linked to a garment image (at most one — unique FK). */
  findSketchFor: (garmentImageId: string) => prisma.aiDesignerImage.findUnique({ where: { sketchForImageId: garmentImageId } }),

  /** Retires a garment's current sketch so a new one can take its (unique) link. */
  unlinkSketchFor: (garmentImageId: string) =>
    prisma.aiDesignerImage.updateMany({
      where: { sketchForImageId: garmentImageId },
      data: { sketchForImageId: null, decision: "REJECTED" },
    }),

  findByProjectAndAttachment: (projectId: string, imageAttachmentId: string) =>
    prisma.aiDesignerImage.findFirst({ where: { projectId, imageAttachmentId } }),
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
      pages: { pageNumber: number; pageTitle: string; imageAttachmentId: string | null; technicalFlatAttachmentId?: string | null }[];
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
    pages: { pageNumber: number; pageTitle: string; promptText: string | null; imageAttachmentId: string | null; technicalFlatAttachmentId?: string | null }[];
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

  /**
   * Real Revision History (2026-09-22) — walks parentTechPackId back from a
   * given tech pack to its root (a small, bounded chain — a handful of
   * revisions at most, no recursive CTE needed), returned oldest first. Pure
   * real data (revisionNumber/createdAt/createdBy/approvalStatus/approvedAt/
   * approvedBy) — zero AI involvement, matching the reference document's own
   * Revision History table.
   */
  findRevisionChain: async (techPackId: string) => {
    const chain: Prisma.AiDesignerTechPackGetPayload<{ include: { createdBy: { select: { fullName: true } }; approvedBy: { select: { fullName: true } } } }>[] = [];
    let currentId: string | null = techPackId;
    while (currentId) {
      const row: Prisma.AiDesignerTechPackGetPayload<{ include: { createdBy: { select: { fullName: true } }; approvedBy: { select: { fullName: true } } } }> | null =
        await prisma.aiDesignerTechPack.findUnique({
          where: { id: currentId },
          include: { createdBy: { select: { fullName: true } }, approvedBy: { select: { fullName: true } } },
        });
      if (!row) break;
      chain.push(row);
      currentId = row.parentTechPackId;
    }
    return chain.reverse();
  },
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

export const AiDesignerSketchAnalysisRepository = {
  findByProjectId: (projectId: string) =>
    prisma.aiDesignerSketchAnalysis.findUnique({
      where: { projectId },
      include: { observations: { orderBy: { featureKey: "asc" } } },
    }),

  /** Full replace on re-analysis — deletes any prior observations first, same "1:1, fully replaced" convention as ReplicateDesignDnaAnalysisRepository.upsertWithObservations. */
  upsertWithObservations: (
    projectId: string,
    data: Prisma.AiDesignerSketchAnalysisUncheckedCreateInput,
    observations: Omit<Prisma.AiDesignerSketchObservationUncheckedCreateInput, "analysisId">[]
  ) =>
    prisma.$transaction(async (tx) => {
      const existing = await tx.aiDesignerSketchAnalysis.findUnique({ where: { projectId } });
      if (existing) {
        await tx.aiDesignerSketchObservation.deleteMany({ where: { analysisId: existing.id } });
        await tx.aiDesignerSketchAnalysis.update({ where: { id: existing.id }, data });
        await tx.aiDesignerSketchObservation.createMany({
          data: observations.map((o) => ({ ...o, analysisId: existing.id })),
        });
        return tx.aiDesignerSketchAnalysis.findUniqueOrThrow({
          where: { id: existing.id },
          include: { observations: { orderBy: { featureKey: "asc" } } },
        });
      }
      const created = await tx.aiDesignerSketchAnalysis.create({ data });
      await tx.aiDesignerSketchObservation.createMany({
        data: observations.map((o) => ({ ...o, analysisId: created.id })),
      });
      return tx.aiDesignerSketchAnalysis.findUniqueOrThrow({
        where: { id: created.id },
        include: { observations: { orderBy: { featureKey: "asc" } } },
      });
    }),

  markStale: (projectId: string) =>
    prisma.aiDesignerSketchAnalysis.updateMany({ where: { projectId }, data: { status: "STALE" } }),

  update: (id: string, data: Prisma.AiDesignerSketchAnalysisUncheckedUpdateInput) =>
    prisma.aiDesignerSketchAnalysis.update({ where: { id }, data }),

  approveAllObservations: (analysisId: string, approvedByUserId: string) =>
    prisma.$transaction([
      prisma.aiDesignerSketchAnalysis.update({
        where: { id: analysisId },
        data: { status: "APPROVED", approvedByUserId, approvedAt: new Date() },
      }),
      prisma.aiDesignerSketchObservation.updateMany({
        where: { analysisId },
        data: { approvedByUserId, approvedAt: new Date() },
      }),
    ]),
};

export const AiDesignerSketchObservationRepository = {
  findByAnalysisId: (analysisId: string) =>
    prisma.aiDesignerSketchObservation.findMany({ where: { analysisId }, orderBy: { featureKey: "asc" } }),

  findWithAnalysisOwner: (id: string) =>
    prisma.aiDesignerSketchObservation.findUnique({ where: { id }, include: { analysis: true } }),

  update: (id: string, data: Prisma.AiDesignerSketchObservationUncheckedUpdateInput) =>
    prisma.aiDesignerSketchObservation.update({ where: { id }, data }),
};

export const AiDesignerSketchAnalysisRunRepository = {
  create: (data: Prisma.AiDesignerSketchAnalysisRunUncheckedCreateInput) => prisma.aiDesignerSketchAnalysisRun.create({ data }),

  markSuccess: (id: string, analysisId: string) =>
    prisma.aiDesignerSketchAnalysisRun.update({ where: { id }, data: { status: "SUCCESS", analysisId, completedAt: new Date() } }),

  markFailed: (id: string, errorCategory: string, errorMessage: string) =>
    prisma.aiDesignerSketchAnalysisRun.update({
      where: { id },
      data: { status: "FAILED", errorCategory, errorMessage, completedAt: new Date() },
    }),

  findActiveSince: (projectId: string, freshSince: Date) =>
    prisma.aiDesignerSketchAnalysisRun.findFirst({
      where: { projectId, status: "IN_PROGRESS", requestedAt: { gte: freshSince } },
    }),
};

/** PHOTO = Product Design on-model photos; CAD_FLAT = edit-page construction option sketches. */
export type OptionImageVariant = "PHOTO" | "CAD_FLAT";

export const AiDesignerOptionReferenceImageRepository = {
  findMany: (companyId: string, variant: OptionImageVariant = "PHOTO") =>
    prisma.aiDesignerOptionReferenceImage.findMany({ where: { companyId, variant } }),

  findByValue: (companyId: string, optionValue: string, variant: OptionImageVariant = "PHOTO") =>
    prisma.aiDesignerOptionReferenceImage.findFirst({ where: { companyId, variant, optionValue } }),

  /** Replaces the attachmentId if a row for this (companyId, variant, optionValue) already exists, else creates one. */
  upsert: (data: { companyId: string; optionValue: string; attachmentId: string; createdByUserId: string; variant?: OptionImageVariant }) => {
    const variant = data.variant ?? "PHOTO";
    return prisma.aiDesignerOptionReferenceImage.upsert({
      where: { companyId_variant_optionValue: { companyId: data.companyId, variant, optionValue: data.optionValue } },
      create: { ...data, variant },
      update: { attachmentId: data.attachmentId },
    });
  },

  deleteByValue: (companyId: string, optionValue: string, variant: OptionImageVariant = "PHOTO") =>
    prisma.aiDesignerOptionReferenceImage.delete({ where: { companyId_variant_optionValue: { companyId, variant, optionValue } } }),
};
