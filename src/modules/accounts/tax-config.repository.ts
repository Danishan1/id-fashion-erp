import { prisma } from "@/core/db/client";
import type { Prisma } from "@prisma/client";

export const TaxTypeRepository = {
  findMany: (where: Prisma.TaxTypeWhereInput) => prisma.taxType.findMany({ where, orderBy: { code: "asc" } }),
  findAnyById: (companyId: string, id: string) => prisma.taxType.findFirst({ where: { id, companyId } }),
  findByCode: (companyId: string, code: string) => prisma.taxType.findFirst({ where: { companyId, code } }),
  create: (data: Prisma.TaxTypeUncheckedCreateInput) => prisma.taxType.create({ data }),
  update: (id: string, data: Prisma.TaxTypeUncheckedUpdateInput) => prisma.taxType.update({ where: { id }, data }),
  countRates: (taxTypeId: string) => prisma.taxRate.count({ where: { taxTypeId } }),
};

export const TaxRateRepository = {
  findMany: (where: Prisma.TaxRateWhereInput) =>
    prisma.taxRate.findMany({ where, include: { taxType: { select: { id: true, name: true } } }, orderBy: { effectiveFrom: "desc" } }),
  findAnyById: (companyId: string, id: string) => prisma.taxRate.findFirst({ where: { id, companyId } }),
  /** Active rates for the same taxTypeId, for overlap validation at create/update time. */
  findActiveByTaxType: (companyId: string, taxTypeId: string, excludeId?: string) =>
    prisma.taxRate.findMany({
      where: { companyId, taxTypeId, isActive: true, ...(excludeId ? { id: { not: excludeId } } : {}) },
    }),
  create: (data: Prisma.TaxRateUncheckedCreateInput) => prisma.taxRate.create({ data }),
  update: (id: string, data: Prisma.TaxRateUncheckedUpdateInput) => prisma.taxRate.update({ where: { id }, data }),
};
