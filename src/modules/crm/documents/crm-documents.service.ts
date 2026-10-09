import type { RelatedModule } from "@prisma/client";
import { deleteAttachment, getAttachmentForDownload, getAttachmentMetadata, listAttachments, uploadAttachment } from "@/core/attachments/AttachmentService";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import type { CrmActor } from "../core/crm-actor";
import { runCrmMutation } from "../core/crm-mutation";
import { getCrmRecordScope } from "../core/crm-visibility";
import { loadCompanyForActor } from "../companies/crm-companies.service";
import { CrmCompanyRepository } from "../companies/crm-company.repository";
import { loadContactForActor } from "../contacts/crm-contacts.service";
import { CrmContactRepository } from "../contacts/crm-contact.repository";
import { loadOpportunityForActor } from "../opportunities/crm-opportunities.service";

/**
 * CRM documents for any record type, stored through the ERP's shared
 * AttachmentService (same file types, size limit and storage as every other
 * module). A document is reachable only through a record the viewer can
 * see; merged records' documents move to the survivor.
 */

export type CrmDocumentEntity = "CONTACT" | "COMPANY" | "OPPORTUNITY";

const MODULE: Record<CrmDocumentEntity, RelatedModule> = { CONTACT: "CRM_CONTACT", COMPANY: "CRM_COMPANY", OPPORTUNITY: "CRM_OPPORTUNITY" };
const ENTITY_BY_MODULE: Partial<Record<RelatedModule, CrmDocumentEntity>> = { CRM_CONTACT: "CONTACT", CRM_COMPANY: "COMPANY", CRM_OPPORTUNITY: "OPPORTUNITY" };
const EVENT = {
  CONTACT: { added: "contact.document_added", removed: "contact.document_removed" },
  COMPANY: { added: "company.document_added", removed: "company.document_removed" },
  OPPORTUNITY: { added: "opportunity.document_added", removed: "opportunity.document_removed" },
} as const;

async function loadRecord(actor: CrmActor, entity: CrmDocumentEntity, id: string, allowMerged: boolean) {
  if (entity === "OPPORTUNITY") {
    // Opportunities are never merged; documents stay on archived and closed deals.
    const o = await loadOpportunityForActor(actor, id);
    return { id: o.id, archivedAt: o.archivedAt, mergedIntoId: null };
  }
  const r = entity === "CONTACT" ? await loadContactForActor(actor, id, { allowMerged }) : await loadCompanyForActor(actor, id, { allowMerged });
  return { id: r.id, archivedAt: r.archivedAt, mergedIntoId: r.mergedIntoId };
}

const mergedIds = (actor: CrmActor, entity: CrmDocumentEntity, id: string): Promise<string[]> =>
  entity === "CONTACT" ? CrmContactRepository.mergedIdsInto(actor.companyId, id) : entity === "COMPANY" ? CrmCompanyRepository.mergedIdsInto(actor.companyId, id) : Promise.resolve([]);

export async function listCrmDocuments(actor: CrmActor, entity: CrmDocumentEntity, id: string) {
  const record = await loadRecord(actor, entity, id, true);
  const ids = [record.id, ...(await mergedIds(actor, entity, record.id))];
  const lists = await Promise.all(ids.map((rid) => listAttachments(actor.companyId, MODULE[entity], rid)));
  return lists.flat().sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime());
}

export async function uploadCrmDocument(actor: CrmActor, entity: CrmDocumentEntity, id: string, file: { buffer: Buffer; fileName: string; mimeType: string }, label?: string | null) {
  const record = await loadRecord(actor, entity, id, false);
  if (record.archivedAt) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "Restore this record before adding documents.");
  const attachment = await uploadAttachment(actor, MODULE[entity], id, file, label?.trim().slice(0, 60) || null);
  await runCrmMutation(actor, async ({ emit }) => {
    emit({ entityType: entity, entityId: id, eventType: EVENT[entity].added, summary: attachment.fileName, payload: { attachmentId: attachment.id } });
  });
  return attachment;
}

/** A CRM attachment whose record the actor can see (otherwise NOT_FOUND — never other modules' files). */
async function loadCrmAttachment(actor: CrmActor, attachmentId: string) {
  const attachment = await getAttachmentMetadata(actor.companyId, attachmentId);
  const entity = ENTITY_BY_MODULE[attachment.relatedModule];
  if (!entity) throw new BusinessRuleError("NOT_FOUND", "Attachment not found.", { id: attachmentId });
  const record = await loadRecord(actor, entity, attachment.relatedRecordId, true);
  return { attachment, entity, record };
}

export async function downloadCrmDocument(actor: CrmActor, attachmentId: string) {
  await loadCrmAttachment(actor, attachmentId);
  return getAttachmentForDownload(actor.companyId, attachmentId);
}

/** Uploader or a user with crm.view_all; not on archived/merged records. */
export async function deleteCrmDocument(actor: CrmActor, attachmentId: string) {
  const { attachment, entity, record } = await loadCrmAttachment(actor, attachmentId);
  if (record.mergedIntoId || record.archivedAt) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "Restore this record before removing documents.");
  const scope = await getCrmRecordScope(actor);
  if (attachment.uploadedById !== actor.userId && scope.mode !== "ALL") throw new BusinessRuleError("PERMISSION_DENIED", "Only the person who uploaded a document or a manager can remove it.");
  await deleteAttachment(actor, attachmentId);
  await runCrmMutation(actor, async ({ emit }) => {
    emit({ entityType: entity, entityId: record.id, eventType: EVENT[entity].removed, summary: attachment.fileName, payload: { attachmentId } });
  });
}
