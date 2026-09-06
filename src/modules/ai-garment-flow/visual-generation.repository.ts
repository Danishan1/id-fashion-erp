import { prisma } from "@/core/db/client";
import type { Prisma } from "@prisma/client";

export const AiGarmentImageGenerationRunRepository = {
  create: (data: Prisma.AiGarmentImageGenerationRunUncheckedCreateInput) =>
    prisma.aiGarmentImageGenerationRun.create({ data }),

  /** A run still "IN_PROGRESS" more recently than `freshSince` blocks a new one for the same direction — an older stuck row (e.g. a crashed request) is treated as abandoned, same pattern as Process 1/2's own run repositories. */
  findActiveSince: (designDirectionId: string, freshSince: Date) =>
    prisma.aiGarmentImageGenerationRun.findFirst({
      where: { designDirectionId, status: "IN_PROGRESS", requestedAt: { gte: freshSince } },
    }),

  markSuccess: (id: string) =>
    prisma.aiGarmentImageGenerationRun.update({ where: { id }, data: { status: "SUCCESS", completedAt: new Date() } }),

  markFailed: (id: string, errorCategory: string, errorMessage: string) =>
    prisma.aiGarmentImageGenerationRun.update({
      where: { id },
      data: { status: "FAILED", errorCategory, errorMessage, completedAt: new Date() },
    }),

  findById: (id: string) => prisma.aiGarmentImageGenerationRun.findUnique({ where: { id } }),
};

export const AiGarmentGeneratedImageRepository = {
  createMany: (rows: Prisma.AiGarmentGeneratedImageUncheckedCreateInput[]) =>
    prisma.aiGarmentGeneratedImage.createMany({ data: rows }),

  findByDesignDirectionId: (designDirectionId: string) =>
    prisma.aiGarmentGeneratedImage.findMany({
      where: { designDirectionId },
      orderBy: { createdAt: "desc" },
      include: { generationRun: { select: { id: true, parentGeneratedImageId: true, requestedImageCount: true } } },
    }),

  /** Verify tenant ownership before any scoped action — same pattern as SampleMaterialRepository.findWithRequestOwner, traversing all the way to the project so callers can read companyId and, once graduated, the linked Style Master. */
  findWithProjectOwner: (id: string) =>
    prisma.aiGarmentGeneratedImage.findUnique({
      where: { id },
      include: {
        project: { select: { id: true, companyId: true, productId: true, product: { select: { id: true, styleCode: true, styleName: true } } } },
        designDirection: true,
        generationRun: true,
      },
    }),

  update: (id: string, data: Prisma.AiGarmentGeneratedImageUncheckedUpdateInput) =>
    prisma.aiGarmentGeneratedImage.update({ where: { id }, data }),

  findById: (id: string) => prisma.aiGarmentGeneratedImage.findUnique({ where: { id } }),
};
