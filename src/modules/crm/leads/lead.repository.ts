import type { CrmEntityType, Prisma } from "@prisma/client";
import { prisma } from "@/core/db/client";
import type { CrmDb } from "../core/crm-db";

const USER_SELECT = { id: true, fullName: true, status: true } satisfies Prisma.UserSelect;

export const LEAD_LIST_SELECT = {
  id: true,
  leadNumber: true,
  firstName: true,
  lastName: true,
  fullName: true,
  companyName: true,
  email: true,
  phone: true,
  mobile: true,
  whatsapp: true,
  score: true,
  temperature: true,
  estimatedValue: true,
  currencyCode: true,
  lastContactedAt: true,
  nextFollowUpAt: true,
  createdAt: true,
  updatedAt: true,
  archivedAt: true,
  convertedAt: true,
  ownerUserId: true,
  createdByUserId: true,
  version: true,
  status: { select: { id: true, name: true, kind: true, color: true } },
  source: { select: { id: true, name: true, key: true } },
  owner: { select: USER_SELECT },
  crmCompany: { select: { id: true, name: true } },
} satisfies Prisma.CrmLeadSelect;

export const LEAD_DETAIL_INCLUDE = {
  status: { select: { id: true, name: true, kind: true, color: true, key: true } },
  source: { select: { id: true, name: true, key: true } },
  owner: { select: USER_SELECT },
  createdBy: { select: { id: true, fullName: true } },
  crmCompany: { select: { id: true, name: true, customerId: true } },
  crmContact: { select: { id: true, fullName: true, email: true, phone: true } },
  convertedOpportunity: { select: { id: true, name: true, opportunityNumber: true, status: true } },
  opportunities: {
    select: { id: true, name: true, opportunityNumber: true, status: true, amount: true, currencyCode: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  },
} satisfies Prisma.CrmLeadInclude;

export type LeadListRow = Prisma.CrmLeadGetPayload<{ select: typeof LEAD_LIST_SELECT }>;
export type LeadDetailRow = Prisma.CrmLeadGetPayload<{ include: typeof LEAD_DETAIL_INCLUDE }>;

export const LeadRepository = {
  findMany(where: Prisma.CrmLeadWhereInput, orderBy: Prisma.CrmLeadOrderByWithRelationInput[], skip: number, take: number) {
    return prisma.crmLead.findMany({ where, orderBy, skip, take, select: LEAD_LIST_SELECT });
  },
  count(where: Prisma.CrmLeadWhereInput) {
    return prisma.crmLead.count({ where });
  },
  findDetail(where: Prisma.CrmLeadWhereInput, db: CrmDb = prisma) {
    return db.crmLead.findFirst({ where, include: LEAD_DETAIL_INCLUDE });
  },
  findRaw(where: Prisma.CrmLeadWhereInput, db: CrmDb = prisma) {
    return db.crmLead.findFirst({ where });
  },
  findManyRaw(where: Prisma.CrmLeadWhereInput, db: CrmDb = prisma) {
    return db.crmLead.findMany({ where });
  },
  /** Leads sharing any email/phone key (duplicate detection). */
  findMatches(companyId: string, emailKeys: string[], phoneKeys: string[], excludeId: string | undefined, take = 10) {
    if (!emailKeys.length && !phoneKeys.length) return Promise.resolve([]);
    return prisma.crmLead.findMany({
      where: {
        companyId,
        ...(excludeId ? { id: { not: excludeId } } : {}),
        OR: [...(emailKeys.length ? [{ emailKeys: { hasSome: emailKeys } }] : []), ...(phoneKeys.length ? [{ phoneKeys: { hasSome: phoneKeys } }] : [])],
      },
      select: {
        id: true,
        leadNumber: true,
        fullName: true,
        companyName: true,
        email: true,
        phone: true,
        mobile: true,
        whatsapp: true,
        emailKeys: true,
        phoneKeys: true,
        archivedAt: true,
        status: { select: { name: true } },
        owner: { select: { fullName: true } },
      },
      orderBy: { createdAt: "desc" },
      take,
    });
  },
  create(data: Prisma.CrmLeadUncheckedCreateInput, db: CrmDb) {
    return db.crmLead.create({ data });
  },
  /** Version-checked update: returns 0 when someone else saved first. */
  updateVersioned(id: string, version: number, data: Prisma.CrmLeadUncheckedUpdateManyInput, db: CrmDb) {
    return db.crmLead.updateMany({ where: { id, version }, data: { ...data, version: { increment: 1 } } });
  },
  update(id: string, data: Prisma.CrmLeadUncheckedUpdateInput, db: CrmDb) {
    return db.crmLead.update({ where: { id }, data: { ...data, version: { increment: 1 } } });
  },
  entityIdsWithAnyTag(companyId: string, entityType: CrmEntityType, tagIds: string[]) {
    return prisma.crmEntityTag.findMany({ where: { companyId, entityType, tagId: { in: tagIds } }, select: { entityId: true }, distinct: ["entityId"] });
  },
  activeUserInCompany(companyId: string, userId: string) {
    return prisma.user.findFirst({ where: { id: userId, companyId, status: "ACTIVE" }, select: { id: true, fullName: true } });
  },
  userNames(ids: string[]) {
    if (!ids.length) return Promise.resolve([]);
    return prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true } });
  },
  companyBaseCurrency(companyId: string) {
    return prisma.company.findUnique({ where: { id: companyId }, select: { baseCurrencyCode: true } });
  },
};
