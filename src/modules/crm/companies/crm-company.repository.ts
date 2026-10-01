import type { Prisma } from "@prisma/client";
import { prisma } from "@/core/db/client";
import type { CrmDb } from "../core/crm-db";

const COMPANY_SELECT = { id: true, name: true, email: true, phone: true, city: true, country: true, customerId: true, ownerUserId: true, createdByUserId: true } satisfies Prisma.CrmCompanySelect;

export const CrmCompanyRepository = {
  findById(where: Prisma.CrmCompanyWhereInput, db: CrmDb = prisma) {
    return db.crmCompany.findFirst({ where, select: COMPANY_SELECT });
  },
  findByNameKey(companyId: string, nameKey: string, take = 5) {
    return prisma.crmCompany.findMany({ where: { companyId, nameKey, archivedAt: null }, select: COMPANY_SELECT, take });
  },
  search(where: Prisma.CrmCompanyWhereInput, take = 20) {
    return prisma.crmCompany.findMany({ where, select: COMPANY_SELECT, orderBy: { name: "asc" }, take });
  },
  create(data: Prisma.CrmCompanyUncheckedCreateInput, db: CrmDb) {
    return db.crmCompany.create({ data, select: COMPANY_SELECT });
  },
};
export type CrmCompanySummary = Prisma.CrmCompanyGetPayload<{ select: typeof COMPANY_SELECT }>;
