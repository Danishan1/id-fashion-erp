import type { Prisma } from "@prisma/client";
import { deleteAttachment, getAttachmentForDownload, getAttachmentMetadata, listAttachments, uploadAttachment } from "@/core/attachments/AttachmentService";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { PermissionService } from "@/core/rbac/PermissionService";
import { branchScopeWhere } from "@/lib/branch-access";
import type { CrmActor } from "../core/crm-actor";
import { recordCrmEvent } from "../core/crm-events.service";
import { crmOwnerWhere, getCrmRecordScope } from "../core/crm-visibility";
import { CONTACT_FUTURE_SECTIONS } from "./contact-registry";
import { ContactErpRepository } from "./contact-related.repository";
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

const ERP_TAKE = 10;

export async function getContactErpReferences(actor: CrmActor, id: string) {
  const contact = await loadContactForActor(actor, id, { allowMerged: true });
  const crmCompany = contact.crmCompanyId ? await ContactErpRepository.crmCompany(actor.companyId, contact.crmCompanyId) : null;
  const company = crmCompany ? { id: crmCompany.id, name: crmCompany.name } : null;
  if (!crmCompany?.customerId) {
    return {
      linked: false as const,
      crmCompany: company,
      reason: company ? "This contact's company is not linked to an ERP customer yet." : "This contact has no company. Pick an ERP customer as the company to see its ERP documents.",
    };
  }
  const can = (module: Parameters<typeof PermissionService.can>[1]) => PermissionService.can(actor.userId, module, "view");
  const [mastersView, enquiriesView, ordersView, invoicesView, paymentsView, allowedBranches] = await Promise.all([
    can("masters_core"),
    can("buyer_enquiries"),
    can("sales_orders"),
    can("invoices"),
    can("payments"),
    PermissionService.getAllowedBranchIds(actor.userId),
  ]);
  const branch = branchScopeWhere(allowedBranches);
  const customerId = crmCompany.customerId;
  const [customer, enquiries, orders, invoices, receipts] = await Promise.all([
    ContactErpRepository.customer(actor.companyId, customerId),
    enquiriesView ? ContactErpRepository.buyerEnquiries(actor.companyId, customerId, branch, ERP_TAKE) : null,
    ordersView ? ContactErpRepository.salesOrders(actor.companyId, customerId, branch, ERP_TAKE) : null,
    invoicesView ? ContactErpRepository.salesInvoices(actor.companyId, customerId, branch, ERP_TAKE) : null,
    paymentsView ? ContactErpRepository.receipts(actor.companyId, customerId, branch, ERP_TAKE) : null,
  ]);
  return {
    linked: true as const,
    crmCompany: company,
    customer: customer ? { ...customer, href: mastersView ? `/masters/customers/${customer.id}` : null } : null,
    sections: [
      { key: "buyerEnquiries", label: "Buyer enquiries", allowed: enquiriesView, total: enquiries?.total ?? 0, rows: (enquiries?.rows ?? []).map((r) => ({ id: r.id, number: r.enquiryNumber, date: r.enquiryDate, status: r.status, amount: null, currencyCode: null, href: `/buyer-enquiries/${r.id}` })) },
      { key: "salesOrders", label: "Sales orders", allowed: ordersView, total: orders?.total ?? 0, rows: (orders?.rows ?? []).map((r) => ({ id: r.id, number: r.orderNumber, date: r.orderDate, status: r.status, amount: r.totalAmount, currencyCode: r.currencyCode, href: `/sales-orders/${r.id}` })) },
      { key: "salesInvoices", label: "Sales invoices", allowed: invoicesView, total: invoices?.total ?? 0, rows: (invoices?.rows ?? []).map((r) => ({ id: r.id, number: r.invoiceNumber, date: r.invoiceDate, status: r.status, amount: r.totalAmount, currencyCode: r.currencyCode, href: `/accounts/sales-invoices/${r.id}` })) },
      { key: "receipts", label: "Payments received", allowed: paymentsView, total: receipts?.total ?? 0, rows: (receipts?.rows ?? []).map((r) => ({ id: r.id, number: r.paymentNumber, date: r.paymentDate, status: r.status, amount: r.amount, currencyCode: r.currencyCode, href: `/accounts/payments/${r.id}` })) },
    ],
    // The ERP has no quotation module yet; nothing is invented here.
    notAvailable: [{ key: "quotations", label: "Quotations", reason: "The ERP has no quotation module yet." }],
  };
}

// ── Documents (ERP attachment service, relatedModule CRM_CONTACT) ──

export async function listContactDocuments(actor: CrmActor, id: string) {
  const { ids } = await contactAndMergedIds(actor, id);
  const lists = await Promise.all(ids.map((cid) => listAttachments(actor.companyId, "CRM_CONTACT", cid)));
  return lists.flat().sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime());
}

export async function uploadContactDocument(actor: CrmActor, id: string, file: { buffer: Buffer; fileName: string; mimeType: string }, label?: string | null) {
  const contact = await loadContactForActor(actor, id);
  if (contact.archivedAt) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "Restore this contact before adding documents.");
  const attachment = await uploadAttachment(actor, "CRM_CONTACT", id, file, label?.trim().slice(0, 60) || null);
  await recordCrmEvent(actor, { entityType: "CONTACT", entityId: id, eventType: "contact.document_added", summary: attachment.fileName, payload: { attachmentId: attachment.id } });
  await CrmContactRepository.touchActivity([id], new Date());
  return attachment;
}

/** An attachment that belongs to a CRM contact the actor can see (otherwise NOT_FOUND). */
async function loadContactAttachment(actor: CrmActor, attachmentId: string) {
  const attachment = await getAttachmentMetadata(actor.companyId, attachmentId);
  if (attachment.relatedModule !== "CRM_CONTACT") throw new BusinessRuleError("NOT_FOUND", "Attachment not found.", { id: attachmentId });
  const contact = await loadContactForActor(actor, attachment.relatedRecordId, { allowMerged: true });
  return { attachment, contact };
}

export async function downloadContactDocument(actor: CrmActor, attachmentId: string) {
  await loadContactAttachment(actor, attachmentId);
  return getAttachmentForDownload(actor.companyId, attachmentId);
}

export async function deleteContactDocument(actor: CrmActor, attachmentId: string) {
  const { attachment, contact } = await loadContactAttachment(actor, attachmentId);
  if (contact.mergedIntoId || contact.archivedAt) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "Restore this contact before removing documents.");
  const scope = await getCrmRecordScope(actor);
  if (attachment.uploadedById !== actor.userId && scope.mode !== "ALL") throw new BusinessRuleError("PERMISSION_DENIED", "Only the person who uploaded a document or a manager can remove it.");
  await deleteAttachment(actor, attachmentId);
  await recordCrmEvent(actor, { entityType: "CONTACT", entityId: contact.id, eventType: "contact.document_removed", summary: attachment.fileName, payload: { attachmentId } });
}
