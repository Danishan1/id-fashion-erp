import type { CrmEntityType, Prisma } from "@prisma/client";
import { prisma } from "@/core/db/client";
import type { CrmDb } from "../core/crm-db";

/** Lookup shape used by lead conversion / linking pickers (Phase 02 contract). */
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

const USER_SELECT = { id: true, fullName: true, status: true } satisfies Prisma.UserSelect;

export const CONTACT_LIST_SELECT = {
  id: true,
  firstName: true,
  middleName: true,
  lastName: true,
  fullName: true,
  designation: true,
  department: true,
  email: true,
  phone: true,
  mobile: true,
  whatsapp: true,
  ownerUserId: true,
  createdByUserId: true,
  lastActivityAt: true,
  duplicateFlaggedAt: true,
  archivedAt: true,
  mergedIntoId: true,
  createdAt: true,
  updatedAt: true,
  version: true,
  owner: { select: USER_SELECT },
  source: { select: { id: true, name: true, key: true } },
  crmCompany: { select: { id: true, name: true, customerId: true } },
  consents: { select: { channel: true, status: true, reason: true } },
} satisfies Prisma.CrmContactSelect;

export const CONTACT_DETAIL_INCLUDE = {
  owner: { select: USER_SELECT },
  createdBy: { select: { id: true, fullName: true } },
  source: { select: { id: true, name: true, key: true } },
  sourceLead: { select: { id: true, leadNumber: true, fullName: true, convertedAt: true } },
  crmCompany: { select: { id: true, name: true, customerId: true, website: true, industry: true, city: true, country: true, customer: { select: { id: true, code: true, name: true } } } },
  mergedInto: { select: { id: true, fullName: true } },
  addresses: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] },
  channels: { orderBy: { createdAt: "asc" } },
  consents: { orderBy: { channel: "asc" } },
  mergedFrom: { select: { id: true, fullName: true, mergedAt: true } },
} satisfies Prisma.CrmContactInclude;

export type ContactListRow = Prisma.CrmContactGetPayload<{ select: typeof CONTACT_LIST_SELECT }>;
export type ContactDetailRow = Prisma.CrmContactGetPayload<{ include: typeof CONTACT_DETAIL_INCLUDE }>;

const DUP_SELECT = {
  id: true,
  fullName: true,
  nameKey: true,
  email: true,
  phone: true,
  mobile: true,
  whatsapp: true,
  emailKeys: true,
  phoneKeys: true,
  crmCompanyId: true,
  ownerUserId: true,
  createdByUserId: true,
  archivedAt: true,
  crmCompany: { select: { name: true } },
  owner: { select: { fullName: true } },
} satisfies Prisma.CrmContactSelect;
export type ContactDuplicateCandidate = Prisma.CrmContactGetPayload<{ select: typeof DUP_SELECT }>;

export const CrmContactRepository = {
  findById(where: Prisma.CrmContactWhereInput, db: CrmDb = prisma) {
    return db.crmContact.findFirst({ where, select: CONTACT_SELECT });
  },
  /** Phase 02 lookup: contacts sharing any email/phone key (merged contacts excluded). */
  findMatches(companyId: string, emailKeys: string[], phoneKeys: string[], take = 5) {
    if (!emailKeys.length && !phoneKeys.length) return Promise.resolve([]);
    return prisma.crmContact.findMany({
      where: {
        companyId,
        archivedAt: null,
        mergedIntoId: null,
        OR: [...(emailKeys.length ? [{ emailKeys: { hasSome: emailKeys } }] : []), ...(phoneKeys.length ? [{ phoneKeys: { hasSome: phoneKeys } }] : [])],
      },
      select: CONTACT_SELECT,
      take,
    });
  },
  search(where: Prisma.CrmContactWhereInput, take = 20) {
    return prisma.crmContact.findMany({ where, select: CONTACT_SELECT, orderBy: { fullName: "asc" }, take });
  },
  update(id: string, data: Prisma.CrmContactUncheckedUpdateInput, db: CrmDb) {
    return db.crmContact.update({ where: { id }, data: { ...data, version: { increment: 1 } }, select: CONTACT_SELECT });
  },

  // ── Phase 04 ──
  findMany(where: Prisma.CrmContactWhereInput, orderBy: Prisma.CrmContactOrderByWithRelationInput[], skip: number, take: number) {
    return prisma.crmContact.findMany({ where, orderBy, skip, take, select: CONTACT_LIST_SELECT });
  },
  count(where: Prisma.CrmContactWhereInput) {
    return prisma.crmContact.count({ where });
  },
  findDetail(where: Prisma.CrmContactWhereInput, db: CrmDb = prisma) {
    return db.crmContact.findFirst({ where, include: CONTACT_DETAIL_INCLUDE });
  },
  findRaw(where: Prisma.CrmContactWhereInput, db: CrmDb = prisma) {
    return db.crmContact.findFirst({ where });
  },
  findManyRaw(where: Prisma.CrmContactWhereInput, db: CrmDb = prisma) {
    return db.crmContact.findMany({ where });
  },
  createRaw(data: Prisma.CrmContactUncheckedCreateInput, db: CrmDb) {
    return db.crmContact.create({ data });
  },
  /** Version-checked update: 0 rows when someone else saved first. */
  updateVersioned(id: string, version: number, data: Prisma.CrmContactUncheckedUpdateManyInput, db: CrmDb) {
    return db.crmContact.updateMany({ where: { id, version }, data: { ...data, version: { increment: 1 } } });
  },
  updateRaw(id: string, data: Prisma.CrmContactUncheckedUpdateInput, db: CrmDb) {
    return db.crmContact.update({ where: { id }, data: { ...data, version: { increment: 1 } } });
  },
  /** Row locks (SELECT … FOR UPDATE, in id order) so concurrent merges/edits of the same contacts serialise. */
  async lockForUpdate(ids: string[], db: Prisma.TransactionClient) {
    const sorted = [...ids].sort();
    await db.$queryRaw`SELECT id FROM crm_contacts WHERE id = ANY(${sorted}::uuid[]) ORDER BY id FOR UPDATE`;
  },
  touchActivity(ids: string[], at: Date, db: CrmDb = prisma) {
    if (!ids.length) return Promise.resolve({ count: 0 });
    return db.crmContact.updateMany({ where: { id: { in: ids }, OR: [{ lastActivityAt: null }, { lastActivityAt: { lt: at } }] }, data: { lastActivityAt: at } });
  },
  duplicateCandidates(companyId: string, criteria: { emailKeys: string[]; phoneKeys: string[]; nameKey?: string | null; crmCompanyId?: string | null }, excludeId?: string, take = 10) {
    const or: Prisma.CrmContactWhereInput[] = [];
    if (criteria.emailKeys.length) or.push({ emailKeys: { hasSome: criteria.emailKeys } });
    if (criteria.phoneKeys.length) or.push({ phoneKeys: { hasSome: criteria.phoneKeys } });
    if (criteria.nameKey && criteria.crmCompanyId) or.push({ nameKey: criteria.nameKey, crmCompanyId: criteria.crmCompanyId });
    if (!or.length) return Promise.resolve([]);
    return prisma.crmContact.findMany({
      where: { companyId, mergedIntoId: null, ...(excludeId ? { id: { not: excludeId } } : {}), OR: or },
      select: DUP_SELECT,
      orderBy: { createdAt: "desc" },
      take,
    });
  },
  summaries(companyId: string, ids: string[]) {
    if (!ids.length) return Promise.resolve([]);
    return prisma.crmContact.findMany({
      where: { companyId, id: { in: ids } },
      select: { id: true, fullName: true, email: true, mobile: true, phone: true, mergedIntoId: true, archivedAt: true, ownerUserId: true, createdByUserId: true, crmCompany: { select: { name: true } } },
    });
  },

  // Channels / addresses / consents
  channels(contactId: string, db: CrmDb = prisma) {
    return db.crmContactChannel.findMany({ where: { contactId }, orderBy: { createdAt: "asc" } });
  },
  createChannels(data: Prisma.CrmContactChannelCreateManyInput[], db: CrmDb) {
    return db.crmContactChannel.createMany({ data, skipDuplicates: true });
  },
  findChannel(companyId: string, contactId: string, id: string, db: CrmDb = prisma) {
    return db.crmContactChannel.findFirst({ where: { id, contactId, companyId } });
  },
  deleteChannel(id: string, db: CrmDb) {
    return db.crmContactChannel.delete({ where: { id } });
  },
  addresses(contactId: string, db: CrmDb = prisma) {
    return db.crmAddress.findMany({ where: { contactId }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] });
  },
  findAddress(companyId: string, contactId: string, id: string, db: CrmDb = prisma) {
    return db.crmAddress.findFirst({ where: { id, contactId, companyId } });
  },
  createAddress(data: Prisma.CrmAddressUncheckedCreateInput, db: CrmDb) {
    return db.crmAddress.create({ data });
  },
  updateAddress(id: string, data: Prisma.CrmAddressUncheckedUpdateInput, db: CrmDb) {
    return db.crmAddress.update({ where: { id }, data });
  },
  deleteAddress(id: string, db: CrmDb) {
    return db.crmAddress.delete({ where: { id } });
  },
  clearPrimaryAddress(contactId: string, db: CrmDb, exceptId?: string) {
    return db.crmAddress.updateMany({ where: { contactId, isPrimary: true, ...(exceptId ? { id: { not: exceptId } } : {}) }, data: { isPrimary: false } });
  },
  consents(contactId: string, db: CrmDb = prisma) {
    return db.crmContactConsent.findMany({ where: { contactId } });
  },
  upsertConsent(
    companyId: string,
    contactId: string,
    channel: string,
    data: Omit<Prisma.CrmContactConsentUncheckedCreateInput, "companyId" | "contactId" | "channel">,
    db: CrmDb
  ) {
    return db.crmContactConsent.upsert({
      where: { contactId_channel: { contactId, channel } },
      create: { companyId, contactId, channel, ...data },
      update: data,
    });
  },

  // Related records for the detail page
  leadsForContacts(companyId: string, contactIds: string[], where: Prisma.CrmLeadWhereInput, take = 20) {
    return prisma.crmLead.findMany({
      where: { AND: [{ companyId, crmContactId: { in: contactIds } }, where] },
      select: { id: true, leadNumber: true, fullName: true, convertedAt: true, archivedAt: true, createdAt: true, status: { select: { name: true, color: true } } },
      orderBy: { createdAt: "desc" },
      take,
    });
  },
  opportunitiesForContacts(companyId: string, contactIds: string[], where: Prisma.CrmOpportunityWhereInput, take = 20) {
    return prisma.crmOpportunity.findMany({
      where: { AND: [{ companyId, crmContactId: { in: contactIds }, archivedAt: null }, where] },
      select: { id: true, opportunityNumber: true, name: true, status: true, amount: true, currencyCode: true, expectedCloseDate: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take,
    });
  },
  /** Every contact merged (directly or through a chain) into this one. */
  async mergedIdsInto(companyId: string, survivorId: string): Promise<string[]> {
    const rows = await prisma.$queryRaw<{ id: string }[]>`
      WITH RECURSIVE m(id) AS (
        SELECT merged_id FROM crm_contact_merges WHERE company_id = ${companyId}::uuid AND survivor_id = ${survivorId}::uuid
        UNION
        SELECT cm.merged_id FROM crm_contact_merges cm JOIN m ON cm.survivor_id = m.id
      ) SELECT id::text AS id FROM m`;
    return rows.map((r) => r.id);
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
  crmCompanyName(companyId: string, id: string | null | undefined, db: CrmDb = prisma) {
    if (!id) return Promise.resolve(null);
    return db.crmCompany.findFirst({ where: { id, companyId }, select: { id: true, name: true } });
  },
  /** ERP Customer in this company (for "company = this customer"). */
  customer(companyId: string, customerId: string) {
    return prisma.customer.findFirst({ where: { id: customerId, companyId }, select: { id: true, code: true, name: true, country: true, city: true, crmCompany: { select: { id: true, name: true, archivedAt: true } } } });
  },
};
export type CrmContactSummary = Prisma.CrmContactGetPayload<{ select: typeof CONTACT_SELECT }>;
