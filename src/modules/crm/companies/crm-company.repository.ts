import type { CrmEntityType, Prisma } from "@prisma/client";
import { prisma } from "@/core/db/client";
import type { CrmDb } from "../core/crm-db";

/** Lookup shape used by pickers and lead conversion (Phase 02 contract, extended). */
const COMPANY_SELECT = {
  id: true,
  name: true,
  email: true,
  phone: true,
  city: true,
  country: true,
  website: true,
  customerId: true,
  ownerUserId: true,
  createdByUserId: true,
  customer: { select: { code: true } },
} satisfies Prisma.CrmCompanySelect;

const USER_SELECT = { id: true, fullName: true, status: true } satisfies Prisma.UserSelect;

export const COMPANY_LIST_SELECT = {
  id: true,
  name: true,
  legalName: true,
  displayName: true,
  companyType: true,
  industry: true,
  website: true,
  email: true,
  phone: true,
  mobile: true,
  city: true,
  state: true,
  country: true,
  ownerUserId: true,
  createdByUserId: true,
  customerId: true,
  lastActivityAt: true,
  duplicateFlaggedAt: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
  version: true,
  owner: { select: USER_SELECT },
  status: { select: { id: true, name: true, color: true } },
  source: { select: { id: true, name: true, key: true } },
  customer: { select: { id: true, code: true, name: true } },
  primaryContact: { select: { id: true, fullName: true } },
} satisfies Prisma.CrmCompanySelect;

export const COMPANY_DETAIL_INCLUDE = {
  owner: { select: USER_SELECT },
  createdBy: { select: { id: true, fullName: true } },
  status: { select: { id: true, name: true, color: true, key: true } },
  source: { select: { id: true, name: true, key: true } },
  sourceLead: { select: { id: true, leadNumber: true, fullName: true, convertedAt: true } },
  primaryContact: { select: { id: true, fullName: true, designation: true, email: true, mobile: true, phone: true } },
  customer: { select: { id: true, code: true, name: true, type: true, isActive: true, deletedAt: true } },
  mergedInto: { select: { id: true, name: true } },
  mergedFrom: { select: { id: true, name: true, mergedAt: true } },
  addresses: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] },
} satisfies Prisma.CrmCompanyInclude;

export type CompanyListRow = Prisma.CrmCompanyGetPayload<{ select: typeof COMPANY_LIST_SELECT }>;
export type CompanyDetailRow = Prisma.CrmCompanyGetPayload<{ include: typeof COMPANY_DETAIL_INCLUDE }>;

const DUP_SELECT = {
  id: true,
  name: true,
  legalName: true,
  nameMatchKey: true,
  legalMatchKey: true,
  website: true,
  websiteKey: true,
  email: true,
  phone: true,
  mobile: true,
  city: true,
  emailKeys: true,
  phoneKeys: true,
  customerId: true,
  ownerUserId: true,
  createdByUserId: true,
  archivedAt: true,
  owner: { select: { fullName: true } },
  customer: { select: { code: true, name: true } },
} satisfies Prisma.CrmCompanySelect;
export type CompanyDuplicateCandidate = Prisma.CrmCompanyGetPayload<{ select: typeof DUP_SELECT }>;

const CONTACT_ROW_SELECT = {
  id: true,
  fullName: true,
  designation: true,
  email: true,
  mobile: true,
  phone: true,
  lastActivityAt: true,
  archivedAt: true,
  ownerUserId: true,
  owner: { select: { id: true, fullName: true, status: true } },
} satisfies Prisma.CrmContactSelect;

export const CrmCompanyRepository = {
  // ── Phase 02 surface ──
  findById(where: Prisma.CrmCompanyWhereInput, db: CrmDb = prisma) {
    return db.crmCompany.findFirst({ where, select: COMPANY_SELECT });
  },
  findByNameKey(companyId: string, nameKey: string, take = 5) {
    return prisma.crmCompany.findMany({ where: { companyId, nameKey, archivedAt: null, mergedIntoId: null }, select: COMPANY_SELECT, take });
  },
  search(where: Prisma.CrmCompanyWhereInput, take = 20) {
    return prisma.crmCompany.findMany({ where, select: COMPANY_SELECT, orderBy: { name: "asc" }, take });
  },
  findByCustomerId(companyId: string, customerId: string, db: CrmDb = prisma) {
    return db.crmCompany.findFirst({ where: { companyId, customerId }, select: { ...COMPANY_SELECT, archivedAt: true, mergedIntoId: true } });
  },
  customer(companyId: string, customerId: string, db: CrmDb = prisma) {
    return db.customer.findFirst({ where: { id: customerId, companyId, deletedAt: null }, select: { id: true, code: true, name: true, city: true, country: true, email: true, phone: true, isActive: true } });
  },
  /** ERP customers for pickers (never deleted ones), with their CRM company link, if any. */
  searchCustomers(companyId: string, term: string | undefined, take = 20) {
    return prisma.customer.findMany({
      where: { companyId, deletedAt: null, ...(term ? { OR: [{ name: { contains: term, mode: "insensitive" } }, { code: { contains: term, mode: "insensitive" } }] } : {}) },
      select: { id: true, code: true, name: true, city: true, country: true, isActive: true, crmCompany: { select: { id: true, name: true, archivedAt: true, mergedIntoId: true } } },
      orderBy: { name: "asc" },
      take,
    });
  },
  create(data: Prisma.CrmCompanyUncheckedCreateInput, db: CrmDb) {
    return db.crmCompany.create({ data, select: COMPANY_SELECT });
  },

  // ── Phase 05 ──
  findMany(where: Prisma.CrmCompanyWhereInput, orderBy: Prisma.CrmCompanyOrderByWithRelationInput[], skip: number, take: number) {
    return prisma.crmCompany.findMany({ where, orderBy, skip, take, select: COMPANY_LIST_SELECT });
  },
  count(where: Prisma.CrmCompanyWhereInput) {
    return prisma.crmCompany.count({ where });
  },
  findDetail(where: Prisma.CrmCompanyWhereInput, db: CrmDb = prisma) {
    return db.crmCompany.findFirst({ where, include: COMPANY_DETAIL_INCLUDE });
  },
  findRaw(where: Prisma.CrmCompanyWhereInput, db: CrmDb = prisma) {
    return db.crmCompany.findFirst({ where });
  },
  findManyRaw(where: Prisma.CrmCompanyWhereInput, db: CrmDb = prisma) {
    return db.crmCompany.findMany({ where });
  },
  createRaw(data: Prisma.CrmCompanyUncheckedCreateInput, db: CrmDb) {
    return db.crmCompany.create({ data });
  },
  updateVersioned(id: string, version: number, data: Prisma.CrmCompanyUncheckedUpdateManyInput, db: CrmDb) {
    return db.crmCompany.updateMany({ where: { id, version }, data: { ...data, version: { increment: 1 } } });
  },
  updateRaw(id: string, data: Prisma.CrmCompanyUncheckedUpdateInput, db: CrmDb) {
    return db.crmCompany.update({ where: { id }, data: { ...data, version: { increment: 1 } } });
  },
  /** Derived columns only (no version bump). */
  setDerived(id: string, data: Prisma.CrmCompanyUncheckedUpdateInput, db: CrmDb) {
    return db.crmCompany.update({ where: { id }, data });
  },
  async lockForUpdate(ids: string[], db: Prisma.TransactionClient) {
    const sorted = [...ids].sort();
    await db.$queryRaw`SELECT id FROM crm_companies WHERE id = ANY(${sorted}::uuid[]) ORDER BY id FOR UPDATE`;
  },
  duplicateCandidates(
    companyId: string,
    c: { nameKeys: string[]; legalKeys: string[]; websiteKey: string | null; emailKeys: string[]; phoneKeys: string[]; customerId: string | null },
    excludeId?: string,
    take = 10
  ) {
    const or: Prisma.CrmCompanyWhereInput[] = [];
    if (c.nameKeys.length) or.push({ nameMatchKey: { in: c.nameKeys } });
    if (c.legalKeys.length) or.push({ legalMatchKey: { in: c.legalKeys } });
    if (c.websiteKey) or.push({ websiteKey: c.websiteKey });
    if (c.emailKeys.length) or.push({ emailKeys: { hasSome: c.emailKeys } });
    if (c.phoneKeys.length) or.push({ phoneKeys: { hasSome: c.phoneKeys } });
    if (c.customerId) or.push({ customerId: c.customerId });
    if (!or.length) return Promise.resolve([]);
    return prisma.crmCompany.findMany({
      where: { companyId, mergedIntoId: null, ...(excludeId ? { id: { not: excludeId } } : {}), OR: or },
      select: DUP_SELECT,
      orderBy: { createdAt: "desc" },
      take,
    });
  },
  summaries(companyId: string, ids: string[]) {
    if (!ids.length) return Promise.resolve([]);
    return prisma.crmCompany.findMany({ where: { companyId, id: { in: ids } }, select: { id: true, name: true, website: true, city: true, mergedIntoId: true, archivedAt: true, customer: { select: { code: true } } } });
  },
  /** Every company merged (directly or through a chain) into this one. */
  async mergedIdsInto(companyId: string, survivorId: string): Promise<string[]> {
    const rows = await prisma.$queryRaw<{ id: string }[]>`
      WITH RECURSIVE m(id) AS (
        SELECT merged_id FROM crm_company_merges WHERE company_id = ${companyId}::uuid AND survivor_id = ${survivorId}::uuid
        UNION
        SELECT cm.merged_id FROM crm_company_merges cm JOIN m ON cm.survivor_id = m.id
      ) SELECT id::text AS id FROM m`;
    return rows.map((r) => r.id);
  },
  /** Open-opportunity counts for a page of companies (one grouped query, no N+1). */
  async openOpportunityCounts(companyId: string, ids: string[]) {
    if (!ids.length) return new Map<string, number>();
    const rows = await prisma.crmOpportunity.groupBy({ by: ["crmCompanyId"], where: { companyId, crmCompanyId: { in: ids }, status: "OPEN", archivedAt: null }, _count: { _all: true } });
    return new Map(rows.map((r) => [r.crmCompanyId as string, r._count._all]));
  },
  async relatedCounts(companyId: string, id: string, contactScope: Prisma.CrmContactWhereInput, leadScope: Prisma.CrmLeadWhereInput, oppScope: Prisma.CrmOpportunityWhereInput) {
    const [contacts, leads, openOpportunities] = await Promise.all([
      prisma.crmContact.count({ where: { AND: [{ companyId, crmCompanyId: id, mergedIntoId: null, archivedAt: null }, contactScope] } }),
      prisma.crmLead.count({ where: { AND: [{ companyId, crmCompanyId: id, archivedAt: null }, leadScope] } }),
      prisma.crmOpportunity.count({ where: { AND: [{ companyId, crmCompanyId: id, archivedAt: null, status: "OPEN" }, oppScope] } }),
    ]);
    return { contacts, leads, openOpportunities };
  },

  /** Everything that moves on merge (all states, not filtered by visibility). */
  async mergeCounts(companyId: string, id: string) {
    const [contacts, leads, opportunities, notes, documents, tags, addresses] = await Promise.all([
      prisma.crmContact.count({ where: { companyId, crmCompanyId: id } }),
      prisma.crmLead.count({ where: { companyId, crmCompanyId: id } }),
      prisma.crmOpportunity.count({ where: { companyId, crmCompanyId: id } }),
      prisma.crmNote.count({ where: { companyId, entityType: "COMPANY", entityId: id, deletedAt: null } }),
      prisma.attachment.count({ where: { companyId, relatedModule: "CRM_COMPANY", relatedRecordId: id } }),
      prisma.crmEntityTag.count({ where: { companyId, entityType: "COMPANY", entityId: id } }),
      prisma.crmAddress.count({ where: { crmCompanyId: id } }),
    ]);
    return { contacts, leads, opportunities, notes, documents, tags, addresses };
  },

  // Related records (paged)
  async contactsPage(where: Prisma.CrmContactWhereInput, skip: number, take: number) {
    const [rows, total] = await Promise.all([
      prisma.crmContact.findMany({ where, select: CONTACT_ROW_SELECT, orderBy: [{ fullName: "asc" }, { id: "asc" }], skip, take }),
      prisma.crmContact.count({ where }),
    ]);
    return { rows, total };
  },
  async leadsPage(where: Prisma.CrmLeadWhereInput, skip: number, take: number) {
    const [rows, total] = await Promise.all([
      prisma.crmLead.findMany({
        where,
        select: {
          id: true,
          leadNumber: true,
          fullName: true,
          score: true,
          estimatedValue: true,
          currencyCode: true,
          convertedAt: true,
          archivedAt: true,
          createdAt: true,
          status: { select: { name: true, color: true } },
          source: { select: { name: true } },
          owner: { select: { id: true, fullName: true, status: true } },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip,
        take,
      }),
      prisma.crmLead.count({ where }),
    ]);
    return { rows, total };
  },
  async opportunitiesPage(where: Prisma.CrmOpportunityWhereInput, skip: number, take: number) {
    const [rows, total] = await Promise.all([
      prisma.crmOpportunity.findMany({
        where,
        select: {
          id: true,
          opportunityNumber: true,
          name: true,
          status: true,
          amount: true,
          currencyCode: true,
          probability: true,
          expectedCloseDate: true,
          createdAt: true,
          owner: { select: { id: true, fullName: true } },
          crmContact: { select: { id: true, fullName: true } },
          pipeline: { select: { id: true, name: true } },
          stage: { select: { id: true, name: true } },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip,
        take,
      }),
      prisma.crmOpportunity.count({ where }),
    ]);
    return { rows, total };
  },
  findContact(companyId: string, contactId: string, db: CrmDb = prisma) {
    return db.crmContact.findFirst({ where: { id: contactId, companyId }, select: { id: true, fullName: true, crmCompanyId: true, archivedAt: true, mergedIntoId: true, version: true, ownerUserId: true, createdByUserId: true } });
  },
  findLead(companyId: string, leadId: string, db: CrmDb = prisma) {
    return db.crmLead.findFirst({ where: { id: leadId, companyId }, select: { id: true, leadNumber: true, fullName: true, crmCompanyId: true, archivedAt: true, ownerUserId: true, createdByUserId: true } });
  },
  contactIdsOf(companyId: string, crmCompanyId: string, db: CrmDb = prisma) {
    return db.crmContact.findMany({ where: { companyId, crmCompanyId }, select: { id: true } });
  },
  // Addresses (crm_addresses.crm_company_id)
  addresses(crmCompanyId: string, db: CrmDb = prisma) {
    return db.crmAddress.findMany({ where: { crmCompanyId }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] });
  },
  findAddress(companyId: string, crmCompanyId: string, id: string, db: CrmDb = prisma) {
    return db.crmAddress.findFirst({ where: { id, crmCompanyId, companyId } });
  },
  clearPrimaryAddress(crmCompanyId: string, db: CrmDb, exceptId?: string) {
    return db.crmAddress.updateMany({ where: { crmCompanyId, isPrimary: true, ...(exceptId ? { id: { not: exceptId } } : {}) }, data: { isPrimary: false } });
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
};
export type CrmCompanySummary = Prisma.CrmCompanyGetPayload<{ select: typeof COMPANY_SELECT }>;
