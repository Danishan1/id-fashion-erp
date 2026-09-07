import { prisma } from "@/core/db/client";
import type { Prisma } from "@prisma/client";

export const AiGarmentTechnicalFlatRunRepository = {
  create: (data: Prisma.AiGarmentTechnicalFlatRunUncheckedCreateInput) => prisma.aiGarmentTechnicalFlatRun.create({ data }),

  findActiveSince: (designDirectionId: string, freshSince: Date) =>
    prisma.aiGarmentTechnicalFlatRun.findFirst({
      where: { designDirectionId, status: "IN_PROGRESS", requestedAt: { gte: freshSince } },
    }),

  markSuccess: (id: string) =>
    prisma.aiGarmentTechnicalFlatRun.update({ where: { id }, data: { status: "SUCCESS", completedAt: new Date() } }),

  markFailed: (id: string, errorCategory: string, errorMessage: string) =>
    prisma.aiGarmentTechnicalFlatRun.update({
      where: { id },
      data: { status: "FAILED", errorCategory, errorMessage, completedAt: new Date() },
    }),
};

export const AiGarmentTechnicalFlatRepository = {
  create: (data: Prisma.AiGarmentTechnicalFlatUncheckedCreateInput) => prisma.aiGarmentTechnicalFlat.create({ data }),

  findByDesignDirectionId: (designDirectionId: string) =>
    prisma.aiGarmentTechnicalFlat.findMany({ where: { designDirectionId }, orderBy: { createdAt: "desc" } }),

  /** Verify tenant ownership before any scoped action — same pattern as SampleMaterialRepository.findWithRequestOwner. */
  findWithProjectOwner: (id: string) =>
    prisma.aiGarmentTechnicalFlat.findUnique({ where: { id }, include: { project: { select: { id: true, companyId: true } } } }),

  /**
   * Marks exactly one technical flat APPROVED and clears any sibling in the
   * same design direction currently holding that decision, in one
   * transaction — same exclusivity idiom already proven by
   * AiGarmentFabricApplicationRepository.approveExclusive.
   */
  approveExclusive: (designDirectionId: string, id: string) =>
    prisma.$transaction(async (tx) => {
      await tx.aiGarmentTechnicalFlat.updateMany({ where: { designDirectionId, id: { not: id } }, data: { decision: "PENDING" } });
      return tx.aiGarmentTechnicalFlat.update({ where: { id }, data: { decision: "APPROVED" } });
    }),
};
