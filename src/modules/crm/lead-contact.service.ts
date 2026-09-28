import { z } from "zod";
import { writeAuditLog } from "@/core/audit/AuditLogger";
import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { optionalPhoneSchema } from "@/lib/validation";

interface ActorContext {
  companyId: string;
  userId: string;
}

export const leadContactSchema = z.object({
  name: z.string().min(1, "Name is required").max(150),
  designation: z.string().max(100).optional().or(z.literal("")),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
  phone: optionalPhoneSchema,
  whatsappNumber: optionalPhoneSchema,
  notes: z.string().max(1000).optional().or(z.literal("")),
});
export type LeadContactInput = z.infer<typeof leadContactSchema>;

const toData = (input: LeadContactInput) => ({
  name: input.name,
  designation: input.designation || null,
  email: input.email || null,
  phone: input.phone || null,
  whatsappNumber: input.whatsappNumber || null,
  notes: input.notes || null,
});

async function assertLeadInCompany(companyId: string, leadId: string) {
  const lead = await prisma.lead.findFirst({ where: { id: leadId, companyId }, select: { id: true } });
  if (!lead) throw new BusinessRuleError("NOT_FOUND", "Lead not found.", { leadId });
}

async function getContactInCompany(companyId: string, contactId: string) {
  const contact = await prisma.crmLeadContact.findFirst({ where: { id: contactId, companyId } });
  if (!contact) throw new BusinessRuleError("NOT_FOUND", "Contact not found.", { contactId });
  return contact;
}

export async function listLeadContacts(companyId: string, leadId: string) {
  await assertLeadInCompany(companyId, leadId);
  return prisma.crmLeadContact.findMany({ where: { companyId, leadId }, orderBy: { createdAt: "asc" } });
}

export async function createLeadContact(actor: ActorContext, leadId: string, input: LeadContactInput) {
  await assertLeadInCompany(actor.companyId, leadId);
  const contact = await prisma.crmLeadContact.create({ data: { companyId: actor.companyId, leadId, ...toData(input) } });
  await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName: "crm_lead_contacts", recordId: contact.id, action: "CREATE", newValues: contact });
  return contact;
}

export async function updateLeadContact(actor: ActorContext, contactId: string, input: LeadContactInput) {
  const existing = await getContactInCompany(actor.companyId, contactId);
  const updated = await prisma.crmLeadContact.update({ where: { id: contactId }, data: toData(input) });
  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "crm_lead_contacts",
    recordId: contactId,
    action: "UPDATE",
    oldValues: existing,
    newValues: updated,
  });
  return updated;
}

/** A contact row is plain reference data (no transactional history hangs off
 * it), so a real delete is appropriate — the audit log keeps what it was. */
export async function deleteLeadContact(actor: ActorContext, contactId: string) {
  const existing = await getContactInCompany(actor.companyId, contactId);
  await prisma.crmLeadContact.delete({ where: { id: contactId } });
  await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName: "crm_lead_contacts", recordId: contactId, action: "DELETE", oldValues: existing });
  return { id: contactId };
}
