import type { Prisma } from "@prisma/client";
import type { CrmActor } from "../core/crm-actor";
import { crmOwnerWhere, getCrmRecordScope } from "../core/crm-visibility";
import { deleteCrmDocument, downloadCrmDocument, listCrmDocuments, uploadCrmDocument } from "../documents/crm-documents.service";
import { getErpReferencesForCrmCompany, type ErpReferenceQuery } from "../erp/crm-erp-references.service";
import { CONTACT_FUTURE_SECTIONS } from "./contact-registry";
import { CrmContactRepository } from "./crm-contact.repository";
import { loadContactForActor } from "./crm-contacts.service";

/**
 * Everything shown around a contact that is not the contact itself:
 * CRM records linked to it, read-only references to authoritative ERP
 * documents, and its documents (the ERP attachment service). Every section
 * re-applies the viewer's own permissions — seeing a contact never grants
 * access to sales orders or invoices.
 */

/** The contact plus every contact merged into it (their links now point here). */
async function contactAndMergedIds(actor: CrmActor, id: string) {
  const contact = await loadContactForActor(actor, id, { allowMerged: true });
  const mergedIds = await CrmContactRepository.mergedIdsInto(actor.companyId, contact.id);
  return { contact, ids: [contact.id, ...mergedIds] };
}

export async function getContactRelated(actor: CrmActor, id: string) {
  const { ids } = await contactAndMergedIds(actor, id);
  const scope = await getCrmRecordScope(actor);
  const [leads, opportunities] = await Promise.all([
    CrmContactRepository.leadsForContacts(actor.companyId, ids, crmOwnerWhere(scope) as Prisma.CrmLeadWhereInput),
    CrmContactRepository.opportunitiesForContacts(actor.companyId, ids, crmOwnerWhere(scope) as Prisma.CrmOpportunityWhereInput),
  ]);
  return {
    leads,
    opportunities,
    // Honest placeholders — these sections get real providers in their phases.
    upcoming: CONTACT_FUTURE_SECTIONS,
  };
}

/** Read-only ERP references through the contact's company (see erp/crm-erp-references.service.ts). */
export async function getContactErpReferences(actor: CrmActor, id: string, query?: ErpReferenceQuery) {
  const contact = await loadContactForActor(actor, id, { allowMerged: true });
  return getErpReferencesForCrmCompany(actor, contact.crmCompanyId, query, "contact");
}

// ── Documents (shared CRM document service, relatedModule CRM_CONTACT) ──

export const listContactDocuments = (actor: CrmActor, id: string) => listCrmDocuments(actor, "CONTACT", id);

export const uploadContactDocument = (actor: CrmActor, id: string, file: { buffer: Buffer; fileName: string; mimeType: string }, label?: string | null) =>
  uploadCrmDocument(actor, "CONTACT", id, file, label);

export const downloadContactDocument = (actor: CrmActor, attachmentId: string) => downloadCrmDocument(actor, attachmentId);

export const deleteContactDocument = (actor: CrmActor, attachmentId: string) => deleteCrmDocument(actor, attachmentId);
