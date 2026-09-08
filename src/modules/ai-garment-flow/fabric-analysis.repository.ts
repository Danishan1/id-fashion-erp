import { prisma } from "@/core/db/client";
import type { Prisma } from "@prisma/client";

export const AiGarmentFabricAnalysisRepository = {
  findByProjectId: (projectId: string) =>
    prisma.aiGarmentFabricAnalysis.findUnique({
      where: { projectId },
      include: {
        observations: true,
        approvedBy: { select: { id: true, fullName: true } },
      },
    }),

  /** Verify tenant ownership before any scoped action — same pattern as SampleVersionRepository.findWithRequestOwner. */
  findByIdWithProjectOwner: (id: string) =>
    prisma.aiGarmentFabricAnalysis.findUnique({
      where: { id },
      include: { project: true, observations: true },
    }),

  /**
   * Fully replaces the analysis for a project: deletes every existing
   * observation row, upserts the header (analysisVersion always the
   * caller-computed next value), and inserts the new observation set — one
   * transaction, so a re-analysis can never leave a mix of old and new rows.
   * Mirrors AiGarmentReferenceAnalysisRepository.replaceForProject exactly.
   */
  replaceForProject: (
    projectId: string,
    header: Prisma.AiGarmentFabricAnalysisUncheckedCreateInput,
    observations: Omit<Prisma.AiGarmentFabricObservationUncheckedCreateInput, "analysisId">[]
  ) =>
    prisma.$transaction(async (tx) => {
      const existing = await tx.aiGarmentFabricAnalysis.findUnique({ where: { projectId } });
      if (existing) {
        await tx.aiGarmentFabricObservation.deleteMany({ where: { analysisId: existing.id } });
      }

      const analysis = await tx.aiGarmentFabricAnalysis.upsert({
        where: { projectId },
        create: header,
        update: header,
      });

      await tx.aiGarmentFabricObservation.createMany({
        data: observations.map((o) => ({ ...o, analysisId: analysis.id })),
      });

      return analysis;
    }),

  /** Used when the fabric swatch image is replaced/deleted — the analysis row is kept for audit, only its status changes. */
  markStale: (projectId: string) =>
    prisma.aiGarmentFabricAnalysis.updateMany({
      where: { projectId, status: { not: "STALE" } },
      data: { status: "STALE" },
    }),

  approveWithObservations: (analysisId: string, approvedByUserId: string) =>
    prisma.$transaction(async (tx) => {
      const approvedAt = new Date();
      const analysis = await tx.aiGarmentFabricAnalysis.update({
        where: { id: analysisId },
        data: { status: "APPROVED", approvedByUserId, approvedAt },
      });
      await tx.aiGarmentFabricObservation.updateMany({
        where: { analysisId },
        data: { approvedByUserId, approvedAt },
      });
      return analysis;
    }),

  updateStatus: (id: string, status: Prisma.AiGarmentFabricAnalysisUncheckedUpdateInput["status"]) =>
    prisma.aiGarmentFabricAnalysis.update({ where: { id }, data: { status } }),
};

export const AiGarmentFabricObservationRepository = {
  /** Verify tenant ownership before any scoped edit — same pattern as SampleMaterialRepository.findWithRequestOwner. */
  findWithAnalysisOwner: (id: string) =>
    prisma.aiGarmentFabricObservation.findUnique({
      where: { id },
      include: { analysis: { include: { project: true } } },
    }),

  update: (id: string, data: Prisma.AiGarmentFabricObservationUncheckedUpdateInput) =>
    prisma.aiGarmentFabricObservation.update({ where: { id }, data }),
};

export const AiGarmentFabricAnalysisRunRepository = {
  /** A run still "IN_PROGRESS" more recently than `freshSince` blocks a new one — an older stuck row (e.g. from a crashed request) is treated as abandoned and does not block re-analysis forever. */
  findActiveSince: (projectId: string, freshSince: Date) =>
    prisma.aiGarmentFabricAnalysisRun.findFirst({
      where: { projectId, status: "IN_PROGRESS", requestedAt: { gte: freshSince } },
    }),

  create: (data: Prisma.AiGarmentFabricAnalysisRunUncheckedCreateInput) => prisma.aiGarmentFabricAnalysisRun.create({ data }),

  markSuccess: (id: string, analysisId: string) =>
    prisma.aiGarmentFabricAnalysisRun.update({
      where: { id },
      data: { status: "SUCCESS", analysisId, completedAt: new Date() },
    }),

  markFailed: (id: string, errorCategory: string, errorMessage: string) =>
    prisma.aiGarmentFabricAnalysisRun.update({
      where: { id },
      data: { status: "FAILED", errorCategory, errorMessage, completedAt: new Date() },
    }),

  findByProjectId: (projectId: string) =>
    prisma.aiGarmentFabricAnalysisRun.findMany({ where: { projectId }, orderBy: { requestedAt: "desc" } }),
};
