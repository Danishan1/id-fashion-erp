import { prisma } from "@/core/db/client";
import type { Prisma } from "@prisma/client";

export const AiGarmentTechnicalSpecificationRunRepository = {
  create: (data: Prisma.AiGarmentTechnicalSpecificationRunUncheckedCreateInput) =>
    prisma.aiGarmentTechnicalSpecificationRun.create({ data }),

  findActiveSince: (designDirectionId: string, freshSince: Date) =>
    prisma.aiGarmentTechnicalSpecificationRun.findFirst({
      where: { designDirectionId, status: "IN_PROGRESS", requestedAt: { gte: freshSince } },
    }),

  markSuccess: (id: string) =>
    prisma.aiGarmentTechnicalSpecificationRun.update({ where: { id }, data: { status: "SUCCESS", completedAt: new Date() } }),

  markFailed: (id: string, errorCategory: string, errorMessage: string) =>
    prisma.aiGarmentTechnicalSpecificationRun.update({
      where: { id },
      data: { status: "FAILED", errorCategory, errorMessage, completedAt: new Date() },
    }),
};

const SPECIFICATION_WITH_POINTS_INCLUDE = {
  points: {
    include: { values: { include: { size: { select: { id: true, code: true, name: true } } } } },
    orderBy: { sortOrder: "asc" },
  },
} satisfies Prisma.AiGarmentTechnicalSpecificationInclude;

export interface CreateMeasurementPointInput {
  measurementName: string;
  howToMeasure: string;
  toleranceText: string;
  sortOrder: number;
  values: { sizeId: string; aiValueText: string; approvedValueText: string }[];
}

export const AiGarmentTechnicalSpecificationRepository = {
  /**
   * Never edits/overwrites a prior attempt — always a brand-new
   * AiGarmentTechnicalSpecification row (plus its own fresh points/values),
   * matching Technical Flat's own "keep full history" discipline.
   */
  create: (header: Prisma.AiGarmentTechnicalSpecificationUncheckedCreateInput, points: CreateMeasurementPointInput[]) =>
    prisma.aiGarmentTechnicalSpecification.create({
      data: {
        ...header,
        points: {
          create: points.map((p) => ({
            measurementName: p.measurementName,
            howToMeasure: p.howToMeasure,
            toleranceText: p.toleranceText,
            sortOrder: p.sortOrder,
            values: { createMany: { data: p.values } },
          })),
        },
      },
      include: SPECIFICATION_WITH_POINTS_INCLUDE,
    }),

  findByDesignDirectionId: (designDirectionId: string) =>
    prisma.aiGarmentTechnicalSpecification.findMany({
      where: { designDirectionId },
      include: SPECIFICATION_WITH_POINTS_INCLUDE,
      orderBy: { createdAt: "desc" },
    }),

  /** Verify tenant ownership before any scoped action — same pattern as AiGarmentTechnicalFlatRepository.findWithProjectOwner. */
  findWithProjectOwner: (id: string) =>
    prisma.aiGarmentTechnicalSpecification.findUnique({
      where: { id },
      include: { project: { select: { id: true, companyId: true } } },
    }),

  /**
   * Marks exactly one specification APPROVED and clears any sibling in the
   * same design direction currently holding that decision, in one
   * transaction — same exclusivity idiom already proven by
   * AiGarmentTechnicalFlatRepository.approveExclusive.
   */
  approveExclusive: (designDirectionId: string, id: string) =>
    prisma.$transaction(async (tx) => {
      await tx.aiGarmentTechnicalSpecification.updateMany({ where: { designDirectionId, id: { not: id } }, data: { decision: "PENDING" } });
      return tx.aiGarmentTechnicalSpecification.update({ where: { id }, data: { decision: "APPROVED" }, include: SPECIFICATION_WITH_POINTS_INCLUDE });
    }),

  /**
   * Editing a value on an already-APPROVED specification pushes it back to
   * PENDING, requiring a fresh Approve — same "editing a previously
   * approved result forces re-review" discipline used throughout this
   * module (Reference/Fabric Analysis, Product Suitability).
   */
  revertToPending: (id: string) => prisma.aiGarmentTechnicalSpecification.update({ where: { id }, data: { decision: "PENDING" } }),
};

export const AiGarmentMeasurementValueRepository = {
  /** Verify tenant ownership before any scoped edit — same pattern as AiGarmentProductSuitabilityItemRepository.findWithSuitabilityOwner. */
  findWithSpecOwner: (id: string) =>
    prisma.aiGarmentMeasurementValue.findUnique({
      where: { id },
      include: {
        measurementPoint: { include: { technicalSpecification: { include: { project: { select: { id: true, companyId: true } } } } } },
      },
    }),

  update: (id: string, data: Prisma.AiGarmentMeasurementValueUncheckedUpdateInput) =>
    prisma.aiGarmentMeasurementValue.update({ where: { id }, data }),
};
