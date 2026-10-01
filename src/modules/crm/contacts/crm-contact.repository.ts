import type { Prisma } from "@prisma/client";
import { prisma } from "@/core/db/client";
import type { CrmDb } from "../core/crm-db";

const CONTACT_SELECT = {
  id: true,
  fullName: true,
  email: true,
  phone: true,
  mobile: true,
  emailKeys: true,
  phoneKeys: true,
  crmCompanyId: true,

  ownerUserId: true,
  createdByUserId: true,
  crmCompany: { select: { id: true, name: true } },
} satisfies Prisma.CrmContactSelect;

export const CrmContactRepository = {
  findById(where: Prisma.CrmContactWhereInput, db: CrmDb = prisma) {
    return db.crmContact.findFirst({ where, select: CONTACT_SELECT });
  },
  findMatches(companyId: string, emailKeys: string[], phoneKeys: string[], take = 5) {
    if (!emailKeys.length && !phoneKeys.length) return Promise.resolve([]);
    return prisma.crmContact.findMany({
      where: {
        companyId,
        archivedAt: null,
        OR: [...(emailKeys.length ? [{ emailKeys: { hasSome: emailKeys } }] : []), ...(phoneKeys.length ? [{ phoneKeys: { hasSome: phoneKeys } }] : [])],
      },
      select: CONTACT_SELECT,
      take,
    });
  },
  search(where: Prisma.CrmContactWhereInput, take = 20) {
    return prisma.crmContact.findMany({ where, select: CONTACT_SELECT, orderBy: { fullName: "asc" }, take });
  },
  create(data: Prisma.CrmContactUncheckedCreateInput, db: CrmDb) {
    return db.crmContact.create({ data, select: CONTACT_SELECT });
  },
  update(id: string, data: Prisma.CrmContactUncheckedUpdateInput, db: CrmDb) {
    return db.crmContact.update({ where: { id }, data, select: CONTACT_SELECT });
  },
};
export type CrmContactSummary = Prisma.CrmContactGetPayload<{ select: typeof CONTACT_SELECT }>;
