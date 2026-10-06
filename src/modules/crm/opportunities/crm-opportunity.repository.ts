import type { CrmEntityType, Prisma } from "@prisma/client";
import { prisma } from "@/core/db/client";
import type { CrmDb } from "../core/crm-db";

const OPPORTUNITY_SELECT = {
  id: true,
  opportunityNumber: true,
  name: true,
  status: true,
  amount: true,
  currencyCode: true,
  expectedCloseDate: true,
  leadId: true,
  crmContactId: true,
  crmCompanyId: true,
  ownerUserId: true,
  createdByUserId: true,
  createdAt: true,
} satisfies Prisma.CrmOpportunitySelect;

const USER_SELECT = { id: true, fullName: true, status: true } satisfies Prisma.UserSelect;

export const OPPORTUNITY_LIST_SELECT = {
  id: true,
  opportunityNumber: true,
  name: true,
  status: true,
  amount: true,
  currencyCode: true,
  probability: true,
  expectedCloseDate: true,
  closedAt: true,
  lastActivityAt: true,
  createdAt: true,
  updatedAt: true,
  archivedAt: true,
  version: true,
  ownerUserId: true,
  leadId: true,
  crmCompanyId: true,
  crmContactId: true,
  pipelineId: true,
  stageId: true,
  owner: { select: USER_SELECT },
  crmCompany: { select: { id: true, name: true } },
  crmContact: { select: { id: true, fullName: true, email: true, mobile: true, phone: true } },
  pipeline: { select: { id: true, name: true } },
  stage: { select: { id: true, name: true, probability: true, sortOrder: true } },
  source: { select: { id: true, key: true, name: true } },
} satisfies Prisma.CrmOpportunitySelect;
export type OpportunityListRow = Prisma.CrmOpportunityGetPayload<{ select: typeof OPPORTUNITY_LIST_SELECT }>;

const OPPORTUNITY_DETAIL_SELECT = {
  ...OPPORTUNITY_LIST_SELECT,
  description: true,
  customFields: true,
  closeReason: true,
  closedByUserId: true,
  stageChangedAt: true,
  sourceId: true,
  updatedByUserId: true,
  archivedByUserId: true,
  createdByUserId: true,
  createdBy: { select: { id: true, fullName: true } },
  lead: { select: { id: true, leadNumber: true, fullName: true, convertedAt: true } },
  crmCompany: {
    select: {
      id: true,
      name: true,
      industry: true,
      city: true,
      country: true,
      archivedAt: true,
      mergedIntoId: true,
      owner: { select: { id: true, fullName: true } },
      status: { select: { id: true, name: true, color: true } },
      primaryContact: { select: { id: true, fullName: true } },
      customer: { select: { id: true, code: true } },
    },
  },
  crmContact: {
    select: {
      id: true,
      fullName: true,
      designation: true,
      email: true,
      mobile: true,
      phone: true,
      archivedAt: true,
      mergedIntoId: true,
      crmCompany: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.CrmOpportunitySelect;

export const CrmOpportunityRepository = {
  // ── Phase 02 surface ──
  create(data: Prisma.CrmOpportunityUncheckedCreateInput, db: CrmDb) {
    return db.crmOpportunity.create({ data, select: OPPORTUNITY_SELECT });
  },
  findById(where: Prisma.CrmOpportunityWhereInput) {
    return prisma.crmOpportunity.findFirst({ where, select: OPPORTUNITY_SELECT });
  },

  // ── Phase 06 ──
  findRaw(where: Prisma.CrmOpportunityWhereInput, db: CrmDb = prisma) {
    return db.crmOpportunity.findFirst({ where });
  },
  findManyRaw(where: Prisma.CrmOpportunityWhereInput) {
    return prisma.crmOpportunity.findMany({ where });
  },
  findDetail(where: Prisma.CrmOpportunityWhereInput) {
    return prisma.crmOpportunity.findFirst({ where, select: OPPORTUNITY_DETAIL_SELECT });
  },
  findMany(where: Prisma.CrmOpportunityWhereInput, orderBy: Prisma.CrmOpportunityOrderByWithRelationInput[], skip: number, take: number) {
    return prisma.crmOpportunity.findMany({ where, orderBy, skip, take, select: OPPORTUNITY_LIST_SELECT });
  },
  count(where: Prisma.CrmOpportunityWhereInput) {
    return prisma.crmOpportunity.count({ where });
  },
  updateVersioned(id: string, version: number, data: Prisma.CrmOpportunityUncheckedUpdateManyInput, db: CrmDb) {
    return db.crmOpportunity.updateMany({ where: { id, version }, data: { ...data, version: { increment: 1 } } });
  },
  updateRaw(id: string, data: Prisma.CrmOpportunityUncheckedUpdateInput, db: CrmDb) {
    return db.crmOpportunity.update({ where: { id }, data: { ...data, version: { increment: 1 } } });
  },
  /** Open opportunities with the same name key and the same company/contact pair (possible duplicates). */
  duplicateCandidates(companyId: string, nameKey: string, crmCompanyId: string | null, crmContactId: string | null, excludeId?: string) {
    return prisma.crmOpportunity.findMany({
      where: { companyId, nameKey, crmCompanyId, crmContactId, status: "OPEN", archivedAt: null, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: {
        id: true,
        opportunityNumber: true,
        name: true,
        amount: true,
        currencyCode: true,
        expectedCloseDate: true,
        ownerUserId: true,
        createdByUserId: true,
        owner: { select: { fullName: true } },
        stage: { select: { name: true } },
        crmCompany: { select: { name: true } },
        crmContact: { select: { fullName: true } },
      },
      take: 10,
    });
  },
  erpDocNumbers(opportunityId: string, db: CrmDb = prisma) {
    return db.crmOpportunityErpLink.findMany({ where: { opportunityId }, select: { docNumber: true } });
  },
  setSearchText(id: string, searchText: string, db: CrmDb) {
    return db.crmOpportunity.update({ where: { id }, data: { searchText } });
  },
  findCompany(companyId: string, id: string) {
    return prisma.crmCompany.findFirst({ where: { id, companyId }, select: { id: true, name: true, ownerUserId: true, createdByUserId: true, archivedAt: true, mergedIntoId: true, customerId: true } });
  },
  findContact(companyId: string, id: string) {
    return prisma.crmContact.findFirst({ where: { id, companyId }, select: { id: true, fullName: true, ownerUserId: true, createdByUserId: true, archivedAt: true, mergedIntoId: true, crmCompanyId: true } });
  },
  findLead(companyId: string, id: string) {
    return prisma.crmLead.findFirst({
      where: { id, companyId },
      select: { id: true, leadNumber: true, fullName: true, ownerUserId: true, createdByUserId: true, sourceId: true, crmCompanyId: true, crmContactId: true, archivedAt: true },
    });
  },
  findLeadForPrefill(companyId: string, id: string) {
    return prisma.crmLead.findFirst({
      where: { id, companyId, archivedAt: null },
      select: {
        id: true,
        leadNumber: true,
        fullName: true,
        companyName: true,
        requirement: true,
        estimatedValue: true,
        currencyCode: true,
        sourceId: true,
        ownerUserId: true,
        createdByUserId: true,
        crmCompanyId: true,
        crmContactId: true,
      },
    });
  },
  entityIdsWithAnyTag(companyId: string, entityType: CrmEntityType, tagIds: string[]) {
    return prisma.crmEntityTag.findMany({ where: { companyId, entityType, tagId: { in: tagIds } }, select: { entityId: true }, distinct: ["entityId"] });
  },
  companyBaseCurrency(companyId: string) {
    return prisma.company.findUnique({ where: { id: companyId }, select: { baseCurrencyCode: true } });
  },
  activeUserInCompany(companyId: string, userId: string) {
    return prisma.user.findFirst({ where: { id: userId, companyId, status: "ACTIVE" }, select: { id: true, fullName: true } });
  },
  userNames(ids: string[]) {
    if (!ids.length) return Promise.resolve([]);
    return prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true } });
  },
  recordNames(companyId: string, companyIds: string[], contactIds: string[]) {
    return Promise.all([
      companyIds.length ? prisma.crmCompany.findMany({ where: { companyId, id: { in: companyIds } }, select: { id: true, name: true } }) : Promise.resolve([]),
      contactIds.length ? prisma.crmContact.findMany({ where: { companyId, id: { in: contactIds } }, select: { id: true, fullName: true } }) : Promise.resolve([]),
    ]);
  },

  // ── ERP document links ──
  erpLinks(companyId: string, opportunityId: string) {
    return prisma.crmOpportunityErpLink.findMany({ where: { companyId, opportunityId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  },
  findErpLink(companyId: string, opportunityId: string, linkId: string) {
    return prisma.crmOpportunityErpLink.findFirst({ where: { id: linkId, companyId, opportunityId } });
  },
  findErpLinkByDoc(opportunityId: string, docType: string, docId: string) {
    return prisma.crmOpportunityErpLink.findFirst({ where: { opportunityId, docType, docId } });
  },
  erpLinkCount(companyId: string, opportunityId: string) {
    return prisma.crmOpportunityErpLink.count({ where: { companyId, opportunityId } });
  },
};
export type CrmOpportunitySummary = Prisma.CrmOpportunityGetPayload<{ select: typeof OPPORTUNITY_SELECT }>;
export type OpportunityDetailRow = Prisma.CrmOpportunityGetPayload<{ select: typeof OPPORTUNITY_DETAIL_SELECT }>;
export type OpportunityDuplicateCandidate = Awaited<ReturnType<typeof CrmOpportunityRepository.duplicateCandidates>>[number];
