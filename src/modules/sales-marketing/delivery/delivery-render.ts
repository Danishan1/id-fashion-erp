import type { CrmMessageTemplateVersion, Prisma } from "@prisma/client";
import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { renderTemplateContent, renderWithSampleData, type RenderedTemplate } from "@/modules/crm/templates/template-engine";
import type { TemplateEntity } from "@/modules/crm/templates/template-registry";
import type { MarketingChannelKey } from "./delivery-registry";
import { DELIVERY_TEMPLATE_ENTITIES } from "./delivery-render-entities";

type Db = Prisma.TransactionClient | typeof prisma;

/**
 * Message content for delivery (Phase 10): an ACTIVE CRM message template
 * (Phase 12 of the CRM) of the same channel, frozen to one version per run,
 * filled per recipient from the contact, its company and the person who
 * started the run. The ERP has no asset library yet (Sales & Marketing
 * Phase 11) and no HTML email pipeline: messages are plain text.
 */

const clean = (v: string | null | undefined) => (v == null ? null : String(v).trim() || null);
const firstWord = (v: string | null | undefined) => clean(v)?.split(/\s+/)[0] ?? null;

export { DELIVERY_TEMPLATE_ENTITIES };

export function providerMetadataOf(v: Pick<CrmMessageTemplateVersion, "providerMetadata">): Record<string, string> {
  const raw = (v.providerMetadata ?? {}) as Record<string, unknown>;
  return Object.fromEntries(Object.entries(raw).filter(([, x]) => typeof x === "string" && x.trim()).map(([k, x]) => [k, String(x).trim()]));
}

/** A usable template for this channel: ACTIVE, same channel, with its current version. */
export async function loadUsableTemplate(companyId: string, templateId: string, channel: MarketingChannelKey, db: Db = prisma) {
  const t = await db.crmMessageTemplate.findFirst({ where: { id: templateId, companyId }, include: { currentVersion: true } });
  if (!t) throw new BusinessRuleError("NOT_FOUND", "Message template not found.", { id: templateId });
  if (t.channelType !== channel) throw new BusinessRuleError("VALIDATION_ERROR", `"${t.name}" is a ${t.channelType.toLowerCase()} template; this channel sends ${channel.toLowerCase()}.`);
  if (t.status !== "ACTIVE") throw new BusinessRuleError("VALIDATION_ERROR", `"${t.name}" is ${t.status.toLowerCase()}. Activate it in CRM → Templates first.`);
  if (!t.currentVersion) throw new BusinessRuleError("VALIDATION_ERROR", `"${t.name}" has no version.`);
  return { template: t, version: t.currentVersion };
}

/** Structural check with sample data: unknown variables, variables from records delivery can't fill. */
export function checkTemplateForDelivery(v: Pick<CrmMessageTemplateVersion, "subject" | "body" | "variables">): string[] {
  const out: string[] = [];
  const sample = renderWithSampleData({ subject: v.subject, body: v.body });
  for (const i of sample.issues) if (i.severity === "error") out.push(i.message);
  const unusable = v.variables.filter((k) => !DELIVERY_TEMPLATE_ENTITIES.has(k.split(".")[0] as TemplateEntity));
  if (unusable.length) out.push(`Campaign messages can only use contact, company and user fields; this template also uses ${unusable.map((k) => `{{${k}}}`).join(", ")}.`);
  return out;
}

export function sampleRender(v: Pick<CrmMessageTemplateVersion, "subject" | "body">): RenderedTemplate {
  return renderWithSampleData({ subject: v.subject, body: v.body });
}

/** Values for a batch of contacts (one query for contacts + companies, one for the sender). */
export async function recipientValues(companyId: string, contactIds: string[], senderUserId: string, db: Db = prisma): Promise<Map<string, Record<string, string | null>>> {
  const [contacts, user] = await Promise.all([
    db.crmContact.findMany({
      where: { companyId, id: { in: contactIds } },
      select: { id: true, firstName: true, lastName: true, fullName: true, email: true, phone: true, mobile: true, whatsapp: true, designation: true, department: true, crmCompany: { select: { name: true, legalName: true, email: true, phone: true, mobile: true, website: true, city: true, state: true, postalCode: true, country: true } } },
    }),
    db.user.findFirst({ where: { id: senderUserId, companyId }, select: { fullName: true, email: true, phone: true } }),
  ]);
  const userValues = { "user.name": clean(user?.fullName), "user.first_name": firstWord(user?.fullName), "user.email": clean(user?.email), "user.phone": clean(user?.phone) };
  const out = new Map<string, Record<string, string | null>>();
  for (const c of contacts) {
    const co = c.crmCompany;
    out.set(c.id, {
      "contact.first_name": clean(c.firstName),
      "contact.last_name": clean(c.lastName),
      "contact.full_name": clean(c.fullName),
      "contact.email": clean(c.email),
      "contact.phone": clean(c.phone) ?? clean(c.mobile),
      "contact.mobile": clean(c.mobile) ?? clean(c.phone),
      "contact.whatsapp": clean(c.whatsapp) ?? clean(c.mobile),
      "contact.designation": clean(c.designation),
      "contact.department": clean(c.department),
      "contact.company": clean(co?.name),
      ...(co
        ? {
            "company.name": clean(co.name),
            "company.legal_name": clean(co.legalName) ?? clean(co.name),
            "company.email": clean(co.email),
            "company.phone": clean(co.phone) ?? clean(co.mobile),
            "company.website": clean(co.website),
            "company.city": clean(co.city),
            "company.address": [co.city, [co.state, co.postalCode].filter(Boolean).join(" "), co.country].map(clean).filter(Boolean).join(", ") || null,
          }
        : {}),
      ...userValues,
    });
  }
  return out;
}

export function renderForRecipient(v: Pick<CrmMessageTemplateVersion, "subject" | "body">, values: Record<string, string | null>, hasCompany: boolean): RenderedTemplate {
  const available = new Set<TemplateEntity>(["contact", "user", ...(hasCompany ? (["company"] as TemplateEntity[]) : [])]);
  return renderTemplateContent({ subject: v.subject, body: v.body }, { values, available });
}

/** The footer every campaign email gets — the unsubscribe path can't be left out of a template. */
export function withUnsubscribeFooter(body: string, url: string): string {
  return `${body.trimEnd()}\n\n--\nYou are receiving this because you are in our contact list. To stop receiving these emails, open:\n${url}\n`;
}

/**
 * Phase 11 rule for campaign messages: a variable with no value and no
 * fallback is an error, never a silent blank. The recipient is skipped
 * (RENDER_FAILED); authors avoid it with a fallback, e.g. {{contact.first_name|there}}.
 */
export function strictRenderProblems(rendered: Pick<RenderedTemplate, "missing">): string[] {
  return rendered.missing.filter((m) => !m.usedFallback).map((m) => (m.reason === "NO_CONTEXT" ? `{{${m.key}}}: no ${m.key.split(".")[0]} record for this recipient, and no fallback.` : `{{${m.key}}} has no value for this recipient, and no fallback.`));
}
