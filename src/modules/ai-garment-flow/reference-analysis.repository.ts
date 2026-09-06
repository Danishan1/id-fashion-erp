import { prisma } from "@/core/db/client";
import type { Prisma } from "@prisma/client";

export const AiGarmentReferenceAnalysisRepository = {
  findByProjectId: (projectId: string) =>
    prisma.aiGarmentReferenceAnalysis.findUnique({
      where: { projectId },
      include: {
        observations: true,
        approvedBy: { select: { id: true, fullName: true } },
      },
    }),

  /** Verify tenant ownership before any scoped action — same pattern as SampleVersionRepository.findWithRequestOwner. */
  findByIdWithProjectOwner: (id: string) =>
    prisma.aiGarmentReferenceAnalysis.findUnique({
      where: { id },
      include: { project: true, observations: true },
    }),

  /**
   * Fully replaces the analysis for a project: deletes every existing
   * observation row, upserts the header (analysisVersion always the
   * caller-computed next value), and inserts the new observation set — one
   * transaction, so a re-analysis can never leave a mix of old and new rows.
   */
  replaceForProject: (
    projectId: string,
    header: Prisma.AiGarmentReferenceAnalysisUncheckedCreateInput,
    observations: Omit<Prisma.AiGarmentReferenceObservationUncheckedCreateInput, "analysisId">[]
  ) =>
    prisma.$transaction(async (tx) => {
      const existing = await tx.aiGarmentReferenceAnalysis.findUnique({ where: { projectId } });
      if (existing) {
        await tx.aiGarmentReferenceObservation.deleteMany({ where: { analysisId: existing.id } });
      }

      const analysis = await tx.aiGarmentReferenceAnalysis.upsert({
        where: { projectId },
        create: header,
        update: header,
      });

      await tx.aiGarmentReferenceObservation.createMany({
        data: observations.map((o) => ({ ...o, analysisId: analysis.id })),
      });

      return analysis;
    }),

  /** Used when the reference image is replaced/deleted — the analysis row is kept for audit, only its status changes. */
  markStale: (projectId: string) =>
    prisma.aiGarmentReferenceAnalysis.updateMany({
      where: { projectId, status: { not: "STALE" } },
      data: { status: "STALE" },
    }),

  approveWithObservations: (analysisId: string, approvedByUserId: string) =>
    prisma.$transaction(async (tx) => {
      const approvedAt = new Date();
      const analysis = await tx.aiGarmentReferenceAnalysis.update({
        where: { id: analysisId },
        data: { status: "APPROVED", approvedByUserId, approvedAt },
      });
      await tx.aiGarmentReferenceObservation.updateMany({
        where: { analysisId },
        data: { approvedByUserId, approvedAt },
      });
      return analysis;
    }),

  updateStatus: (id: string, status: Prisma.AiGarmentReferenceAnalysisUncheckedUpdateInput["status"]) =>
    prisma.aiGarmentReferenceAnalysis.update({ where: { id }, data: { status } }),
};

export const AiGarmentReferenceObservationRepository = {
  /** Verify tenant ownership before any scoped edit — same pattern as SampleMaterialRepository.findWithRequestOwner. */
  findWithAnalysisOwner: (id: string) =>
    prisma.aiGarmentReferenceObservation.findUnique({
      where: { id },
      include: { analysis: { include: { project: true } } },
    }),

  update: (id: string, data: Prisma.AiGarmentReferenceObservationUncheckedUpdateInput) =>
    prisma.aiGarmentReferenceObservation.update({ where: { id }, data }),
};

export const AiGarmentReferenceAnalysisRunRepository = {
  /** A run still "IN_PROGRESS" more recently than `freshSince` blocks a new one — an older stuck row (e.g. from a crashed request) is treated as abandoned and does not block re-analysis forever. */
  findActiveSince: (projectId: string, freshSince: Date) =>
    prisma.aiGarmentReferenceAnalysisRun.findFirst({
      where: { projectId, status: "IN_PROGRESS", requestedAt: { gte: freshSince } },
    }),

  create: (data: Prisma.AiGarmentReferenceAnalysisRunUncheckedCreateInput) =>
    prisma.aiGarmentReferenceAnalysisRun.create({ data }),

  markSuccess: (id: string, analysisId: string) =>
    prisma.aiGarmentReferenceAnalysisRun.update({
      where: { id },
      data: { status: "SUCCESS", analysisId, completedAt: new Date() },
    }),

  markFailed: (id: string, errorCategory: string, errorMessage: string) =>
    prisma.aiGarmentReferenceAnalysisRun.update({
      where: { id },
      data: { status: "FAILED", errorCategory, errorMessage, completedAt: new Date() },
    }),

  findByProjectId: (projectId: string) =>
    prisma.aiGarmentReferenceAnalysisRun.findMany({ where: { projectId }, orderBy: { requestedAt: "desc" } }),
};
