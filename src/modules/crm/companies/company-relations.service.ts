import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import type { CrmActor } from "../core/crm-actor";
import { runCrmMutation } from "../core/crm-mutation";
import { crmOwnerWhere, getCrmRecordScope, isWithinCrmScope } from "../core/crm-visibility";
import { refreshContactDerived } from "../contacts/crm-contacts.service";
import { getErpReferencesForCrmCompany, type ErpReferenceQuery } from "../erp/crm-erp-references.service";
import { companyContactLinkSchema, companyLeadLinkSchema, primaryContactSchema } from "./company.schema";
import { COMPANY_FUTURE_SECTIONS } from "./company-registry";
import { loadCompanyForActor, loadEditableCompany } from "./crm-companies.service";
import { CrmCompanyRepository } from "./crm-company.repository";

/**
 * The company as the organisation-level hub: its contacts, leads and
 * opportunities (each paged and filtered by the viewer's own CRM
 * visibility), read-only ERP references, and the relationship actions
 * (add/remove contact, primary contact, associate lead). Records merged into
 * this company count as its own.
 */

export const relatedPageSchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(10),
  includeArchived: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
});
export type RelatedPage = z.infer<typeof relatedPageSchema>;

async function companyIds(actor: CrmActor, id: string) {
  const company = await loadCompanyForActor(actor, id, { allowMerged: true });
  const merged = await CrmCompanyRepository.mergedIdsInto(actor.companyId, company.id);
  return { company, ids: [company.id, ...merged] };
}

const paged = <T>(r: { rows: T[]; total: number }, p: RelatedPage) => ({ data: r.rows, meta: { page: p.page, pageSize: p.pageSize, totalCount: r.total, totalPages: Math.max(1, Math.ceil(r.total / p.pageSize)) } });

export async function listCompanyContacts(actor: CrmActor, id: string, p: RelatedPage) {
  const { company } = await companyIds(actor, id);
  const scope = await getCrmRecordScope(actor);
  const where: Prisma.CrmContactWhereInput = {
    AND: [{ companyId: actor.companyId, crmCompanyId: company.id, mergedIntoId: null }, ...(p.includeArchived ? [] : [{ archivedAt: null }]), crmOwnerWhere(scope) as Prisma.CrmContactWhereInput],
  };
  const r = await CrmCompanyRepository.contactsPage(where, (p.page - 1) * p.pageSize, p.pageSize);
  return { ...paged({ ...r, rows: r.rows.map((c) => ({ ...c, isPrimary: c.id === company.primaryContactId })) }, p), primaryContactId: company.primaryContactId };
}

export async function listCompanyLeads(actor: CrmActor, id: string, p: RelatedPage) {
  const { ids } = await companyIds(actor, id);
  const scope = await getCrmRecordScope(actor);
  const where: Prisma.CrmLeadWhereInput = { AND: [{ companyId: actor.companyId, crmCompanyId: { in: ids } }, ...(p.includeArchived ? [] : [{ archivedAt: null }]), crmOwnerWhere(scope) as Prisma.CrmLeadWhereInput] };
  return paged(await CrmCompanyRepository.leadsPage(where, (p.page - 1) * p.pageSize, p.pageSize), p);
}

/** Opportunities linked to the company. Pipelines/stages arrive in Phase 06/07 — rows carry `pipeline`/`stage` as null until then. */
export async function listCompanyOpportunities(actor: CrmActor, id: string, p: RelatedPage) {
  const { ids } = await companyIds(actor, id);
  const scope = await getCrmRecordScope(actor);
  const where: Prisma.CrmOpportunityWhereInput = { AND: [{ companyId: actor.companyId, crmCompanyId: { in: ids }, archivedAt: null }, crmOwnerWhere(scope) as Prisma.CrmOpportunityWhereInput] };
  const r = await CrmCompanyRepository.opportunitiesPage(where, (p.page - 1) * p.pageSize, p.pageSize);
  return paged({ ...r, rows: r.rows.map((o) => ({ ...o, pipeline: null, stage: null })) }, p);
}

export async function getCompanyErpReferences(actor: CrmActor, id: string, query?: ErpReferenceQuery) {
  const company = await loadCompanyForActor(actor, id, { allowMerged: true });
  return getErpReferencesForCrmCompany(actor, company.mergedIntoId ?? company.id, query, "company");
}

export function companyUpcomingSections() {
  return COMPANY_FUTURE_SECTIONS;
}

// ── Contact relationship (contacts keep one company: crm_contacts.crm_company_id) ──

/**
 * Adds an existing contact to the company. A contact already at another
 * company is only moved when the caller confirms (`moveFromOtherCompany`).
 * Never creates a contact — new people are created through the Contacts module.
 */
export async function addContactToCompany(actor: CrmActor, id: string, raw: unknown) {
  const input = companyContactLinkSchema.parse(raw);
  const company = await loadEditableCompany(actor, id, "adding contacts");
  const scope = await getCrmRecordScope(actor);
  const contact = await CrmCompanyRepository.findContact(actor.companyId, input.contactId);
  if (!contact || !isWithinCrmScope(scope, contact)) throw new BusinessRuleError("NOT_FOUND", "Contact not found.", { id: input.contactId });
  if (contact.mergedIntoId || contact.archivedAt) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "Restore this contact before adding it to a company.");
  if (contact.crmCompanyId === id && !input.makePrimary) return { contactId: contact.id, moved: false };
  if (contact.crmCompanyId && contact.crmCompanyId !== id && !input.moveFromOtherCompany) {
    const other = await CrmCompanyRepository.findRaw({ id: contact.crmCompanyId });
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", `${contact.fullName} is currently at "${other?.name ?? "another company"}". Confirm to move them to ${company.name}.`, {
      needsConfirmation: true,
      fromCompanyId: contact.crmCompanyId,
      fromCompanyName: other?.name ?? null,
    });
  }
  const fromCompanyId = contact.crmCompanyId !== id ? contact.crmCompanyId : null;
  await runCrmMutation(actor, async (ctx) => {
    if (contact.crmCompanyId !== id) {
      await ctx.tx.crmContact.update({ where: { id: contact.id }, data: { crmCompanyId: id, updatedByUserId: actor.userId, version: { increment: 1 } } });
      await refreshContactDerived(ctx, contact.id, actor.companyId);
      await ctx.audit({ tableName: "crm_contacts", recordId: contact.id, action: "UPDATE", oldValues: { crmCompanyId: contact.crmCompanyId }, newValues: { crmCompanyId: id } });
      ctx.emit({ entityType: "CONTACT", entityId: contact.id, eventType: "contact.updated", summary: `Company: ${company.name}`, payload: { changes: { crmCompanyId: { from: contact.crmCompanyId, to: id } } } });
      ctx.emit({ entityType: "COMPANY", entityId: id, eventType: "company.contact_added", summary: contact.fullName, payload: { contactId: contact.id } });
      if (fromCompanyId) {
        ctx.emit({ entityType: "COMPANY", entityId: fromCompanyId, eventType: "company.contact_removed", summary: `${contact.fullName} moved to ${company.name}`, payload: { contactId: contact.id, toCompanyId: id } });
        await ctx.tx.crmCompany.updateMany({ where: { id: fromCompanyId, primaryContactId: contact.id }, data: { primaryContactId: null } });
      }
    }
    if (input.makePrimary || !company.primaryContactId) {
      await ctx.tx.crmCompany.update({ where: { id }, data: { primaryContactId: contact.id } });
      ctx.emit({ entityType: "COMPANY", entityId: id, eventType: "company.primary_contact_changed", summary: contact.fullName, payload: { contactId: contact.id, previousContactId: company.primaryContactId } });
    }
  });
  return { contactId: contact.id, moved: Boolean(fromCompanyId) };
}

export async function removeContactFromCompany(actor: CrmActor, id: string, contactId: string) {
  await loadEditableCompany(actor, id, "removing contacts");
  const scope = await getCrmRecordScope(actor);
  const contact = await CrmCompanyRepository.findContact(actor.companyId, contactId);
  if (!contact || contact.crmCompanyId !== id || !isWithinCrmScope(scope, contact)) throw new BusinessRuleError("NOT_FOUND", "This contact is not at this company.", { id: contactId });
  await runCrmMutation(actor, async (ctx) => {
    await ctx.tx.crmContact.update({ where: { id: contactId }, data: { crmCompanyId: null, updatedByUserId: actor.userId, version: { increment: 1 } } });
    await ctx.tx.crmCompany.updateMany({ where: { id, primaryContactId: contactId }, data: { primaryContactId: null } });
    await refreshContactDerived(ctx, contactId, actor.companyId);
    await ctx.audit({ tableName: "crm_contacts", recordId: contactId, action: "UPDATE", oldValues: { crmCompanyId: id }, newValues: { crmCompanyId: null } });
    ctx.emit({ entityType: "CONTACT", entityId: contactId, eventType: "contact.updated", summary: "Removed from company", payload: { changes: { crmCompanyId: { from: id, to: null } } } });
    ctx.emit({ entityType: "COMPANY", entityId: id, eventType: "company.contact_removed", summary: contact.fullName, payload: { contactId } });
  });
}

export async function setPrimaryContact(actor: CrmActor, id: string, raw: unknown) {
  const { contactId } = primaryContactSchema.parse(raw);
  const company = await loadEditableCompany(actor, id, "changing it");
  if (contactId === company.primaryContactId) return;
  let label = "None";
  if (contactId) {
    const contact = await CrmCompanyRepository.findContact(actor.companyId, contactId);
    if (!contact || contact.crmCompanyId !== id || contact.mergedIntoId) throw new BusinessRuleError("VALIDATION_ERROR", "The primary contact must be one of this company's contacts.");
    label = contact.fullName;
  }
  await runCrmMutation(actor, async (ctx) => {
    await ctx.tx.crmCompany.update({ where: { id }, data: { primaryContactId: contactId, updatedByUserId: actor.userId } });
    await ctx.audit({ tableName: "crm_companies", recordId: id, action: "UPDATE", oldValues: { primaryContactId: company.primaryContactId }, newValues: { primaryContactId: contactId } });
    ctx.emit({ entityType: "COMPANY", entityId: id, eventType: "company.primary_contact_changed", summary: label, payload: { contactId, previousContactId: company.primaryContactId } });
  });
}

// ── Lead relationship (crm_leads.crm_company_id) ──

/** Associates an existing (visible, unconverted or converted) lead with the company. */
export async function linkLeadToCompany(actor: CrmActor, id: string, raw: unknown) {
  const { leadId } = companyLeadLinkSchema.parse(raw);
  const company = await loadEditableCompany(actor, id, "associating leads");
  const scope = await getCrmRecordScope(actor);
  const lead = await CrmCompanyRepository.findLead(actor.companyId, leadId);
  if (!lead || !isWithinCrmScope(scope, lead)) throw new BusinessRuleError("NOT_FOUND", "Lead not found.", { id: leadId });
  if (lead.archivedAt) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "Restore this lead before associating it.");
  if (lead.crmCompanyId === id) return;
  await runCrmMutation(actor, async (ctx) => {
    await ctx.tx.crmLead.update({ where: { id: leadId }, data: { crmCompanyId: id, updatedByUserId: actor.userId, version: { increment: 1 } } });
    await ctx.audit({ tableName: "crm_leads", recordId: leadId, action: "UPDATE", oldValues: { crmCompanyId: lead.crmCompanyId }, newValues: { crmCompanyId: id } });
    ctx.emit({ entityType: "LEAD", entityId: leadId, eventType: "lead.updated", summary: `Company: ${company.name}`, payload: { changes: { crmCompanyId: { from: lead.crmCompanyId, to: id } } } });
    ctx.emit({ entityType: "COMPANY", entityId: id, eventType: "company.lead_linked", summary: `${lead.leadNumber} — ${lead.fullName}`, payload: { leadId } });
  });
}

export async function unlinkLeadFromCompany(actor: CrmActor, id: string, leadId: string) {
  await loadEditableCompany(actor, id, "changing it");
  const scope = await getCrmRecordScope(actor);
  const lead = await CrmCompanyRepository.findLead(actor.companyId, leadId);
  if (!lead || lead.crmCompanyId !== id || !isWithinCrmScope(scope, lead)) throw new BusinessRuleError("NOT_FOUND", "This lead is not associated with this company.", { id: leadId });
  await runCrmMutation(actor, async (ctx) => {
    await ctx.tx.crmLead.update({ where: { id: leadId }, data: { crmCompanyId: null, updatedByUserId: actor.userId, version: { increment: 1 } } });
    await ctx.audit({ tableName: "crm_leads", recordId: leadId, action: "UPDATE", oldValues: { crmCompanyId: id }, newValues: { crmCompanyId: null } });
    ctx.emit({ entityType: "LEAD", entityId: leadId, eventType: "lead.updated", summary: "Company link removed", payload: { changes: { crmCompanyId: { from: id, to: null } } } });
    ctx.emit({ entityType: "COMPANY", entityId: id, eventType: "company.lead_unlinked", summary: `${lead.leadNumber} — ${lead.fullName}`, payload: { leadId } });
  });
}
