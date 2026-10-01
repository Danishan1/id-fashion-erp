import type { CrmDuplicatePolicy, CrmIngestOutcome, CrmLeadCaptureChannel } from "@prisma/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import type { CrmActor } from "../core/crm-actor";
import { getCrmRecordScope, isWithinCrmScope } from "../core/crm-visibility";
import { CrmContactRepository } from "../contacts/crm-contact.repository";
import { contactKeys } from "../contacts/crm-contacts.service";
import { listCustomFields, validateCustomFieldValues } from "../custom-fields/crm-custom-fields.service";
import type { CrmCustomFieldDefinitionDto } from "../custom-fields/crm-custom-field-types";
import { activeRules, findLeadDuplicates, leadContactKeys, type LeadContactKeys, type LeadDuplicateMatch } from "../leads/lead-duplicates";
import { createLeadSchema, type CreateLeadInput } from "../leads/lead.schema";
import { createLead, fillEmptyLeadFields } from "../leads/lead.service";
import type { LeadDuplicateRule } from "../settings/crm-defaults";
import { getLeadDuplicateRules, listLeadSources, listLeadStatuses } from "../settings/crm-settings.service";
import { LeadIngestRepository } from "./lead-ingest.repository";
import { normalizeLeadRecord, type IngestMessage, type NormalizeOptions } from "./lead-normalizer";

/**
 * CRM Lead Ingestion Service — the one pipeline every non-interactive lead
 * source goes through (CSV/XLSX import rows, the REST API, webhooks and, in
 * later phases, Meta / IndiaMART / Google / LinkedIn / trade-portal
 * adapters). Adapters only translate their payload into a mapped record;
 * everything below is shared:
 *
 *   mapped record → normalize → resolve lookups → validate
 *     → duplicate check (existing leads, contacts, external id)
 *     → duplicate policy (SKIP / UPDATE / CREATE / FLAG_FOR_REVIEW)
 *     → createLead / fillEmptyLeadFields (lead.service — audit + timeline)
 *
 * The interactive manual form keeps its warn-and-confirm flow but enters
 * through `captureManualLead` here, so all channels share one entry point.
 */

export interface IngestContext {
  channel: CrmLeadCaptureChannel;
  /** Adapter / connector name, e.g. "csv", "api", "generic", "facebook". */
  provider: string;
  duplicatePolicy: CrmDuplicatePolicy;
  /** Lead source used when the record doesn't name a known one. */
  defaultSourceId?: string | null;
  defaultSourceKey?: string;
  /** undefined → the acting user owns new leads; null → unassigned. */
  defaultOwnerUserId?: string | null;
  importJobId?: string | null;
  /** Human label for timelines and audit, e.g. "import leads.csv" or "API key Website". */
  via: string;
  normalize?: NormalizeOptions;
}

export interface IngestLookups {
  statuses: Map<string, { id: string; kind: string; isActive: boolean; name: string }>;
  sources: Map<string, { id: string; isActive: boolean; name: string }>;
  users: Map<string, { id: string; fullName: string }>;
  customFields: CrmCustomFieldDefinitionDto[];
  rules: LeadDuplicateRule[];
}

export interface PreparedLead {
  /** Body for createLeadSchema / fillEmptyLeadFields (already validated when validation ≠ ERROR). */
  input: Record<string, unknown>;
  externalId: string | null;
  messages: IngestMessage[];
  validation: "VALID" | "WARNING" | "ERROR";
  keys: LeadContactKeys;
}

export interface DuplicateSummary {
  leadMatches: LeadDuplicateMatch[];
  contactMatches: { id: string; fullName: string; email: string | null; phone: string | null; crmCompanyId: string | null }[];
  externalMatch: { leadId: string; leadNumber: string } | null;
  blocking: boolean;
}

export interface IngestResult {
  outcome: Exclude<CrmIngestOutcome, "PENDING">;
  reason: string | null;
  leadId: string | null;
  leadNumber: string | null;
  messages: IngestMessage[];
  duplicates: DuplicateSummary | null;
  /** True for unexpected (infrastructure) failures worth retrying; false for data problems. */
  retryable?: boolean;
}

const key = (s: string) => s.trim().toLowerCase();

/** Status / source / owner / custom-field / rule lookups, loaded once per batch. */
export async function loadIngestLookups(companyId: string): Promise<IngestLookups> {
  const [statuses, sources, users, customFields, rules] = await Promise.all([
    listLeadStatuses(companyId),
    listLeadSources(companyId),
    LeadIngestRepository.activeUsers(companyId),
    listCustomFields(companyId, "LEAD", { includeInactive: true }),
    getLeadDuplicateRules(companyId),
  ]);
  const statusMap = new Map<string, { id: string; kind: string; isActive: boolean; name: string }>();
  for (const s of statuses) for (const k of [s.key, s.name]) statusMap.set(key(k), s);
  const sourceMap = new Map<string, { id: string; isActive: boolean; name: string }>();
  for (const s of sources) for (const k of [s.key, s.name]) sourceMap.set(key(k), s);
  const userMap = new Map<string, { id: string; fullName: string }>();
  for (const u of users) for (const k of [u.email, u.fullName]) userMap.set(key(k), u);
  return { statuses: statusMap, sources: sourceMap, users: userMap, customFields, rules };
}

function firstZodMessage(issues: { path: PropertyKey[]; message: string }[]): IngestMessage[] {
  return issues.map((i) => ({ level: "error" as const, field: String(i.path[0] ?? ""), message: `${String(i.path[0] ?? "Value")}: ${i.message}` }));
}

/** Normalize + resolve + validate one mapped record. No database writes. */
export function prepareLead(mapped: Record<string, unknown>, ctx: IngestContext, lookups: IngestLookups): PreparedLead {
  const { values, messages } = normalizeLeadRecord(mapped, ctx.normalize);
  const input: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) {
    if (["status", "source", "owner", "tags", "externalId", "customFields"].includes(k)) continue;
    input[k] = v;
  }

  if (typeof values.status === "string") {
    const s = lookups.statuses.get(key(values.status));
    if (!s || !s.isActive) messages.push({ level: "warning", field: "status", message: `Status "${values.status}" not found — the default status is used.` });
    else if (s.kind === "CONVERTED") messages.push({ level: "warning", field: "status", message: `Leads can't be imported as "${s.name}" — the default status is used.` });
    else input.statusId = s.id;
  }
  const sourceText = typeof values.source === "string" ? values.source : null;
  const source = sourceText ? lookups.sources.get(key(sourceText)) : undefined;
  if (sourceText && (!source || !source.isActive)) messages.push({ level: "warning", field: "source", message: `Source "${sourceText}" not found — the import's source is used.` });
  if (source?.isActive) input.sourceId = source.id;
  else if (ctx.defaultSourceId) input.sourceId = ctx.defaultSourceId;

  if (typeof values.owner === "string") {
    const u = lookups.users.get(key(values.owner));
    if (u) input.ownerUserId = u.id;
    else messages.push({ level: "warning", field: "owner", message: `Owner "${values.owner}" is not an active user — ${ctx.defaultOwnerUserId === null ? "left unassigned" : "the default owner is used"}.` });
  }
  if (input.ownerUserId === undefined && ctx.defaultOwnerUserId !== undefined) input.ownerUserId = ctx.defaultOwnerUserId;
  if (Array.isArray(values.tags)) input.tagNames = values.tags;

  if (values.customFields) {
    try {
      input.customFields = validateCustomFieldValues(lookups.customFields, values.customFields);
    } catch (e) {
      const fieldErrors = (e as BusinessRuleError).details?.fieldErrors as Record<string, string> | undefined;
      for (const [f, m] of Object.entries(fieldErrors ?? { customFields: (e as Error).message })) messages.push({ level: "error", field: f, message: m });
    }
  } else {
    // Required custom fields still apply to imported leads.
    try {
      validateCustomFieldValues(lookups.customFields, {});
    } catch (e) {
      const fieldErrors = (e as BusinessRuleError).details?.fieldErrors as Record<string, string> | undefined;
      for (const [f, m] of Object.entries(fieldErrors ?? {})) messages.push({ level: "error", field: f, message: m });
    }
  }

  const hasContact = ["email", "alternateEmail", "phone", "mobile", "whatsapp"].some((k) => typeof input[k] === "string" && (input[k] as string).length > 0);
  if (!hasContact && !messages.some((m) => m.level === "error" && ["email", "phone", "mobile", "whatsapp"].includes(m.field ?? ""))) {
    messages.push({ level: "error", field: "email", message: "Missing contact details — add an email or a phone number." });
  }
  if (!input.firstName) messages.push({ level: "error", field: "firstName", message: "Missing name — map a name or company column." });

  const parsed = createLeadSchema.safeParse({ ...input, confirmDuplicate: true });
  if (!parsed.success) {
    const already = new Set(messages.filter((m) => m.level === "error").map((m) => m.field));
    messages.push(...firstZodMessage(parsed.error.issues).filter((m) => !already.has(m.field)));
  }

  const validation = messages.some((m) => m.level === "error") ? "ERROR" : messages.some((m) => m.level === "warning") ? "WARNING" : "VALID";
  return {
    input,
    externalId: typeof values.externalId === "string" ? values.externalId.slice(0, 200) : null,
    messages,
    validation,
    keys: leadContactKeys(input as Parameters<typeof leadContactKeys>[0]),
  };
}

async function findExternalMatch(companyId: string, provider: string, externalId: string | null) {
  return externalId ? LeadIngestRepository.externalLead(companyId, provider, externalId) : null;
}

/** Existing leads (company duplicate rules), contacts (email/phone rules) and the external id. */
export async function findIngestDuplicates(companyId: string, prepared: PreparedLead, ctx: IngestContext, rules: LeadDuplicateRule[]): Promise<DuplicateSummary> {
  const active = activeRules(rules);
  const [leads, externalMatch] = await Promise.all([findLeadDuplicates(companyId, prepared.keys, undefined, rules), findExternalMatch(companyId, ctx.provider, prepared.externalId)]);
  let contactMatches: DuplicateSummary["contactMatches"] = [];
  const emailRule = active.some((r) => r.rule === "EMAIL");
  const phoneRule = active.some((r) => r.rule === "PHONE");
  if (emailRule || phoneRule) {
    const ck = contactKeys(prepared.input as Parameters<typeof contactKeys>[0]);
    const found = await CrmContactRepository.findMatches(companyId, emailRule ? ck.emailKeys : [], phoneRule ? ck.phoneKeys : []);
    contactMatches = found.map((c) => ({ id: c.id, fullName: c.fullName, email: c.email, phone: c.phone ?? c.mobile ?? null, crmCompanyId: c.crmCompanyId ?? null }));
  }
  return { leadMatches: leads.matches, contactMatches, externalMatch, blocking: leads.blocking };
}

function describeMatch(m: LeadDuplicateMatch, ctx: IngestContext) {
  const why = m.rules.map((r) => r.toLowerCase().replace(/_/g, " ")).join(", ");
  const sameJob = ctx.importJobId && m.importJobId === ctx.importJobId ? " (created from an earlier row of this file)" : "";
  return `${m.leadNumber} ${m.fullName}${sameJob} — same ${why}`;
}

/**
 * Apply the duplicate policy to a prepared record and perform the write.
 * Never throws for data problems — every record ends with an outcome and a
 * reason (IMPORTED / UPDATED / SKIPPED / FLAGGED / FAILED).
 */
export async function ingestPreparedLead(actor: CrmActor, prepared: PreparedLead, ctx: IngestContext, lookups: Pick<IngestLookups, "rules">): Promise<IngestResult> {
  const base = { messages: prepared.messages, duplicates: null as DuplicateSummary | null };
  if (prepared.validation === "ERROR") {
    const first = prepared.messages.find((m) => m.level === "error");
    return { ...base, outcome: "FAILED", reason: first?.message ?? "Invalid record.", leadId: null, leadNumber: null };
  }
  let dup: DuplicateSummary;
  try {
    dup = await findIngestDuplicates(actor.companyId, prepared, ctx, lookups.rules);
  } catch (e) {
    return { ...base, outcome: "FAILED", reason: `Duplicate check failed: ${(e as Error).message}`, retryable: true, leadId: null, leadNumber: null };
  }
  base.duplicates = dup;
  const policy = ctx.duplicatePolicy;
  const externalRef = prepared.externalId ? { provider: ctx.provider, externalId: prepared.externalId } : null;

  // Same external lead delivered again: never a second lead.
  if (dup.externalMatch) {
    if (policy === "UPDATE") return update(actor, dup.externalMatch.leadId, prepared, ctx, base, `same external id ${prepared.externalId}`);
    if (policy === "FLAG_FOR_REVIEW") return { ...base, outcome: "FLAGGED", reason: `Already received as ${dup.externalMatch.leadNumber} (external id ${prepared.externalId}).`, leadId: null, leadNumber: null };
    return { ...base, outcome: "SKIPPED", reason: `Already received as ${dup.externalMatch.leadNumber} (external id ${prepared.externalId}).`, leadId: dup.externalMatch.leadId, leadNumber: dup.externalMatch.leadNumber };
  }

  if (dup.leadMatches.length) {
    const summary = dup.leadMatches.slice(0, 3).map((m) => describeMatch(m, ctx)).join("; ");
    if (policy === "SKIP") return { ...base, outcome: "SKIPPED", reason: `Possible duplicate of ${summary}.`, leadId: null, leadNumber: null };
    if (policy === "FLAG_FOR_REVIEW") return { ...base, outcome: "FLAGGED", reason: `Possible duplicate of ${summary}.`, leadId: null, leadNumber: null };
    if (policy === "CREATE") {
      if (dup.blocking) return { ...base, outcome: "SKIPPED", reason: `Your duplicate rules block creating another lead like ${summary}.`, leadId: null, leadNumber: null };
      return create(actor, prepared, ctx, base, externalRef, null);
    }
    // UPDATE
    const open = dup.leadMatches.filter((m) => !m.archived);
    if (!open.length) return { ...base, outcome: "SKIPPED", reason: `Matches only archived lead(s): ${summary}. Restore it to update, or import with Create.`, leadId: null, leadNumber: null };
    if (open.length > 1) return { ...base, outcome: "FLAGGED", reason: `Matches ${open.length} leads (${summary}) — choose which one to update.`, leadId: null, leadNumber: null };
    const target = open[0];
    const scope = await getCrmRecordScope(actor);
    if (!isWithinCrmScope(scope, target)) return { ...base, outcome: "FLAGGED", reason: `Matches ${target.leadNumber}, which belongs to someone else — needs review by a manager.`, leadId: null, leadNumber: null };
    return update(actor, target.id, prepared, ctx, base, describeMatch(target, ctx));
  }

  if (dup.contactMatches.length) {
    const c = dup.contactMatches[0];
    const label = `existing contact ${c.fullName}${c.email ? ` (${c.email})` : c.phone ? ` (${c.phone})` : ""}`;
    if (policy === "SKIP") return { ...base, outcome: "SKIPPED", reason: `Matches ${label}.`, leadId: null, leadNumber: null };
    if (policy === "FLAG_FOR_REVIEW") return { ...base, outcome: "FLAGGED", reason: `Matches ${label}.`, leadId: null, leadNumber: null };
    // UPDATE / CREATE: a new lead, linked to the contact we already know.
    return create(actor, prepared, ctx, base, externalRef, dup.contactMatches.length === 1 ? c : null);
  }

  return create(actor, prepared, ctx, base, externalRef, null);
}

async function create(
  actor: CrmActor,
  prepared: PreparedLead,
  ctx: IngestContext,
  base: { messages: IngestMessage[]; duplicates: DuplicateSummary | null },
  externalRef: { provider: string; externalId: string } | null,
  linkContact: { id: string; crmCompanyId: string | null; fullName: string } | null
): Promise<IngestResult> {
  try {
    const input = { ...prepared.input, ...(linkContact ? { crmContactId: linkContact.id, crmCompanyId: linkContact.crmCompanyId ?? undefined } : {}) };
    const lead = await createLead(actor, input, {
      channel: ctx.channel,
      provider: ctx.provider,
      importJobId: ctx.importJobId ?? null,
      externalRef,
      duplicatesReviewed: true,
      trustedLinks: Boolean(linkContact),
      sourceKey: ctx.defaultSourceKey,
    });
    return {
      ...base,
      outcome: "IMPORTED",
      reason: linkContact ? `Created and linked to existing contact ${linkContact.fullName}.` : null,
      leadId: lead.id,
      leadNumber: lead.leadNumber,
    };
  } catch (e) {
    return { ...base, outcome: "FAILED", reason: errorReason(e), retryable: isRetryable(e), leadId: null, leadNumber: null };
  }
}

async function update(
  actor: CrmActor,
  leadId: string,
  prepared: PreparedLead,
  ctx: IngestContext,
  base: { messages: IngestMessage[]; duplicates: DuplicateSummary | null },
  matchLabel: string
): Promise<IngestResult> {
  try {
    const { lead, changedFields, addedNote } = await fillEmptyLeadFields(actor, leadId, { ...prepared.input, confirmDuplicate: true }, {
      channel: ctx.channel,
      provider: ctx.provider,
      importJobId: ctx.importJobId ?? null,
      externalRef: prepared.externalId ? { provider: ctx.provider, externalId: prepared.externalId } : null,
      via: ctx.via,
    });
    if (!changedFields.length && !addedNote) {
      return { ...base, outcome: "SKIPPED", reason: `${lead.leadNumber} already has this information (matched ${matchLabel}).`, leadId: lead.id, leadNumber: lead.leadNumber };
    }
    const what = [changedFields.length ? `filled ${changedFields.length} empty field(s)` : null, addedNote ? "added the new requirement as a note" : null].filter(Boolean).join(" and ");
    return { ...base, outcome: "UPDATED", reason: `Updated ${lead.leadNumber}: ${what}.`, leadId: lead.id, leadNumber: lead.leadNumber };
  } catch (e) {
    return { ...base, outcome: "FAILED", reason: errorReason(e), retryable: isRetryable(e), leadId: null, leadNumber: null };
  }
}

function isRetryable(e: unknown): boolean {
  return !(e instanceof BusinessRuleError) && !(e && typeof e === "object" && "issues" in e);
}

function errorReason(e: unknown): string {
  if (e instanceof BusinessRuleError) return e.message;
  if (e && typeof e === "object" && "issues" in e) {
    const issues = (e as { issues: { path: PropertyKey[]; message: string }[] }).issues;
    return issues.map((i) => `${String(i.path[0] ?? "")}: ${i.message}`).join("; ");
  }
  return `Unexpected error: ${(e as Error)?.message ?? String(e)}`;
}

/** One-call ingestion for a single mapped record (API, webhook, adapters). */
export async function ingestLead(actor: CrmActor, mapped: Record<string, unknown>, ctx: IngestContext, lookups?: IngestLookups): Promise<IngestResult & { prepared: PreparedLead }> {
  const l = lookups ?? (await loadIngestLookups(actor.companyId));
  const prepared = prepareLead(mapped, ctx, l);
  const result = await ingestPreparedLead(actor, prepared, ctx, l);
  return { ...result, prepared };
}

/** Explicit decision on a flagged record (review screen): create anyway, update a chosen lead, or skip. */
export async function resolveFlaggedLead(
  actor: CrmActor,
  prepared: Pick<PreparedLead, "input" | "externalId">,
  ctx: IngestContext,
  decision: { action: "CREATE" } | { action: "UPDATE"; leadId: string } | { action: "SKIP" }
): Promise<IngestResult> {
  const full: PreparedLead = { ...prepared, messages: [], validation: "VALID", keys: leadContactKeys(prepared.input as Parameters<typeof leadContactKeys>[0]) };
  const base = { messages: [], duplicates: null };
  if (decision.action === "SKIP") return { ...base, outcome: "SKIPPED", reason: "Skipped on review.", leadId: null, leadNumber: null };
  if (decision.action === "UPDATE") {
    const scope = await getCrmRecordScope(actor);
    const target = await LeadIngestRepository.leadForReview(actor.companyId, decision.leadId);
    if (!target || !isWithinCrmScope(scope, target)) return { ...base, outcome: "FAILED", reason: "Lead not found.", leadId: null, leadNumber: null };
    return update(actor, target.id, full, ctx, base, `${target.leadNumber} (chosen on review)`);
  }
  const externalRef = prepared.externalId ? { provider: ctx.provider, externalId: prepared.externalId } : null;
  if (externalRef && (await findExternalMatch(actor.companyId, externalRef.provider, externalRef.externalId))) {
    return { ...base, outcome: "SKIPPED", reason: `External id ${externalRef.externalId} was already received.`, leadId: null, leadNumber: null };
  }
  return create(actor, full, ctx, base, externalRef, null);
}

/** The manual lead form's entry point: same lead service, interactive warn-and-confirm duplicates. */
export function captureManualLead(actor: CrmActor, raw: unknown) {
  return createLead(actor, raw, { channel: "MANUAL", provider: null });
}

export type { CreateLeadInput };
