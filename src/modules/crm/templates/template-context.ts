import type { CrmEntityType } from "@prisma/client";
import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { formatCurrency } from "@/lib/currency";
import type { CrmActor } from "../core/crm-actor";
import type { CrmSystemActor } from "../core/crm-mutation";
import { formatZonedDate, formatZonedTime, zoneAbbreviation } from "../core/crm-timezone";
import { assertCrmEntityAccess } from "../crm-entity-access";
import type { RenderContext } from "./template-engine";
import { TEMPLATE_VARIABLES, type TemplateEntity } from "./template-registry";
import { templateContextRefsSchema, type TemplateContextRefs } from "./template.schema";

/**
 * Builds the flat `{ "contact.first_name": "Rahul", … }` map a template is
 * rendered with, from CRM record ids. One query per record type — never one
 * per variable — and only the fields the registry exposes, so a template can
 * never reach other columns.
 *
 * Related records are filled in when not given: a conversation brings its
 * contact / company / opportunity, an opportunity its contact + company, a
 * contact its company, an appointment the record it was booked on. Records
 * given explicitly must be visible to the user (same rule as their pages);
 * related ones the user can't see are left out (their variables then render
 * as missing). `user` is the sender (the acting ERP user) unless given.
 *
 * Adding an entity: one TEMPLATE_ENTITIES entry + variables in
 * template-registry.ts, and one loader below.
 */

export { templateContextRefsSchema, type TemplateContextRefs };

type Values = Record<string, string | null>;
type Ids = Partial<Record<TemplateEntity, string>>;

const clean = (v: string | null | undefined) => (v == null ? null : String(v).trim() || null);
const join = (parts: (string | null | undefined)[], sep = ", ") => parts.map(clean).filter(Boolean).join(sep) || null;
const firstWord = (v: string | null | undefined) => clean(v)?.split(/\s+/)[0] ?? null;
const dateOnly = (d: Date | null | undefined) => (d ? d.toLocaleDateString("en-IN", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }) : null);
const money = (amount: unknown, currency: string | null | undefined) => (amount == null ? null : join([currency ?? null, formatCurrency(String(amount))], " "));

async function canSee(actor: CrmActor | CrmSystemActor, type: CrmEntityType, id: string): Promise<boolean> {
  if (actor.userId === null) return true; // system work (automation) has no visibility scope
  try {
    await assertCrmEntityAccess(actor as CrmActor, type, id);
    return true;
  } catch (e) {
    if (e instanceof BusinessRuleError && e.code === "NOT_FOUND") return false;
    throw e;
  }
}

async function requireVisible(actor: CrmActor | CrmSystemActor, type: CrmEntityType, id: string, label: string) {
  if (!(await canSee(actor, type, id))) throw new BusinessRuleError("NOT_FOUND", `${label} not found.`, { entityType: type, id });
}

// ── Loaders (one query each) ────────────────────────────────────

async function loadContact(companyId: string, id: string, values: Values) {
  const c = await prisma.crmContact.findFirst({
    where: { id, companyId },
    select: { firstName: true, lastName: true, fullName: true, email: true, phone: true, mobile: true, whatsapp: true, designation: true, department: true, crmCompanyId: true, crmCompany: { select: { name: true } } },
  });
  if (!c) return null;
  Object.assign(values, {
    "contact.first_name": clean(c.firstName),
    "contact.last_name": clean(c.lastName),
    "contact.full_name": clean(c.fullName),
    "contact.email": clean(c.email),
    "contact.phone": clean(c.phone) ?? clean(c.mobile),
    "contact.mobile": clean(c.mobile) ?? clean(c.phone),
    "contact.whatsapp": clean(c.whatsapp) ?? clean(c.mobile),
    "contact.designation": clean(c.designation),
    "contact.department": clean(c.department),
    "contact.company": clean(c.crmCompany?.name),
  });
  return { companyId: c.crmCompanyId };
}

async function loadCompany(companyId: string, id: string, values: Values) {
  const c = await prisma.crmCompany.findFirst({ where: { id, companyId }, select: { name: true, legalName: true, email: true, phone: true, mobile: true, website: true, city: true, state: true, postalCode: true, country: true } });
  if (!c) return false;
  Object.assign(values, {
    "company.name": clean(c.name),
    "company.legal_name": clean(c.legalName) ?? clean(c.name),
    "company.email": clean(c.email),
    "company.phone": clean(c.phone) ?? clean(c.mobile),
    "company.website": clean(c.website),
    "company.city": clean(c.city),
    "company.address": join([c.city, join([c.state, c.postalCode], " "), c.country]),
  });
  return true;
}

async function loadOpportunity(companyId: string, id: string, values: Values) {
  const o = await prisma.crmOpportunity.findFirst({
    where: { id, companyId },
    select: { name: true, opportunityNumber: true, amount: true, currencyCode: true, probability: true, expectedCloseDate: true, crmContactId: true, crmCompanyId: true, stage: { select: { name: true } }, pipeline: { select: { name: true } }, owner: { select: { fullName: true } } },
  });
  if (!o) return null;
  Object.assign(values, {
    "opportunity.name": clean(o.name),
    "opportunity.number": clean(o.opportunityNumber),
    "opportunity.value": money(o.amount, o.currencyCode),
    "opportunity.stage": clean(o.stage?.name),
    "opportunity.pipeline": clean(o.pipeline?.name),
    "opportunity.probability": o.probability == null ? null : `${o.probability}%`,
    "opportunity.expected_close_date": dateOnly(o.expectedCloseDate),
    "opportunity.owner": clean(o.owner?.fullName),
  });
  return { contactId: o.crmContactId, companyId: o.crmCompanyId };
}

async function loadLead(companyId: string, id: string, values: Values) {
  const l = await prisma.crmLead.findFirst({ where: { id, companyId }, select: { fullName: true, firstName: true, leadNumber: true, score: true, companyName: true, status: { select: { name: true } }, source: { select: { name: true } } } });
  if (!l) return false;
  Object.assign(values, {
    "lead.full_name": clean(l.fullName),
    "lead.first_name": clean(l.firstName),
    "lead.number": clean(l.leadNumber),
    "lead.source": clean(l.source?.name),
    "lead.status": clean(l.status?.name),
    "lead.score": String(l.score),
    "lead.company_name": clean(l.companyName),
  });
  return true;
}

async function loadUser(companyId: string, id: string, values: Values) {
  const u = await prisma.user.findFirst({ where: { id, companyId }, select: { fullName: true, email: true, phone: true } });
  if (!u) return false;
  Object.assign(values, { "user.name": clean(u.fullName), "user.first_name": firstWord(u.fullName), "user.email": clean(u.email), "user.phone": clean(u.phone) });
  return true;
}

async function loadAppointment(companyId: string, id: string, values: Values) {
  const a = await prisma.crmActivity.findFirst({ where: { id, companyId, type: "APPOINTMENT", deletedAt: null }, select: { subject: true, dueAt: true, endAt: true, timezone: true, location: true, videoLink: true, entityType: true, entityId: true } });
  if (!a) return null;
  const tz = a.timezone || "Asia/Kolkata";
  Object.assign(values, {
    "appointment.title": clean(a.subject),
    "appointment.date": a.dueAt ? formatZonedDate(a.dueAt, tz) : null,
    "appointment.time": a.dueAt ? formatZonedTime(a.dueAt, tz) : null,
    "appointment.end_time": a.endAt ? formatZonedTime(a.endAt, tz) : null,
    "appointment.timezone": a.dueAt ? zoneAbbreviation(a.dueAt, tz) : null,
    "appointment.location": clean(a.location),
    "appointment.meeting_link": clean(a.videoLink),
  });
  return { entityType: a.entityType, entityId: a.entityId };
}

// ── Builder ─────────────────────────────────────────────────────

/**
 * Resolves record ids into a render context. Explicitly named records must be
 * visible to the actor (404 otherwise); related records are best-effort.
 */
export async function buildTemplateContext(actor: CrmActor | CrmSystemActor, rawRefs: unknown): Promise<RenderContext & { records: Ids }> {
  const refs = templateContextRefsSchema.parse(rawRefs ?? {});
  const companyId = actor.companyId;
  const ids: Ids = {};
  const values: Values = Object.fromEntries(TEMPLATE_VARIABLES.map((d) => [d.key, null]));
  const available = new Set<TemplateEntity>();

  // Explicit records first (visibility enforced).
  if (refs.conversationId) {
    await requireVisible(actor, "CONVERSATION", refs.conversationId, "Conversation");
    const conv = await prisma.crmConversation.findFirst({ where: { id: refs.conversationId, companyId }, select: { contactId: true, crmCompanyId: true, opportunityId: true } });
    if (conv) {
      if (conv.contactId && !refs.contactId && (await canSee(actor, "CONTACT", conv.contactId))) ids.contact = conv.contactId;
      if (conv.crmCompanyId && !refs.companyId && (await canSee(actor, "COMPANY", conv.crmCompanyId))) ids.company = conv.crmCompanyId;
      if (conv.opportunityId && !refs.opportunityId && (await canSee(actor, "OPPORTUNITY", conv.opportunityId))) ids.opportunity = conv.opportunityId;
    }
  }
  if (refs.contactId) {
    await requireVisible(actor, "CONTACT", refs.contactId, "Contact");
    ids.contact = refs.contactId;
  }
  if (refs.companyId) {
    await requireVisible(actor, "COMPANY", refs.companyId, "Company");
    ids.company = refs.companyId;
  }
  if (refs.opportunityId) {
    await requireVisible(actor, "OPPORTUNITY", refs.opportunityId, "Opportunity");
    ids.opportunity = refs.opportunityId;
  }
  if (refs.leadId) {
    await requireVisible(actor, "LEAD", refs.leadId, "Lead");
    ids.lead = refs.leadId;
  }
  if (refs.appointmentId) {
    await requireVisible(actor, "ACTIVITY", refs.appointmentId, "Appointment");
    ids.appointment = refs.appointmentId;
  }

  // Load, deriving related records the user can see.
  if (ids.appointment) {
    const link = await loadAppointment(companyId, ids.appointment, values);
    if (!link) throw new BusinessRuleError("NOT_FOUND", "Appointment not found.", { id: ids.appointment });
    available.add("appointment");
    const key = ({ CONTACT: "contact", COMPANY: "company", OPPORTUNITY: "opportunity", LEAD: "lead" } as const)[link.entityType as "CONTACT" | "COMPANY" | "OPPORTUNITY" | "LEAD"];
    if (key && !ids[key] && (await canSee(actor, link.entityType, link.entityId))) ids[key] = link.entityId;
  }
  if (ids.opportunity) {
    const rel = await loadOpportunity(companyId, ids.opportunity, values);
    if (rel) {
      available.add("opportunity");
      if (rel.contactId && !ids.contact && (await canSee(actor, "CONTACT", rel.contactId))) ids.contact = rel.contactId;
      if (rel.companyId && !ids.company && (await canSee(actor, "COMPANY", rel.companyId))) ids.company = rel.companyId;
    }
  }
  if (ids.contact) {
    const rel = await loadContact(companyId, ids.contact, values);
    if (rel) {
      available.add("contact");
      if (rel.companyId && !ids.company && (await canSee(actor, "COMPANY", rel.companyId))) ids.company = rel.companyId;
    }
  }
  if (ids.company && (await loadCompany(companyId, ids.company, values))) available.add("company");
  if (ids.lead && (await loadLead(companyId, ids.lead, values))) available.add("lead");

  const userId = refs.userId ?? actor.userId;
  if (userId) {
    if (await loadUser(companyId, userId, values)) {
      available.add("user");
      ids.user = userId;
    } else if (refs.userId) throw new BusinessRuleError("NOT_FOUND", "User not found.", { id: refs.userId });
  }
  return { values, available, records: ids };
}
