import type { CrmLead, CrmLeadCaptureChannel, Prisma } from "@prisma/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { generateDocumentNumber } from "@/core/numbering/DocumentNumberingService";
import type { CrmActor } from "../core/crm-actor";
import { runCrmMutation, type CrmMutationContext } from "../core/crm-mutation";
import { buildSearchText, fullNameOf } from "../core/crm-normalize";
import { crmOwnerWhere, getCrmRecordScope, type CrmRecordScope } from "../core/crm-visibility";
import { createCrmCompanyInMutation, findCompanyNameMatches, getCrmCompanyForActor } from "../companies/crm-companies.service";
import { createCrmContactInMutation, findContactMatches, getCrmContactForActor } from "../contacts/crm-contacts.service";
import { CrmContactRepository } from "../contacts/crm-contact.repository";
import { listCustomFields, validateCustomFieldValues } from "../custom-fields/crm-custom-fields.service";
import { createOpportunityInMutation, reserveOpportunityNumber } from "../opportunities/crm-opportunities.service";
import {
  getConvertedLeadStatus,
  getDefaultLeadStatus,
  getLeadSourceByKey,
  getLeadSourceForCompany,
  getLeadStatusForCompany,
  listLeadSources,
  listLeadStatuses,
} from "../settings/crm-settings.service";
import { applyEntityTagChange, tagsByEntity } from "../tags/crm-tags.service";
import type { EntityTagChange } from "../tags/crm-tag.schema";
import { assertNoBlockingDuplicates, findLeadDuplicates, leadContactKeys } from "./lead-duplicates";
import { buildLeadOrderBy, buildLeadWhere } from "./lead-filters";
import { LeadRepository, type LeadListRow } from "./lead.repository";
import {
  assignLeadSchema,
  bulkLeadSchema,
  changeLeadStatusSchema,
  convertLeadSchema,
  createLeadSchema,
  createOpportunityFromLeadSchema,
  duplicateCheckSchema,
  updateLeadSchema,
  type CreateLeadInput,
  type LeadFilter,
  type LeadSortField,
  type UpdateLeadInput,
} from "./lead.schema";

/**
 * Lead management service. Every external lead source (manual entry, import,
 * API, Facebook, IndiaMART, … — see CRM_INTEGRATION_AWARENESS.md) must create
 * leads through `createLead` so validation, duplicate rules, numbering, audit
 * and timeline events are identical whatever the channel.
 */

const TABLE = "crm_leads";
const blank = (v: unknown) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");
const textOrNull = (v: string | null | undefined) => (blank(v) ? null : (v as string).trim());

// ── Reads ────────────────────────────────────────────────────────

function presentListRow(row: LeadListRow, tags: { id: string; name: string; color: string | null }[]) {
  return { ...row, ownerInactive: row.owner ? row.owner.status !== "ACTIVE" : false, tags };
}
export type LeadListItem = ReturnType<typeof presentListRow>;

export async function listLeads(actor: CrmActor, filter: LeadFilter, sort: { sortBy: LeadSortField; sortOrder: "asc" | "desc" }, page: { skip: number; take: number }) {
  const scope = await getCrmRecordScope(actor);
  const tagMatched = filter.tagIds?.length ? (await LeadRepository.entityIdsWithAnyTag(actor.companyId, "LEAD", filter.tagIds)).map((r) => r.entityId) : undefined;
  const where = buildLeadWhere(actor.companyId, filter, scope, tagMatched);
  const [rows, totalCount] = await Promise.all([
    LeadRepository.findMany(where, buildLeadOrderBy(sort.sortBy, sort.sortOrder), page.skip, page.take),
    LeadRepository.count(where),
  ]);
  const tags = await tagsByEntity(actor.companyId, "LEAD", rows.map((r) => r.id));
  return { data: rows.map((r) => presentListRow(r, tags.get(r.id) ?? [])), totalCount };
}

function scopedWhere(actor: CrmActor, scope: CrmRecordScope, id: string): Prisma.CrmLeadWhereInput {
  return { AND: [{ id, companyId: actor.companyId }, crmOwnerWhere(scope) as Prisma.CrmLeadWhereInput] };
}

/** Raw lead the actor may act on, or NOT_FOUND (also for leads outside their visibility). */
async function loadLeadForActor(actor: CrmActor, id: string, db?: Prisma.TransactionClient) {
  const scope = await getCrmRecordScope(actor);
  const lead = await LeadRepository.findRaw(scopedWhere(actor, scope, id), db);
  if (!lead) throw new BusinessRuleError("NOT_FOUND", "Lead not found.", { id });
  return lead;
}

export async function getLead(actor: CrmActor, id: string) {
  const scope = await getCrmRecordScope(actor);
  const lead = await LeadRepository.findDetail(scopedWhere(actor, scope, id));
  if (!lead) throw new BusinessRuleError("NOT_FOUND", "Lead not found.", { id });
  const tags = (await tagsByEntity(actor.companyId, "LEAD", [id])).get(id) ?? [];
  const extraUserIds = [lead.convertedByUserId, lead.archivedByUserId, lead.updatedByUserId].filter((v): v is string => Boolean(v));
  const names = new Map((await LeadRepository.userNames([...new Set(extraUserIds)])).map((u) => [u.id, u.fullName]));
  return {
    ...lead,
    tags,
    ownerInactive: lead.owner ? lead.owner.status !== "ACTIVE" : false,
    convertedByName: lead.convertedByUserId ? (names.get(lead.convertedByUserId) ?? null) : null,
    archivedByName: lead.archivedByUserId ? (names.get(lead.archivedByUserId) ?? null) : null,
    updatedByName: lead.updatedByUserId ? (names.get(lead.updatedByUserId) ?? null) : null,
  };
}
export type LeadDetail = Awaited<ReturnType<typeof getLead>>;

/** Everything the lead form and filters need in one call. */
export async function getLeadFormMeta(actor: CrmActor) {
  const [statuses, sources, customFields, company] = await Promise.all([
    listLeadStatuses(actor.companyId),
    listLeadSources(actor.companyId),
    listCustomFields(actor.companyId, "LEAD", { includeInactive: true }),
    LeadRepository.companyBaseCurrency(actor.companyId),
  ]);
  return {
    statuses: statuses.map(({ id, key, name, kind, color, isDefault, isActive }) => ({ id, key, name, kind, color, isDefault, isActive })),
    sources: sources.map(({ id, key, name, isActive }) => ({ id, key, name, isActive })),
    customFields,
    baseCurrencyCode: company?.baseCurrencyCode ?? "INR",
  };
}

// ── Shared write helpers ─────────────────────────────────────────

async function assertAssignableOwner(companyId: string, userId: string) {
  const user = await LeadRepository.activeUserInCompany(companyId, userId);
  if (!user) throw new BusinessRuleError("VALIDATION_ERROR", "The selected owner is not an active user in this company.", { fieldErrors: { ownerUserId: "Choose an active user." } });
  return user;
}

async function assertSelectableStatus(companyId: string, statusId: string) {
  const status = await getLeadStatusForCompany(companyId, statusId);
  if (!status.isActive) throw new BusinessRuleError("VALIDATION_ERROR", `"${status.name}" is no longer in use.`, { fieldErrors: { statusId: "Choose an active status." } });
  if (status.kind === "CONVERTED") {
    throw new BusinessRuleError("VALIDATION_ERROR", "Use Convert to mark a lead as converted — it creates or links the contact, company and opportunity.", { fieldErrors: { statusId: "Use Convert instead." } });
  }
  return status;
}

async function assertSelectableSource(companyId: string, sourceId: string) {
  const source = await getLeadSourceForCompany(companyId, sourceId);
  if (!source.isActive) throw new BusinessRuleError("VALIDATION_ERROR", `"${source.name}" is no longer in use.`, { fieldErrors: { sourceId: "Choose an active source." } });
  return source;
}

const CONTACT_FIELDS = ["email", "alternateEmail", "phone", "mobile", "whatsapp", "companyName"] as const;
const TEXT_FIELDS = [
  "lastName",
  "companyName",
  "designation",
  "email",
  "alternateEmail",
  "phone",
  "mobile",
  "whatsapp",
  "industry",
  "city",
  "state",
  "country",
  "requirement",
  "utmSource",
  "utmMedium",
  "utmCampaign",
  "utmTerm",
  "utmContent",
  "campaignSource",
  "referralSource",
] as const;

type LeadSnapshot = Pick<CrmLead, "leadNumber" | "firstName" | (typeof TEXT_FIELDS)[number]>;

function derivedFields(s: LeadSnapshot) {
  const keys = leadContactKeys(s);
  const fullName = fullNameOf(s.firstName, s.lastName);
  return {
    fullName,
    emailKeys: keys.emailKeys,
    phoneKeys: keys.phoneKeys,
    searchText: buildSearchText([
      s.leadNumber,
      fullName,
      s.companyName,
      s.designation,
      s.email,
      s.alternateEmail,
      s.phone,
      s.mobile,
      s.whatsapp,
      s.city,
      s.requirement?.slice(0, 1000),
    ]),
  };
}

const toDate = (v: string | null | undefined) => (blank(v) ? null : new Date(v as string));

// ── Create ───────────────────────────────────────────────────────

export interface CreateLeadOptions {
  /** For integrations/imports: resolve the source by stable key (e.g. "indiamart") when sourceId is absent. */
  sourceKey?: string;
  /** How the lead came in (stored once, never changed later). Defaults to MANUAL. */
  channel?: CrmLeadCaptureChannel;
  /** Connector / adapter that delivered it, e.g. "generic", "facebook". */
  provider?: string | null;
  importJobId?: string | null;
  /** Remember the lead's id in the external system (unique per provider). */
  externalRef?: { provider: string; externalId: string } | null;
  /**
   * The ingestion pipeline has already applied the company's duplicate
   * rules and decided to create (policy CREATE, or no match). BLOCK rules
   * are still enforced here.
   */
  duplicatesReviewed?: boolean;
  /**
   * Trusted system links (ingestion linking a matched contact): skip the
   * actor-visibility check on crmContactId / crmCompanyId.
   */
  trustedLinks?: boolean;
}

export async function createLead(actor: CrmActor, raw: unknown, options: CreateLeadOptions = {}) {
  const input: CreateLeadInput = createLeadSchema.parse(raw);

  const status = input.statusId ? await assertSelectableStatus(actor.companyId, input.statusId) : await getDefaultLeadStatus(actor.companyId);
  let sourceId: string | null = null;
  if (input.sourceId) sourceId = (await assertSelectableSource(actor.companyId, input.sourceId)).id;
  else {
    const fallback = await getLeadSourceByKey(actor.companyId, options.sourceKey ?? "manual");
    sourceId = fallback?.isActive ? fallback.id : null;
  }
  // Undefined → the creator owns it (if they are an active user of this
  // company — a platform admin working in another company is not);
  // explicit null/"" → unassigned.
  let ownerUserId = input.ownerUserId === undefined ? actor.userId : textOrNull(input.ownerUserId);
  if (ownerUserId && input.ownerUserId === undefined) {
    if (!(await LeadRepository.activeUserInCompany(actor.companyId, ownerUserId))) ownerUserId = null;
  } else if (ownerUserId) {
    await assertAssignableOwner(actor.companyId, ownerUserId);
  }

  if (input.crmCompanyId && !options.trustedLinks) await getCrmCompanyForActor(actor, input.crmCompanyId);
  if (input.crmContactId && !options.trustedLinks) await getCrmContactForActor(actor, input.crmContactId);

  const definitions = await listCustomFields(actor.companyId, "LEAD", { includeInactive: true });
  const customFields = validateCustomFieldValues(definitions, input.customFields);

  const keys = leadContactKeys(input);
  assertNoBlockingDuplicates(await findLeadDuplicates(actor.companyId, keys), input.confirmDuplicate || options.duplicatesReviewed);

  const company = !blank(input.estimatedValue) && blank(input.currencyCode) ? await LeadRepository.companyBaseCurrency(actor.companyId) : null;
  // Lead numbers are unique per company, so the sequence is company-wide (never per branch).
  const leadNumber = await generateDocumentNumber({ companyId: actor.companyId, branchId: null, documentType: "CRM_LEAD" });

  const texts = Object.fromEntries(TEXT_FIELDS.map((f) => [f, textOrNull(input[f] as string | null | undefined)])) as Record<(typeof TEXT_FIELDS)[number], string | null>;
  const snapshot: LeadSnapshot = { leadNumber, firstName: input.firstName.trim(), ...texts };

  return runCrmMutation(actor, async ({ tx, emit, audit }) => {
    const lead = await LeadRepository.create(
      {
        companyId: actor.companyId,
        branchId: actor.branchId,
        leadNumber,
        firstName: snapshot.firstName,
        ...texts,
        ...derivedFields(snapshot),
        email: texts.email?.toLowerCase() ?? null,
        alternateEmail: texts.alternateEmail?.toLowerCase() ?? null,
        crmCompanyId: textOrNull(input.crmCompanyId),
        crmContactId: textOrNull(input.crmContactId),
        statusId: status.id,
        sourceId,
        ownerUserId,
        score: input.score ?? 0,
        temperature: blank(input.temperature) ? null : (input.temperature as CrmLead["temperature"]),
        estimatedValue: input.estimatedValue ?? null,
        currencyCode: textOrNull(input.currencyCode) ?? company?.baseCurrencyCode ?? null,
        customFields: customFields as Prisma.InputJsonValue,
        lastContactedAt: toDate(input.lastContactedAt),
        nextFollowUpAt: toDate(input.nextFollowUpAt),
        captureChannel: options.channel ?? "MANUAL",
        captureProvider: options.provider ?? null,
        importJobId: options.importJobId ?? null,
        createdByUserId: actor.userId,
        updatedByUserId: actor.userId,
      },
      tx
    );
    if (options.externalRef) {
      await tx.crmLeadExternalRef.create({ data: { companyId: actor.companyId, leadId: lead.id, provider: options.externalRef.provider, externalId: options.externalRef.externalId } });
    }
    const tagResult = await applyEntityTagChange(actor, "LEAD", lead.id, { addTagIds: input.tagIds ?? [], addTagNames: input.tagNames ?? [], removeTagIds: [] }, tx);
    await audit({ tableName: TABLE, recordId: lead.id, action: "CREATE", newValues: { ...lead, tags: tagResult.added.map((t) => t.name) } });
    emit({
      entityType: "LEAD",
      entityId: lead.id,
      eventType: "lead.created",
      summary: [lead.fullName, lead.companyName].filter(Boolean).join(" · "),
      payload: {
        leadNumber,
        statusId: status.id,
        sourceId,
        ownerUserId,
        tags: tagResult.added.map((t) => t.name),
        channel: lead.captureChannel,
        ...(lead.captureProvider ? { provider: lead.captureProvider } : {}),
        ...(lead.importJobId ? { importJobId: lead.importJobId } : {}),
        ...(options.externalRef ? { externalId: options.externalRef.externalId } : {}),
      },
    });
    return lead;

  });
}

// ── Update ───────────────────────────────────────────────────────

const TRACKED_SCALARS = [
  "firstName",
  ...TEXT_FIELDS,
  "crmCompanyId",
  "crmContactId",
  "sourceId",
  "score",
  "temperature",
  "estimatedValue",
  "currencyCode",
  "lastContactedAt",
  "nextFollowUpAt",
] as const;

function comparable(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  if (v && typeof v === "object" && "toNumber" in (v as object)) return Number(v);
  return v ?? null;
}

async function versionedUpdate(ctx: CrmMutationContext, lead: CrmLead, expectedVersion: number | undefined, data: Prisma.CrmLeadUncheckedUpdateManyInput, actor: CrmActor) {
  const version = expectedVersion ?? lead.version;
  const { count } = await LeadRepository.updateVersioned(lead.id, version, { ...data, updatedByUserId: actor.userId }, ctx.tx);
  if (count === 0) {
    throw new BusinessRuleError("RECORD_VERSION_CONFLICT", "This lead was changed by someone else after you opened it. Reload to see the latest version, then try again.", {
      id: lead.id,
    });
  }
  return (await LeadRepository.findRaw({ id: lead.id }, ctx.tx))!;
}

export async function updateLead(actor: CrmActor, id: string, raw: unknown) {
  const input: UpdateLeadInput = updateLeadSchema.parse(raw);
  const before = await loadLeadForActor(actor, id);
  if (before.archivedAt) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "Restore this lead before editing it.");
  if (input.version !== before.version) {
    throw new BusinessRuleError("RECORD_VERSION_CONFLICT", "This lead was changed by someone else after you opened it. Reload to see the latest version, then try again.", { id });
  }

  const data: Prisma.CrmLeadUncheckedUpdateManyInput = {};
  if (input.firstName !== undefined) data.firstName = input.firstName.trim();
  for (const f of TEXT_FIELDS) {
    if (input[f] !== undefined) {
      const v = textOrNull(input[f] as string | null);
      data[f] = f === "email" || f === "alternateEmail" ? (v?.toLowerCase() ?? null) : v;
    }
  }
  if (input.crmCompanyId !== undefined) {
    data.crmCompanyId = textOrNull(input.crmCompanyId);
    if (data.crmCompanyId && data.crmCompanyId !== before.crmCompanyId) await getCrmCompanyForActor(actor, data.crmCompanyId as string);
  }
  if (input.crmContactId !== undefined) {
    data.crmContactId = textOrNull(input.crmContactId);
    if (data.crmContactId && data.crmContactId !== before.crmContactId) await getCrmContactForActor(actor, data.crmContactId as string);
  }
  if (input.sourceId !== undefined) {
    data.sourceId = textOrNull(input.sourceId);
    if (data.sourceId && data.sourceId !== before.sourceId) await assertSelectableSource(actor.companyId, data.sourceId as string);
  }
  if (input.score !== undefined) data.score = input.score ?? 0;
  if (input.temperature !== undefined) data.temperature = blank(input.temperature) ? null : (input.temperature as CrmLead["temperature"]);
  if (input.estimatedValue !== undefined) data.estimatedValue = input.estimatedValue ?? null;
  if (input.currencyCode !== undefined) data.currencyCode = textOrNull(input.currencyCode);
  if (input.lastContactedAt !== undefined) data.lastContactedAt = toDate(input.lastContactedAt);
  if (input.nextFollowUpAt !== undefined) data.nextFollowUpAt = toDate(input.nextFollowUpAt);
  if (input.customFields !== undefined) {
    const definitions = await listCustomFields(actor.companyId, "LEAD", { includeInactive: true });
    data.customFields = validateCustomFieldValues(definitions, input.customFields, (before.customFields as Record<string, unknown>) ?? {}) as Prisma.InputJsonValue;
  }

  let newStatus: Awaited<ReturnType<typeof assertSelectableStatus>> | null = null;
  if (input.statusId && input.statusId !== before.statusId) newStatus = await assertSelectableStatus(actor.companyId, input.statusId);
  let newOwner: string | null | undefined;
  if (input.ownerUserId !== undefined) {
    const next = textOrNull(input.ownerUserId);
    if (next !== before.ownerUserId) {
      if (next) await assertAssignableOwner(actor.companyId, next);
      newOwner = next;
    }
  }

  const merged = { ...before, ...data } as CrmLead;
  const contactChanged = CONTACT_FIELDS.some((f) => data[f] !== undefined && comparable(data[f]) !== comparable(before[f]));
  if (contactChanged) assertNoBlockingDuplicates(await findLeadDuplicates(actor.companyId, leadContactKeys(merged), id), input.confirmDuplicate);

  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const f of TRACKED_SCALARS) {
    if (data[f] !== undefined && comparable(data[f]) !== comparable(before[f])) changes[f] = { from: comparable(before[f]), to: comparable(data[f]) };
  }
  const customChanged = data.customFields !== undefined && JSON.stringify(data.customFields) !== JSON.stringify(before.customFields);
  if (customChanged) changes.customFields = { from: before.customFields, to: data.customFields };

  if (!Object.keys(changes).length && !newStatus && newOwner === undefined) return before;

  Object.assign(data, derivedFields(merged));
  if (newStatus) Object.assign(data, { statusId: newStatus.id });
  if (newOwner !== undefined) data.ownerUserId = newOwner;

  return runCrmMutation(actor, async (ctx) => {
    const after = await versionedUpdate(ctx, before, input.version, data, actor);
    await ctx.audit({ tableName: TABLE, recordId: id, action: "UPDATE", oldValues: before, newValues: after });
    if (Object.keys(changes).length) {
      ctx.emit({ entityType: "LEAD", entityId: id, eventType: "lead.updated", summary: `Updated ${Object.keys(changes).length} field(s)`, payload: { changes } });
    }
    if (newStatus) emitStatusChange(ctx, id, before.statusId, newStatus);
    if (newOwner !== undefined) await emitOwnerChange(ctx, id, before.ownerUserId, newOwner);
    return after;
  });
}

// ── Non-destructive merge (ingestion UPDATE policy) ──────────────

/** Fields an ingestion update may fill. Source attribution (sourceId, UTM, campaign, referral, capture channel) is never touched. */
const FILLABLE_TEXT_FIELDS = [
  "lastName",
  "companyName",
  "designation",
  "email",
  "alternateEmail",
  "phone",
  "mobile",
  "whatsapp",
  "industry",
  "city",
  "state",
  "country",
  "requirement",
] as const;

export interface LeadMergeMeta {
  channel: CrmLeadCaptureChannel;
  provider?: string | null;
  importJobId?: string | null;
  externalRef?: { provider: string; externalId: string } | null;
  /** Shown on the timeline, e.g. "import leads.csv row 14" or "API key Website". */
  via: string;
}

/**
 * Fills only the fields that are empty on the existing lead — nothing the
 * team has entered is overwritten. A different requirement text is kept as a
 * note instead of being dropped. Tags are added, never removed.
 */
export async function fillEmptyLeadFields(actor: CrmActor, leadId: string, raw: unknown, meta: LeadMergeMeta) {
  const input: CreateLeadInput = createLeadSchema.parse(raw);
  const before = await LeadRepository.findRaw({ id: leadId, companyId: actor.companyId });
  if (!before) throw new BusinessRuleError("NOT_FOUND", "Lead not found.", { id: leadId });
  if (before.archivedAt) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "The matching lead is archived.");

  const data: Prisma.CrmLeadUncheckedUpdateManyInput = {};
  const changed: string[] = [];
  for (const f of FILLABLE_TEXT_FIELDS) {
    const incoming = textOrNull(input[f] as string | null | undefined);
    if (!incoming || !blank(before[f])) continue;
    data[f] = f === "email" || f === "alternateEmail" ? incoming.toLowerCase() : incoming;
    changed.push(f);
  }
  if (input.temperature && !before.temperature) {
    data.temperature = input.temperature as CrmLead["temperature"];
    changed.push("temperature");
  }
  if (input.estimatedValue != null && before.estimatedValue == null) {
    data.estimatedValue = input.estimatedValue;
    if (!before.currencyCode && input.currencyCode) data.currencyCode = textOrNull(input.currencyCode);
    changed.push("estimatedValue");
  }
  if (input.nextFollowUpAt && !before.nextFollowUpAt) {
    data.nextFollowUpAt = toDate(input.nextFollowUpAt);
    changed.push("nextFollowUpAt");
  }
  if (input.ownerUserId && !before.ownerUserId && (await LeadRepository.activeUserInCompany(actor.companyId, input.ownerUserId))) {
    data.ownerUserId = input.ownerUserId;
    changed.push("ownerUserId");
  }
  if (input.customFields && Object.keys(input.customFields).length) {
    const existing = (before.customFields as Record<string, unknown>) ?? {};
    const additions = Object.fromEntries(Object.entries(input.customFields).filter(([k]) => existing[k] === undefined || existing[k] === null));
    if (Object.keys(additions).length) {
      const definitions = await listCustomFields(actor.companyId, "LEAD", { includeInactive: true });
      data.customFields = validateCustomFieldValues(definitions, additions, existing) as Prisma.InputJsonValue;
      changed.push(...Object.keys(additions).map((k) => `customFields.${k}`));
    }
  }
  const incomingRequirement = textOrNull(input.requirement);
  const requirementNote = incomingRequirement && before.requirement && incomingRequirement !== before.requirement.trim() ? incomingRequirement : null;
  const hasTags = Boolean(input.tagIds?.length || input.tagNames?.length);

  const result = await runCrmMutation(actor, async (ctx) => {
    let after = before;
    if (changed.length) {
      const merged = { ...before, ...data } as CrmLead;
      after = await versionedUpdate(ctx, before, undefined, { ...data, ...derivedFields(merged) }, actor);
      await ctx.audit({ tableName: TABLE, recordId: leadId, action: "UPDATE", oldValues: before, newValues: { ...after, via: meta.via } });
      ctx.emit({
        entityType: "LEAD",
        entityId: leadId,
        eventType: "lead.updated",
        summary: `Filled ${changed.length} empty field(s) from ${meta.via}`,
        payload: {
          changes: Object.fromEntries(changed.filter((f) => !f.startsWith("customFields.")).map((f) => [f, { from: null, to: comparable((data as Record<string, unknown>)[f]) }])),
          via: meta.via,
          channel: meta.channel,
          ...(meta.provider ? { provider: meta.provider } : {}),
          ...(meta.importJobId ? { importJobId: meta.importJobId } : {}),
        },
      });
    }
    if (requirementNote) {
      const note = await ctx.tx.crmNote.create({
        data: { companyId: actor.companyId, entityType: "LEAD", entityId: leadId, body: `New enquiry received via ${meta.via}:\n${requirementNote}`, createdByUserId: actor.userId },
      });
      ctx.emit({ entityType: "LEAD", entityId: leadId, eventType: "lead.note_added", summary: requirementNote.slice(0, 137), payload: { noteId: note.id, via: meta.via } });
    }
    if (hasTags) await applyTagsAndEmit(ctx, actor, leadId, { addTagIds: input.tagIds ?? [], addTagNames: input.tagNames ?? [], removeTagIds: [] });
    if (meta.externalRef) {
      await ctx.tx.crmLeadExternalRef.createMany({
        data: [{ companyId: actor.companyId, leadId, provider: meta.externalRef.provider, externalId: meta.externalRef.externalId }],
        skipDuplicates: true,
      });
    }
    return after;
  });
  return { lead: result, changedFields: changed, addedNote: Boolean(requirementNote) };
}

function emitStatusChange(ctx: CrmMutationContext, leadId: string, fromStatusId: string, to: { id: string; name: string; key: string; kind: string }, fromName?: string) {

  ctx.emit({
    entityType: "LEAD",
    entityId: leadId,
    eventType: "lead.status_changed",
    summary: fromName ? `${fromName} → ${to.name}` : `Status: ${to.name}`,
    payload: { fromStatusId, toStatusId: to.id, toStatusKey: to.key, toStatusKind: to.kind },
  });
}

async function emitOwnerChange(ctx: CrmMutationContext, leadId: string, from: string | null, to: string | null) {
  const names = new Map((await LeadRepository.userNames([from, to].filter((v): v is string => Boolean(v)))).map((u) => [u.id, u.fullName]));
  const label = (id: string | null) => (id ? (names.get(id) ?? "Unknown user") : "Unassigned");
  ctx.emit({
    entityType: "LEAD",
    entityId: leadId,
    eventType: "lead.owner_changed",
    summary: from ? `${label(from)} → ${label(to)}` : `Assigned to ${label(to)}`,
    payload: { fromUserId: from, toUserId: to },
  });
}

// ── Focused actions ──────────────────────────────────────────────

export async function changeLeadStatus(actor: CrmActor, id: string, raw: unknown) {
  const { statusId, version } = changeLeadStatusSchema.parse(raw);
  const before = await loadLeadForActor(actor, id);
  if (before.archivedAt) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "Restore this lead before changing its status.");
  if (before.convertedAt) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This lead has been converted; its status can't be changed.");
  if (statusId === before.statusId) return before;
  const [status, previous] = await Promise.all([assertSelectableStatus(actor.companyId, statusId), getLeadStatusForCompany(actor.companyId, before.statusId)]);
  return runCrmMutation(actor, async (ctx) => {
    const after = await versionedUpdate(ctx, before, version, { statusId }, actor);
    await ctx.audit({ tableName: TABLE, recordId: id, action: "UPDATE", oldValues: { statusId: before.statusId }, newValues: { statusId } });
    emitStatusChange(ctx, id, before.statusId, status, previous.name);
    return after;
  });
}

export async function assignLead(actor: CrmActor, id: string, raw: unknown) {
  const { ownerUserId, version } = assignLeadSchema.parse(raw);
  const before = await loadLeadForActor(actor, id);
  if (before.archivedAt) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "Restore this lead before reassigning it.");
  if (ownerUserId === before.ownerUserId) return before;
  if (ownerUserId) await assertAssignableOwner(actor.companyId, ownerUserId);
  return runCrmMutation(actor, async (ctx) => {
    const after = await versionedUpdate(ctx, before, version, { ownerUserId }, actor);
    await ctx.audit({ tableName: TABLE, recordId: id, action: "UPDATE", oldValues: { ownerUserId: before.ownerUserId }, newValues: { ownerUserId } });
    await emitOwnerChange(ctx, id, before.ownerUserId, ownerUserId);
    return after;
  });
}

async function applyTagsAndEmit(ctx: CrmMutationContext, actor: CrmActor, leadId: string, change: Pick<EntityTagChange, "addTagIds" | "addTagNames" | "removeTagIds">) {
  const { added, removed } = await applyEntityTagChange(actor, "LEAD", leadId, change, ctx.tx);
  for (const t of added) ctx.emit({ entityType: "LEAD", entityId: leadId, eventType: "lead.tag_added", summary: t.name, payload: { tagId: t.id } });
  for (const t of removed) ctx.emit({ entityType: "LEAD", entityId: leadId, eventType: "lead.tag_removed", summary: t.name, payload: { tagId: t.id } });
  if (added.length || removed.length) {
    await ctx.audit({ tableName: "crm_entity_tags", recordId: leadId, action: "UPDATE", newValues: { added: added.map((t) => t.name), removed: removed.map((t) => t.name) } });
  }
  return { added, removed };
}

export async function changeLeadTags(actor: CrmActor, id: string, change: EntityTagChange) {
  const lead = await loadLeadForActor(actor, id);
  if (lead.archivedAt) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "Restore this lead before changing its tags.");
  await runCrmMutation(actor, (ctx) => applyTagsAndEmit(ctx, actor, id, change));
  return (await tagsByEntity(actor.companyId, "LEAD", [id])).get(id) ?? [];
}

export async function archiveLead(actor: CrmActor, id: string) {
  const before = await loadLeadForActor(actor, id);
  if (before.archivedAt) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This lead is already archived.");
  return runCrmMutation(actor, async (ctx) => {
    const after = await versionedUpdate(ctx, before, undefined, { archivedAt: new Date(), archivedByUserId: actor.userId }, actor);
    await ctx.audit({ tableName: TABLE, recordId: id, action: "UPDATE", oldValues: { archivedAt: null }, newValues: { archivedAt: after.archivedAt } });
    ctx.emit({ entityType: "LEAD", entityId: id, eventType: "lead.archived", summary: before.fullName });
    return after;
  });
}

export async function restoreLead(actor: CrmActor, id: string) {
  const before = await loadLeadForActor(actor, id);
  if (!before.archivedAt) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This lead is not archived.");
  return runCrmMutation(actor, async (ctx) => {
    const after = await versionedUpdate(ctx, before, undefined, { archivedAt: null, archivedByUserId: null }, actor);
    await ctx.audit({ tableName: TABLE, recordId: id, action: "UPDATE", oldValues: { archivedAt: before.archivedAt }, newValues: { archivedAt: null } });
    ctx.emit({ entityType: "LEAD", entityId: id, eventType: "lead.restored", summary: before.fullName });
    return after;
  });
}

export async function checkLeadDuplicates(actor: CrmActor, raw: unknown) {
  const input = duplicateCheckSchema.parse(raw);
  return findLeadDuplicates(actor.companyId, leadContactKeys(input), textOrNull(input.excludeLeadId) ?? undefined);
}

// ── Opportunity & conversion ─────────────────────────────────────

function assertConvertible(lead: CrmLead) {
  if (lead.archivedAt) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "Restore this lead before converting it.");
  if (lead.convertedAt) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This lead has already been converted.");
}

export async function createOpportunityFromLead(actor: CrmActor, id: string, raw: unknown) {
  const input = createOpportunityFromLeadSchema.parse(raw);
  const lead = await loadLeadForActor(actor, id);
  if (lead.archivedAt) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "Restore this lead before creating an opportunity from it.");
  const number = await reserveOpportunityNumber(actor);
  return runCrmMutation(actor, async (ctx) => {
    const opp = await createOpportunityInMutation(ctx, actor, {
      opportunityNumber: number,
      name: input.name,
      leadId: lead.id,
      crmContactId: lead.crmContactId,
      crmCompanyId: lead.crmCompanyId,
      sourceId: lead.sourceId,
      ownerUserId: lead.ownerUserId ?? actor.userId,
      amount: input.amount ?? (lead.estimatedValue ? Number(lead.estimatedValue) : null),
      currencyCode: textOrNull(input.currencyCode) ?? lead.currencyCode,
      expectedCloseDate: textOrNull(input.expectedCloseDate),
      description: textOrNull(input.description) ?? lead.requirement,
    });
    ctx.emit({ entityType: "LEAD", entityId: lead.id, eventType: "lead.opportunity_created", summary: `${opp.opportunityNumber} — ${opp.name}`, payload: { opportunityId: opp.id } });
    return opp;
  });
}

/** Existing records that match the lead, shown before conversion so nothing is duplicated. */
export async function getConversionSuggestions(actor: CrmActor, id: string) {
  const lead = await loadLeadForActor(actor, id);
  const [companyMatches, contactMatches] = await Promise.all([
    lead.companyName ? findCompanyNameMatches(actor, lead.companyName) : Promise.resolve([]),
    findContactMatches(actor, lead),
  ]);
  return {
    lead: { id: lead.id, fullName: lead.fullName, companyName: lead.companyName, estimatedValue: lead.estimatedValue, currencyCode: lead.currencyCode, requirement: lead.requirement, crmCompanyId: lead.crmCompanyId, crmContactId: lead.crmContactId },
    companyMatches,
    contactMatches,
  };
}

export async function convertLead(actor: CrmActor, id: string, raw: unknown) {
  const input = convertLeadSchema.parse(raw);
  const lead = await loadLeadForActor(actor, id);
  assertConvertible(lead);
  if (input.version !== undefined && input.version !== lead.version) {
    throw new BusinessRuleError("RECORD_VERSION_CONFLICT", "This lead was changed by someone else after you opened it. Reload and try again.", { id });
  }
  const [convertedStatus, previousStatus] = await Promise.all([getConvertedLeadStatus(actor.companyId), getLeadStatusForCompany(actor.companyId, lead.statusId)]);
  const linkedCompany = input.company.mode === "link" ? await getCrmCompanyForActor(actor, input.company.id) : null;
  const linkedContact = input.contact.mode === "link" ? await getCrmContactForActor(actor, input.contact.id) : null;
  const oppNumber = input.opportunity.create ? await reserveOpportunityNumber(actor) : null;
  const owner = lead.ownerUserId ?? actor.userId;

  return runCrmMutation(actor, async (ctx) => {
    const created: { companyId?: string; contactId?: string; opportunityId?: string } = {};
    let companyId = linkedCompany?.id ?? null;
    if (input.company.mode === "create") {
      const company = await createCrmCompanyInMutation(
        ctx,
        actor,
        { name: input.company.name, industry: lead.industry, city: lead.city, state: lead.state, country: lead.country, ownerUserId: owner },
        { allowDuplicate: input.company.allowDuplicate, sourceLeadId: lead.id }
      );
      companyId = company.id;
      created.companyId = company.id;
    }

    let contactId = linkedContact?.id ?? null;
    if (input.contact.mode === "create") {
      const contact = await createCrmContactInMutation(
        ctx,
        actor,
        {
          firstName: lead.firstName,
          lastName: lead.lastName,
          designation: lead.designation,
          email: lead.email,
          alternateEmail: lead.alternateEmail,
          phone: lead.phone,
          mobile: lead.mobile,
          whatsapp: lead.whatsapp,
          crmCompanyId: companyId,
          ownerUserId: owner,
        },
        { allowDuplicate: input.contact.allowDuplicate, sourceLeadId: lead.id }
      );
      contactId = contact.id;
      created.contactId = contact.id;
    } else if (linkedContact && companyId && !linkedContact.crmCompanyId) {
      // An existing contact without a company gets linked to the chosen one.
      await CrmContactRepository.update(linkedContact.id, { crmCompanyId: companyId }, ctx.tx);
      await ctx.audit({ tableName: "crm_contacts", recordId: linkedContact.id, action: "UPDATE", oldValues: { crmCompanyId: null }, newValues: { crmCompanyId: companyId } });
      ctx.emit({ entityType: "CONTACT", entityId: linkedContact.id, eventType: "contact.updated", summary: "Linked to company during lead conversion", payload: { crmCompanyId: companyId, fromLeadId: lead.id } });
    }

    let opportunityId: string | null = null;
    if (input.opportunity.create && oppNumber) {
      const opp = await createOpportunityInMutation(ctx, actor, {
        opportunityNumber: oppNumber,
        name: input.opportunity.name,
        leadId: lead.id,
        crmContactId: contactId,
        crmCompanyId: companyId,
        sourceId: lead.sourceId,
        ownerUserId: owner,
        amount: input.opportunity.amount ?? (lead.estimatedValue ? Number(lead.estimatedValue) : null),
        currencyCode: textOrNull(input.opportunity.currencyCode) ?? lead.currencyCode,
        expectedCloseDate: textOrNull(input.opportunity.expectedCloseDate),
        description: textOrNull(input.opportunity.description) ?? lead.requirement,
      });
      opportunityId = opp.id;
      created.opportunityId = opp.id;
    }

    const after = await versionedUpdate(
      ctx,
      lead,
      undefined,
      {
        statusId: convertedStatus.id,
        convertedAt: new Date(),
        convertedByUserId: actor.userId,
        crmCompanyId: companyId,
        crmContactId: contactId,
        convertedOpportunityId: opportunityId,
      },
      actor
    );
    await ctx.audit({ tableName: TABLE, recordId: lead.id, action: "UPDATE", oldValues: lead, newValues: after });
    ctx.emit({
      entityType: "LEAD",
      entityId: lead.id,
      eventType: "lead.converted",
      summary: [contactId ? "Contact" : null, companyId ? "Company" : null, opportunityId ? "Opportunity" : null].filter(Boolean).join(" + "),
      payload: { crmCompanyId: companyId, crmContactId: contactId, opportunityId, created },
    });
    emitStatusChange(ctx, lead.id, lead.statusId, convertedStatus, previousStatus.name);
    if (opportunityId) ctx.emit({ entityType: "LEAD", entityId: lead.id, eventType: "lead.opportunity_created", summary: input.opportunity.create ? input.opportunity.name : "", payload: { opportunityId } });
    return { lead: after, crmCompanyId: companyId, crmContactId: contactId, opportunityId, created };
  });
}

// ── Bulk ─────────────────────────────────────────────────────────

/**
 * Synchronous bulk actions for up to BULK_LEAD_LIMIT selected leads, applied
 * in one transaction with one timeline event per changed lead. Leads outside
 * the user's visibility, archived (for non-archive actions) or unchanged are
 * reported as skipped, never silently dropped. Large/async bulk jobs move to
 * the Bulk Action Engine in Phase 14.
 */
export async function bulkLeadAction(actor: CrmActor, raw: unknown) {
  const input = bulkLeadSchema.parse(raw);
  const scope = await getCrmRecordScope(actor);
  const ids = [...new Set(input.ids)];
  const leads = await LeadRepository.findManyRaw({ AND: [{ id: { in: ids }, companyId: actor.companyId }, crmOwnerWhere(scope) as Prisma.CrmLeadWhereInput] });
  const found = new Map(leads.map((l) => [l.id, l]));
  const skipped: { id: string; reason: string }[] = ids.filter((i) => !found.has(i)).map((i) => ({ id: i, reason: "Not found or not visible to you" }));

  let targets = leads.filter((l) => {
    if (l.archivedAt) {
      skipped.push({ id: l.id, reason: "Archived" });
      return false;
    }
    return true;
  });

  if (input.action === "assign" && input.ownerUserId) await assertAssignableOwner(actor.companyId, input.ownerUserId);
  const status = input.action === "status" ? await assertSelectableStatus(actor.companyId, input.statusId) : null;
  if (input.action === "status") {
    targets = targets.filter((l) => {
      if (l.convertedAt) skipped.push({ id: l.id, reason: "Already converted" });
      else if (l.statusId === input.statusId) skipped.push({ id: l.id, reason: "Already in this status" });
      else return true;
      return false;
    });
  }
  if (input.action === "assign") {
    targets = targets.filter((l) => (l.ownerUserId === input.ownerUserId ? (skipped.push({ id: l.id, reason: "Already assigned to this owner" }), false) : true));
  }

  let updated = 0;
  await runCrmMutation(actor, async (ctx) => {
    for (const lead of targets) {
      if (input.action === "assign") {
        await LeadRepository.update(lead.id, { ownerUserId: input.ownerUserId, updatedByUserId: actor.userId }, ctx.tx);
        await ctx.audit({ tableName: TABLE, recordId: lead.id, action: "UPDATE", oldValues: { ownerUserId: lead.ownerUserId }, newValues: { ownerUserId: input.ownerUserId, bulk: true } });
        await emitOwnerChange(ctx, lead.id, lead.ownerUserId, input.ownerUserId);
        updated++;
      } else if (input.action === "status" && status) {
        await LeadRepository.update(lead.id, { statusId: status.id, updatedByUserId: actor.userId }, ctx.tx);
        await ctx.audit({ tableName: TABLE, recordId: lead.id, action: "UPDATE", oldValues: { statusId: lead.statusId }, newValues: { statusId: status.id, bulk: true } });
        emitStatusChange(ctx, lead.id, lead.statusId, status);
        updated++;
      } else if (input.action === "archive") {
        await LeadRepository.update(lead.id, { archivedAt: new Date(), archivedByUserId: actor.userId, updatedByUserId: actor.userId }, ctx.tx);
        await ctx.audit({ tableName: TABLE, recordId: lead.id, action: "UPDATE", oldValues: { archivedAt: null }, newValues: { archived: true, bulk: true } });
        ctx.emit({ entityType: "LEAD", entityId: lead.id, eventType: "lead.archived", summary: lead.fullName, payload: { bulk: true } });
        updated++;
      } else if (input.action === "addTags" || input.action === "removeTags") {
        const change =
          input.action === "addTags"
            ? { addTagIds: input.tagIds, addTagNames: input.tagNames, removeTagIds: [] }
            : { addTagIds: [], addTagNames: [], removeTagIds: input.tagIds };
        const { added, removed } = await applyTagsAndEmit(ctx, actor, lead.id, change);
        if (added.length || removed.length) updated++;
        else skipped.push({ id: lead.id, reason: input.action === "addTags" ? "Already has these tags" : "Doesn't have these tags" });
      }
    }
  });
  return { requested: ids.length, updated, skipped };
}
