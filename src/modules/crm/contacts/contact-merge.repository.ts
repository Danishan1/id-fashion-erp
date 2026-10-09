import type { Prisma } from "@prisma/client";
import { prisma } from "@/core/db/client";
import type { CrmDb } from "../core/crm-db";

/** Data access for contact merge: counting and re-pointing everything that belongs to a contact. */
export const ContactMergeRepository = {
  async relatedCounts(companyId: string, contactId: string, db: CrmDb = prisma) {
    const [leads, opportunities, notes, documents, tags, addresses, channels] = await Promise.all([
      db.crmLead.count({ where: { companyId, crmContactId: contactId } }),
      db.crmOpportunity.count({ where: { companyId, crmContactId: contactId } }),
      db.crmNote.count({ where: { companyId, entityType: "CONTACT", entityId: contactId, deletedAt: null } }),
      db.attachment.count({ where: { companyId, relatedModule: "CRM_CONTACT", relatedRecordId: contactId } }),
      db.crmEntityTag.count({ where: { companyId, entityType: "CONTACT", entityId: contactId } }),
      db.crmAddress.count({ where: { contactId } }),
      db.crmContactChannel.count({ where: { contactId } }),
    ]);
    return { leads, opportunities, notes, documents, tags, addresses, channels };
  },
  findMergeRecord(mergedId: string, db: CrmDb = prisma) {
    return db.crmContactMerge.findUnique({ where: { mergedId } });
  },
  createMergeRecord(data: Prisma.CrmContactMergeUncheckedCreateInput, db: CrmDb) {
    return db.crmContactMerge.create({ data });
  },
  moveLeads(companyId: string, from: string, to: string, db: CrmDb) {
    return db.crmLead.updateMany({ where: { companyId, crmContactId: from }, data: { crmContactId: to } });
  },
  moveOpportunities(companyId: string, from: string, to: string, db: CrmDb) {
    return db.crmOpportunity.updateMany({ where: { companyId, crmContactId: from }, data: { crmContactId: to } });
  },
  moveNotes(companyId: string, from: string, to: string, db: CrmDb) {
    return db.crmNote.updateMany({ where: { companyId, entityType: "CONTACT", entityId: from }, data: { entityId: to } });
  },
  moveDocuments(companyId: string, from: string, to: string, db: CrmDb) {
    return db.attachment.updateMany({ where: { companyId, relatedModule: "CRM_CONTACT", relatedRecordId: from }, data: { relatedRecordId: to } });
  },
  /** Tags: the survivor gets every tag the merged contact had (no doubles), the merged contact's assignments are moved. */
  async moveTags(companyId: string, from: string, to: string, userId: string, db: CrmDb) {
    const rows = await db.crmEntityTag.findMany({ where: { companyId, entityType: "CONTACT", entityId: from }, select: { tagId: true } });
    if (!rows.length) return 0;
    const { count } = await db.crmEntityTag.createMany({
      data: rows.map((r) => ({ companyId, tagId: r.tagId, entityType: "CONTACT" as const, entityId: to, createdByUserId: userId })),
      skipDuplicates: true,
    });
    await db.crmEntityTag.deleteMany({ where: { companyId, entityType: "CONTACT", entityId: from } });
    return count;
  },
  tagNames(companyId: string, contactId: string, db: CrmDb) {
    return db.crmEntityTag.findMany({ where: { companyId, entityType: "CONTACT", entityId: contactId }, select: { tag: { select: { name: true } } } });
  },
  moveAddresses(from: string, to: string, survivorHasPrimary: boolean, db: CrmDb) {
    return db.crmAddress.updateMany({ where: { contactId: from }, data: { contactId: to, ...(survivorHasPrimary ? { isPrimary: false } : {}) } });
  },
  deleteChannels(contactId: string, db: CrmDb) {
    return db.crmContactChannel.deleteMany({ where: { contactId } });
  },
  /** Companies whose primary contact was the merged contact now point at the survivor. */
  repointPrimaryContact(from: string, to: string, db: CrmDb) {
    return db.crmCompany.updateMany({ where: { primaryContactId: from }, data: { primaryContactId: to } });
  },
  /** Contacts that were merged into the merged contact now point at the survivor (no merge chains). */
  repointEarlierMerges(from: string, to: string, db: CrmDb) {
    return db.crmContact.updateMany({ where: { mergedIntoId: from }, data: { mergedIntoId: to } });
  },
};
