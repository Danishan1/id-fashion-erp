import { prisma } from "@/core/db/client";
import type { Prisma } from "@prisma/client";

export const AiGarmentProjectRepository = {
  findMany: (where: Prisma.AiGarmentProjectWhereInput, args: Omit<Prisma.AiGarmentProjectFindManyArgs, "where">) =>
    prisma.aiGarmentProject.findMany({
      where,
      include: {
        customer: { select: { id: true, name: true } },
        buyer: { select: { id: true, name: true } },
        brand: { select: { id: true, name: true } },
        season: { select: { id: true, name: true } },
        category: { select: { id: true, name: true } },
        createdBy: { select: { id: true, fullName: true } },
      },
      ...args,
    }),

  count: (where: Prisma.AiGarmentProjectWhereInput) => prisma.aiGarmentProject.count({ where }),

  findByIdWithDetails: (companyId: string, id: string) =>
    prisma.aiGarmentProject.findFirst({
      where: { id, companyId },
      include: {
        // Narrow `select`s, not `customer: true` — same fix and rationale as
        // sales-order.repository.ts / buyer-enquiry.repository.ts.
        customer: { select: { id: true, name: true, code: true, defaultCurrencyCode: true } },
        buyer: { select: { id: true, name: true } },
        brand: { select: { id: true, name: true } },
        season: { select: { id: true, name: true } },
        category: { select: { id: true, name: true } },
        product: { select: { id: true, styleCode: true, styleName: true } },
        sampleRequest: { select: { id: true, requestNumber: true, status: true } },
        createdBy: { select: { id: true, fullName: true } },
        fabricDetail: {
          include: {
            gsm: { select: { id: true, name: true } },
            dye: { select: { id: true, name: true, pantone: true } },
            weaveType: { select: { id: true, name: true } },
            width: { select: { id: true, name: true } },
            composition: { select: { id: true, name: true } },
            color: { select: { id: true, name: true, hexValue: true } },
            supplier: { select: { id: true, name: true } },
          },
        },
        designOptions: { orderBy: { createdAt: "asc" } },
      },
    }),

  findAnyById: (companyId: string, id: string) => prisma.aiGarmentProject.findFirst({ where: { id, companyId } }),

  create: (data: Prisma.AiGarmentProjectUncheckedCreateInput) => prisma.aiGarmentProject.create({ data }),

  update: (id: string, data: Prisma.AiGarmentProjectUncheckedUpdateInput) =>
    prisma.aiGarmentProject.update({ where: { id }, data }),

  /**
   * Guarded single-shot graduation write — the `where` clause re-asserts
   * "still ungraduated" so a concurrent double-conversion can't both
   * succeed, same idiom as BuyerEnquiryLineRepository.convertGuarded.
   */
  setProductIdGuarded: (id: string, productId: string) =>
    prisma.aiGarmentProject.updateMany({ where: { id, productId: null }, data: { productId } }),

  setSampleRequestIdGuarded: (id: string, sampleRequestId: string) =>
    prisma.aiGarmentProject.updateMany({ where: { id, sampleRequestId: null }, data: { sampleRequestId } }),
};

export const AiGarmentFabricDetailRepository = {
  findByProjectId: (projectId: string) => prisma.aiGarmentFabricDetail.findUnique({ where: { projectId } }),

  upsert: (
    projectId: string,
    data: Omit<Prisma.AiGarmentFabricDetailUncheckedCreateInput, "id" | "projectId">
  ) =>
    prisma.aiGarmentFabricDetail.upsert({
      where: { projectId },
      create: { ...data, projectId },
      update: data,
    }),
};

export const AiGarmentDesignOptionRepository = {
  findByProjectId: (projectId: string) =>
    prisma.aiGarmentDesignOption.findMany({ where: { projectId }, orderBy: { createdAt: "asc" } }),

  /** Verify tenant ownership before any scoped action — same pattern as SampleMaterialRepository.findWithRequestOwner. */
  findWithProjectOwner: (id: string) =>
    prisma.aiGarmentDesignOption.findUnique({ where: { id }, include: { project: true } }),

  create: (data: Prisma.AiGarmentDesignOptionUncheckedCreateInput) => prisma.aiGarmentDesignOption.create({ data }),

  update: (id: string, data: Prisma.AiGarmentDesignOptionUncheckedUpdateInput) =>
    prisma.aiGarmentDesignOption.update({ where: { id }, data }),

  /**
   * Marks exactly one design option selected and clears every sibling in the
   * same project, in one transaction — a partial failure can never leave two
   * rows both marked selected.
   */
  selectExclusive: (projectId: string, id: string) =>
    prisma.$transaction(async (tx) => {
      await tx.aiGarmentDesignOption.updateMany({ where: { projectId, id: { not: id } }, data: { isSelected: false } });
      return tx.aiGarmentDesignOption.update({ where: { id }, data: { isSelected: true } });
    }),
};
