import type { CrmOpportunity, CrmOpportunityStatus, Prisma } from "@prisma/client";
import { generateDocumentNumber } from "@/core/numbering/DocumentNumberingService";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import type { CrmActor } from "../core/crm-actor";
import { runCrmMutation, type CrmMutationContext } from "../core/crm-mutation";
import { buildSearchText, nameKey } from "../core/crm-normalize";
import { crmOwnerWhere, getCrmRecordScope, isWithinCrmScope, type CrmRecordScope } from "../core/crm-visibility";
import { listCustomFields, validateCustomFieldValues } from "../custom-fields/crm-custom-fields.service";
import { getDefaultPipelineStage, getStage, listPipelines, resolvePipelineStage } from "../pipelines/crm-pipelines.service";
import { getLeadSourceByKey, getLeadSourceForCompany, listLeadSources, optionSuggestions } from "../settings/crm-settings.service";
import { applyEntityTagChange, tagsByEntity } from "../tags/crm-tags.service";
import type { EntityTagChange } from "../tags/crm-tag.schema";
import { buildOpportunityOrderBy, buildOpportunityWhere } from "./opportunity-filters";
import { canTransition, isClosedStatus, OPPORTUNITY_STATUSES, STATUS_EVENT, type OpportunityStatus } from "./opportunity-registry";
import {
  assignOpportunitySchema,
  bulkOpportunitySchema,
  changeOpportunityStatusSchema,
  changeStageSchema,
  createOpportunitySchema,
  opportunityDuplicateCheckSchema,
  updateOpportunitySchema,
  type CreateOpportunityInput,
  type OpportunityFilter,
  type OpportunitySortField,
  type UpdateOpportunityInput,
} from "./opportunity.schema";
import { CrmOpportunityRepository, type OpportunityDuplicateCandidate, type OpportunityListRow } from "./crm-opportunity.repository";

/**
 * CRM Opportunities — the CRM-level record of a potential deal. It is not an
 * ERP quotation, order or invoice: ERP documents are only referenced
 * (crm-opportunity-erp.service.ts) and the estimated value is never
 * overwritten from them. Every way an opportunity is created (form, lead
 * conversion, "create opportunity" on a lead) goes through
 * createOpportunityInMutation so numbering, defaults, audit and events match.
 */

const TABLE = "crm_opportunities";
const blank = (v: unknown) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");
const textOrNull = (v: string | null | undefined) => (blank(v) ? null : (v as string).trim());
const toDate = (iso: string | null) => (iso ? new Date(`${iso}T00:00:00.000Z`) : null);
const comparable = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : v === null || v === undefined ? null : typeof v === "object" ? String(v) : v);
const money = (v: unknown) => (v === null || v === undefined ? null : Number(v));

const conflict = (id: string) =>
  new BusinessRuleError("RECORD_VERSION_CONFLICT", "This opportunity was changed by someone else after you opened it. Reload to see the latest version, then try again.", { id });

export function opportunitySearchText(o: { opportunityNumber: string; name: string }, docNumbers: string[] = []) {
  return buildSearchText([o.opportunityNumber, o.name, ...docNumbers]);
}

/**
 * Stage default probability is applied when the opportunity enters a stage,
 * unless the user set their own probability (it no longer equals the old
 * stage's default) or passes one explicitly.
 */
export function nextProbability(current: number | null, oldStageProbability: number | null | undefined, newStageProbability: number | null | undefined, explicit?: number | null) {
  if (explicit !== undefined) return explicit;
  if (current === null || current === (oldStageProbability ?? null)) return newStageProbability ?? current;
  return current;
}

// ── Phase 02 surface (lead conversion) — extended in Phase 06 ────

/**
 * The number is reserved before the transaction (numbering runs its own
 * transaction), so a rolled-back create can leave a gap in OPP numbers — the
 * same behaviour as every other numbered document in this ERP.
 */
export async function reserveOpportunityNumber(actor: CrmActor) {
  // Company-wide sequence: opportunity numbers are unique per company.
  return generateDocumentNumber({ companyId: actor.companyId, branchId: null, documentType: "CRM_OPPORTUNITY" });
}

export interface OpportunityCreateData {
  opportunityNumber: string;
  name: string;
  leadId?: string | null;
  crmContactId?: string | null;
  crmCompanyId?: string | null;
  sourceId?: string | null;
  ownerUserId?: string | null;
  pipelineId?: string | null;
  stageId?: string | null;
  probability?: number | null;
  amount?: number | null;
  currencyCode?: string | null;
  expectedCloseDate?: string | null;
  description?: string | null;
  customFields?: Record<string, unknown>;
}

export async function createOpportunityInMutation(ctx: CrmMutationContext, actor: CrmActor, data: OpportunityCreateData) {
  // New opportunities start in the given stage, or the default pipeline's first stage.
  let pipelineId = data.pipelineId ?? null;
  let stageId = data.stageId ?? null;
  let stageProbability: number | null = null;
  if (stageId) {
    const stage = await getStage(actor.companyId, stageId);
    pipelineId = stage?.pipelineId ?? pipelineId;
    stageProbability = stage?.probability ?? null;
  } else {
    const def = await getDefaultPipelineStage(actor.companyId);
    pipelineId = def?.pipeline.id ?? null;
    stageId = def?.stage.id ?? null;
    stageProbability = def?.stage.probability ?? null;
  }
  const name = data.name.trim();
  const now = new Date();
  const opp = await CrmOpportunityRepository.create(
    {
      companyId: actor.companyId,
      opportunityNumber: data.opportunityNumber,
      name,
      nameKey: nameKey(name),
      searchText: opportunitySearchText({ opportunityNumber: data.opportunityNumber, name }),
      leadId: data.leadId ?? null,
      crmContactId: data.crmContactId ?? null,
      crmCompanyId: data.crmCompanyId ?? null,
      sourceId: data.sourceId ?? null,
      ownerUserId: data.ownerUserId === undefined ? actor.userId : data.ownerUserId,
      pipelineId,
      stageId,
      stageChangedAt: stageId ? now : null,
      probability: data.probability ?? stageProbability,
      amount: data.amount ?? null,
      currencyCode: data.currencyCode || null,
      expectedCloseDate: toDate(data.expectedCloseDate || null),
      description: data.description || null,
      customFields: (data.customFields ?? {}) as Prisma.InputJsonValue,
      lastActivityAt: now,
      createdByUserId: actor.userId,
    },
    ctx.tx
  );
  await ctx.audit({ tableName: TABLE, recordId: opp.id, action: "CREATE", newValues: opp });
  ctx.emit({
    entityType: "OPPORTUNITY",
    entityId: opp.id,
    eventType: "opportunity.created",
    summary: `${opp.opportunityNumber} — ${opp.name}`,
    payload: { leadId: data.leadId ?? null, amount: data.amount ?? null, currencyCode: data.currencyCode ?? null, pipelineId, stageId },
  });
  // The account's and the person's timelines show the new deal.
  if (opp.crmCompanyId) ctx.emit({ entityType: "COMPANY", entityId: opp.crmCompanyId, eventType: "company.opportunity_linked", summary: `${opp.opportunityNumber} — ${opp.name}`, payload: { opportunityId: opp.id } });
  if (opp.crmContactId) ctx.emit({ entityType: "CONTACT", entityId: opp.crmContactId, eventType: "contact.opportunity_linked", summary: `${opp.opportunityNumber} — ${opp.name}`, payload: { opportunityId: opp.id } });
  return opp;
}

// ── Reads ────────────────────────────────────────────────────────

function presentListRow(row: OpportunityListRow, tags: { id: string; name: string; color: string | null }[]) {
  return { ...row, ownerInactive: row.owner ? row.owner.status !== "ACTIVE" : false, tags };
}
export type OpportunityListItem = ReturnType<typeof presentListRow>;

export async function listOpportunities(actor: CrmActor, filter: OpportunityFilter, sort: { sortBy: OpportunitySortField; sortOrder: "asc" | "desc" }, page: { skip: number; take: number }) {
  const scope = await getCrmRecordScope(actor);
  const tagMatched = filter.tagIds?.length ? (await CrmOpportunityRepository.entityIdsWithAnyTag(actor.companyId, "OPPORTUNITY", filter.tagIds)).map((r) => r.entityId) : undefined;
  const where = buildOpportunityWhere(actor.companyId, filter, scope, tagMatched);
  const [rows, totalCount] = await Promise.all([CrmOpportunityRepository.findMany(where, buildOpportunityOrderBy(sort.sortBy, sort.sortOrder), page.skip, page.take), CrmOpportunityRepository.count(where)]);
  const tags = await tagsByEntity(actor.companyId, "OPPORTUNITY", rows.map((r) => r.id));
  return { data: rows.map((r) => presentListRow(r, tags.get(r.id) ?? [])), totalCount };
}

function scopedWhere(actor: CrmActor, scope: CrmRecordScope, id: string): Prisma.CrmOpportunityWhereInput {
  return { AND: [{ id, companyId: actor.companyId }, crmOwnerWhere(scope) as Prisma.CrmOpportunityWhereInput] };
}

/** Raw opportunity the actor may act on (NOT_FOUND outside their visibility). */
export async function loadOpportunityForActor(actor: CrmActor, id: string) {
  const scope = await getCrmRecordScope(actor);
  const opp = await CrmOpportunityRepository.findRaw(scopedWhere(actor, scope, id));
  if (!opp) throw new BusinessRuleError("NOT_FOUND", "Opportunity not found.", { id });
  return opp;
}

/** Not archived; and still open unless `allowClosed` (owner, tags, notes and documents can change on closed deals). */
export async function loadEditableOpportunity(actor: CrmActor, id: string, verb: string, { allowClosed = false } = {}) {
  const opp = await loadOpportunityForActor(actor, id);
  if (opp.archivedAt) throw new BusinessRuleError("INVALID_STATE_TRANSITION", `Restore this opportunity before ${verb}.`);
  if (!allowClosed && isClosedStatus(opp.status)) {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", `This opportunity is ${OPPORTUNITY_STATUSES[opp.status].label.toLowerCase()}. Reopen it before ${verb}.`, { status: opp.status });
  }
  return opp;
}

export async function getOpportunity(actor: CrmActor, id: string) {
  const scope = await getCrmRecordScope(actor);
  const opp = await CrmOpportunityRepository.findDetail(scopedWhere(actor, scope, id));
  if (!opp) throw new BusinessRuleError("NOT_FOUND", "Opportunity not found.", { id });
  const [tags, erpLinkCount, users, company, contact] = await Promise.all([
    tagsByEntity(actor.companyId, "OPPORTUNITY", [id]).then((m) => m.get(id) ?? []),
    CrmOpportunityRepository.erpLinkCount(actor.companyId, id),
    CrmOpportunityRepository.userNames([opp.updatedByUserId, opp.archivedByUserId, opp.closedByUserId].filter((v): v is string => Boolean(v))),
    opp.crmCompanyId ? CrmOpportunityRepository.findCompany(actor.companyId, opp.crmCompanyId) : null,
    opp.crmContactId ? CrmOpportunityRepository.findContact(actor.companyId, opp.crmContactId) : null,
  ]);
  const names = new Map(users.map((u) => [u.id, u.fullName]));
  const name = (uid: string | null) => (uid ? (names.get(uid) ?? null) : null);
  const contactVisible = contact ? isWithinCrmScope(scope, contact) : false;
  return {
    ...opp,
    // A contact the viewer can't open is shown by name only — no email or phone.
    crmContact: opp.crmContact && !contactVisible ? { ...opp.crmContact, email: null, mobile: null, phone: null } : opp.crmContact,
    tags,
    erpLinkCount,
    ownerInactive: opp.owner ? opp.owner.status !== "ACTIVE" : false,
    // Linked records the viewer can't open themselves are shown by name only.
    companyVisible: company ? isWithinCrmScope(scope, company) : false,
    contactVisible,
    updatedByName: name(opp.updatedByUserId),
    archivedByName: name(opp.archivedByUserId),
    closedByName: name(opp.closedByUserId),
  };
}
export type OpportunityDetail = Awaited<ReturnType<typeof getOpportunity>>;

/** Everything the opportunity form, filters and dialogs need in one call. */
export async function getOpportunityFormMeta(actor: CrmActor) {
  const [pipelines, sources, customFields, suggestions, company] = await Promise.all([
    listPipelines(actor.companyId),
    listLeadSources(actor.companyId),
    listCustomFields(actor.companyId, "OPPORTUNITY", { includeInactive: true }),
    optionSuggestions(actor.companyId),
    CrmOpportunityRepository.companyBaseCurrency(actor.companyId),
  ]);
  return {
    pipelines,
    statuses: Object.entries(OPPORTUNITY_STATUSES).map(([key, s]) => ({ key, label: s.label, closed: s.closed })),
    sources: sources.map(({ id, key, name, isActive }) => ({ id, key, name, isActive })),
    customFields,
    suggestions: { opportunity_close_reason: suggestions.opportunity_close_reason ?? [] },
    baseCurrencyCode: company?.baseCurrencyCode ?? "INR",
  };
}

/**
 * Prefill for "New opportunity" opened from a company, contact or lead
 * (?companyId=&contactId=&leadId=). Records the user can't see, or that are
 * archived/merged, are silently left out. Nothing is copied: only ids,
 * display names and the lead's suggested values.
 */
export async function getOpportunityPrefill(actor: CrmActor, ids: { companyId?: string | null; contactId?: string | null; leadId?: string | null }) {
  const scope = await getCrmRecordScope(actor);
  const lead = ids.leadId ? await CrmOpportunityRepository.findLeadForPrefill(actor.companyId, ids.leadId) : null;
  const visibleLead = lead && isWithinCrmScope(scope, lead) ? lead : null;
  const companyId = ids.companyId ?? visibleLead?.crmCompanyId ?? null;
  const contactId = ids.contactId ?? visibleLead?.crmContactId ?? null;
  const [company, contact] = await Promise.all([companyId ? CrmOpportunityRepository.findCompany(actor.companyId, companyId) : null, contactId ? CrmOpportunityRepository.findContact(actor.companyId, contactId) : null]);
  const usable = <T extends { ownerUserId: string | null; createdByUserId: string; archivedAt: Date | null; mergedIntoId: string | null }>(r: T | null) => (r && !r.archivedAt && !r.mergedIntoId && isWithinCrmScope(scope, r) ? r : null);
  const c = usable(company);
  const p = usable(contact);
  const contactCompany = p?.crmCompanyId && !c ? usable(await CrmOpportunityRepository.findCompany(actor.companyId, p.crmCompanyId)) : null;
  const finalCompany = c ?? contactCompany;
  return {
    company: finalCompany ? { id: finalCompany.id, label: finalCompany.name } : null,
    contact: p ? { id: p.id, label: p.fullName } : null,
    lead: visibleLead
      ? {
          id: visibleLead.id,
          leadNumber: visibleLead.leadNumber,
          fullName: visibleLead.fullName,
          suggestedName: visibleLead.companyName ? `${visibleLead.companyName} — ${visibleLead.fullName}` : visibleLead.fullName,
          amount: visibleLead.estimatedValue !== null ? String(visibleLead.estimatedValue) : null,
          currencyCode: visibleLead.currencyCode,
          sourceId: visibleLead.sourceId,
          ownerUserId: visibleLead.ownerUserId,
          description: visibleLead.requirement,
        }
      : null,
  };
}

// ── Duplicate warning ────────────────────────────────────────────

export interface OpportunityDuplicateMatch {
  id: string;
  opportunityNumber: string;
  name: string;
  amount: string | null;
  currencyCode: string | null;
  expectedCloseDate: Date | null;
  stage: string | null;
  owner: string | null;
  company: string | null;
  contact: string | null;
  visible: boolean;
}

/**
 * Possible duplicate = another OPEN, non-archived opportunity with the same
 * name (ignoring case/spacing) for the same company AND contact. Customers
 * legitimately have several deals, so this only ever warns — never blocks.
 */
export async function findOpportunityDuplicates(actor: CrmActor, name: string, crmCompanyId: string | null, crmContactId: string | null, excludeId?: string): Promise<OpportunityDuplicateMatch[]> {
  const key = nameKey(name);
  if (!key) return [];
  const [rows, scope] = await Promise.all([CrmOpportunityRepository.duplicateCandidates(actor.companyId, key, crmCompanyId, crmContactId, excludeId), getCrmRecordScope(actor)]);
  return rows.map((r: OpportunityDuplicateCandidate) => {
    const visible = isWithinCrmScope(scope, r);
    return {
      id: r.id,
      opportunityNumber: r.opportunityNumber,
      // Someone else's deal: say it exists, without its details.
      name: visible ? r.name : "Opportunity owned by another user",
      amount: visible && r.amount !== null ? String(r.amount) : null,
      currencyCode: visible ? r.currencyCode : null,
      expectedCloseDate: visible ? r.expectedCloseDate : null,
      stage: visible ? (r.stage?.name ?? null) : null,
      owner: r.owner?.fullName ?? null,
      company: r.crmCompany?.name ?? null,
      contact: r.crmContact?.fullName ?? null,
      visible,
    };
  });
}

function assertOpportunityDuplicatesAllowed(matches: OpportunityDuplicateMatch[], confirmed: boolean | undefined) {
  if (matches.length && !confirmed) {
    throw new BusinessRuleError("CRM_POSSIBLE_DUPLICATE", "An open opportunity with this name already exists for this company and contact. Review it, or confirm to create another.", {
      entityType: "OPPORTUNITY",
      blocking: false,
      matches,
    });
  }
}

export async function checkOpportunityDuplicates(actor: CrmActor, raw: unknown) {
  const input = opportunityDuplicateCheckSchema.parse(raw);
  return { matches: await findOpportunityDuplicates(actor, input.name ?? "", textOrNull(input.crmCompanyId), textOrNull(input.crmContactId), textOrNull(input.excludeOpportunityId) ?? undefined) };
}

// ── Shared validation ────────────────────────────────────────────

async function assertAssignableOwner(companyId: string, userId: string) {
  const user = await CrmOpportunityRepository.activeUserInCompany(companyId, userId);
  if (!user) throw new BusinessRuleError("VALIDATION_ERROR", "The selected owner is not an active user in this company.", { fieldErrors: { ownerUserId: "Choose an active user." } });
  return user;
}

async function assertSelectableSource(companyId: string, sourceId: string) {
  const source = await getLeadSourceForCompany(companyId, sourceId);
  if (!source.isActive) throw new BusinessRuleError("VALIDATION_ERROR", `"${source.name}" is no longer in use.`, { fieldErrors: { sourceId: "Choose an active source." } });
  return source;
}

/** A company / contact can be linked only when it exists, is visible to the user, and isn't archived or merged. */
async function assertLinkableCompany(actor: CrmActor, scope: CrmRecordScope, id: string) {
  const c = await CrmOpportunityRepository.findCompany(actor.companyId, id);
  if (!c || !isWithinCrmScope(scope, c)) throw new BusinessRuleError("VALIDATION_ERROR", "Company not found.", { fieldErrors: { crmCompanyId: "Choose a company you can see." } });
  if (c.mergedIntoId || c.archivedAt) throw new BusinessRuleError("VALIDATION_ERROR", `"${c.name}" is ${c.mergedIntoId ? "merged" : "archived"} and can't be linked.`, { fieldErrors: { crmCompanyId: "Choose an active company." } });
  return c;
}

async function assertLinkableContact(actor: CrmActor, scope: CrmRecordScope, id: string) {
  const c = await CrmOpportunityRepository.findContact(actor.companyId, id);
  if (!c || !isWithinCrmScope(scope, c)) throw new BusinessRuleError("VALIDATION_ERROR", "Contact not found.", { fieldErrors: { crmContactId: "Choose a contact you can see." } });
  if (c.mergedIntoId || c.archivedAt) throw new BusinessRuleError("VALIDATION_ERROR", `"${c.fullName}" is ${c.mergedIntoId ? "merged" : "archived"} and can't be linked.`, { fieldErrors: { crmContactId: "Choose an active contact." } });
  return c;
}

async function versionedUpdate(ctx: CrmMutationContext, opp: CrmOpportunity, expectedVersion: number | undefined, data: Prisma.CrmOpportunityUncheckedUpdateManyInput, actor: CrmActor) {
  const { count } = await CrmOpportunityRepository.updateVersioned(opp.id, expectedVersion ?? opp.version, { ...data, updatedByUserId: actor.userId }, ctx.tx);
  if (count === 0) throw conflict(opp.id);
  return (await CrmOpportunityRepository.findRaw({ id: opp.id }, ctx.tx))!;
}

/** Recomputes the stored search text (name, number, linked ERP document numbers). No version bump. */
export async function refreshOpportunitySearchText(ctx: CrmMutationContext, id: string) {
  const o = await CrmOpportunityRepository.findRaw({ id }, ctx.tx);
  if (!o) return;
  const docs = await CrmOpportunityRepository.erpDocNumbers(id, ctx.tx);
  await CrmOpportunityRepository.setSearchText(id, opportunitySearchText(o, docs.map((d) => d.docNumber)), ctx.tx);
}

// ── Event helpers ────────────────────────────────────────────────

async function emitOwnerChange(ctx: CrmMutationContext, id: string, from: string | null, to: string | null) {
  const names = new Map((await CrmOpportunityRepository.userNames([from, to].filter((v): v is string => Boolean(v)))).map((u) => [u.id, u.fullName]));
  const label = (uid: string | null) => (uid ? (names.get(uid) ?? "Unknown user") : "Unassigned");
  ctx.emit({ entityType: "OPPORTUNITY", entityId: id, eventType: "opportunity.owner_changed", summary: from ? `${label(from)} → ${label(to)}` : `Assigned to ${label(to)}`, payload: { fromUserId: from, toUserId: to } });
}

type StageRef = { id: string; name: string; probability: number | null; pipelineId: string } | null;

function emitStageChange(ctx: CrmMutationContext, id: string, from: StageRef, to: NonNullable<StageRef>, probability: { from: number | null; to: number | null }, pipelines?: { from: string | null; to: string }) {
  ctx.emit({
    entityType: "OPPORTUNITY",
    entityId: id,
    eventType: "opportunity.stage_changed",
    summary: from ? `${from.name} → ${to.name}` : `Stage: ${to.name}`,
    payload: {
      fromStageId: from?.id ?? null,
      fromStage: from?.name ?? null,
      toStageId: to.id,
      toStage: to.name,
      fromPipelineId: pipelines?.from ?? from?.pipelineId ?? null,
      toPipelineId: to.pipelineId,
      fromProbability: probability.from,
      toProbability: probability.to,
    },
  });
}

export async function applyOpportunityTagsAndEmit(ctx: CrmMutationContext, actor: CrmActor, id: string, change: Pick<EntityTagChange, "addTagIds" | "addTagNames" | "removeTagIds">) {
  const { added, removed } = await applyEntityTagChange(actor, "OPPORTUNITY", id, change, ctx.tx);
  for (const t of added) ctx.emit({ entityType: "OPPORTUNITY", entityId: id, eventType: "opportunity.tag_added", summary: t.name, payload: { tagId: t.id } });
  for (const t of removed) ctx.emit({ entityType: "OPPORTUNITY", entityId: id, eventType: "opportunity.tag_removed", summary: t.name, payload: { tagId: t.id } });
  if (added.length || removed.length) await ctx.audit({ tableName: "crm_entity_tags", recordId: id, action: "UPDATE", newValues: { entityType: "OPPORTUNITY", added: added.map((t) => t.name), removed: removed.map((t) => t.name) } });
  return { added, removed };
}

const fmtValue = (amount: unknown, currency: string | null) => (amount === null || amount === undefined ? "—" : `${currency ?? ""} ${Number(amount).toLocaleString("en-IN")}`.trim());

// ── Create ───────────────────────────────────────────────────────

export async function createOpportunity(actor: CrmActor, raw: unknown) {
  const input: CreateOpportunityInput = createOpportunitySchema.parse(raw);
  const scope = await getCrmRecordScope(actor);

  // From a lead: keep the lead link and its source; company/contact come from the form (prefilled from the lead).
  const leadId = textOrNull(input.leadId);
  const lead = leadId ? await CrmOpportunityRepository.findLead(actor.companyId, leadId) : null;
  if (leadId && (!lead || !isWithinCrmScope(scope, lead))) throw new BusinessRuleError("VALIDATION_ERROR", "Lead not found.", { fieldErrors: { leadId: "Choose a lead you can see." } });
  if (lead?.archivedAt) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "Restore this lead before creating an opportunity from it.");

  const crmCompanyId = textOrNull(input.crmCompanyId);
  const crmContactId = textOrNull(input.crmContactId);
  if (crmCompanyId) await assertLinkableCompany(actor, scope, crmCompanyId);
  if (crmContactId) await assertLinkableContact(actor, scope, crmContactId);

  let ownerUserId = input.ownerUserId === undefined ? actor.userId : textOrNull(input.ownerUserId);
  if (ownerUserId && input.ownerUserId === undefined) {
    if (!(await CrmOpportunityRepository.activeUserInCompany(actor.companyId, ownerUserId))) ownerUserId = null;
  } else if (ownerUserId) await assertAssignableOwner(actor.companyId, ownerUserId);

  let sourceId = textOrNull(input.sourceId);
  if (sourceId) await assertSelectableSource(actor.companyId, sourceId);
  else if (lead?.sourceId) sourceId = lead.sourceId;
  else if (input.sourceId === undefined) sourceId = (await getLeadSourceByKey(actor.companyId, "manual"))?.id ?? null;

  const stageIdInput = textOrNull(input.stageId);
  const resolved = stageIdInput ? await resolvePipelineStage(actor.companyId, { pipelineId: textOrNull(input.pipelineId), stageId: stageIdInput }) : null;
  if (!resolved && textOrNull(input.pipelineId)) throw new BusinessRuleError("VALIDATION_ERROR", "Choose a stage.", { fieldErrors: { stageId: "Choose a stage." } });

  const definitions = await listCustomFields(actor.companyId, "OPPORTUNITY", { includeInactive: true });
  const customFields = validateCustomFieldValues(definitions, input.customFields);

  assertOpportunityDuplicatesAllowed(await findOpportunityDuplicates(actor, input.name, crmCompanyId, crmContactId), input.confirmDuplicate);
  // A value without a currency is in the company's base currency.
  const currencyCode = textOrNull(input.currencyCode) ?? (input.amount !== null && input.amount !== undefined ? ((await CrmOpportunityRepository.companyBaseCurrency(actor.companyId))?.baseCurrencyCode ?? null) : null);
  const number = await reserveOpportunityNumber(actor);

  return runCrmMutation(actor, async (ctx) => {
    const opp = await createOpportunityInMutation(ctx, actor, {
      opportunityNumber: number,
      name: input.name,
      leadId,
      crmCompanyId,
      crmContactId,
      sourceId,
      ownerUserId,
      pipelineId: resolved?.pipeline.id ?? null,
      stageId: resolved?.stage.id ?? null,
      probability: input.probability ?? null,
      amount: input.amount ?? null,
      currencyCode,
      expectedCloseDate: textOrNull(input.expectedCloseDate),
      description: textOrNull(input.description),
      customFields,
    });
    if (lead) ctx.emit({ entityType: "LEAD", entityId: lead.id, eventType: "lead.opportunity_created", summary: `${opp.opportunityNumber} — ${opp.name}`, payload: { opportunityId: opp.id } });
    if (input.tagIds?.length || input.tagNames?.length) await applyOpportunityTagsAndEmit(ctx, actor, opp.id, { addTagIds: input.tagIds ?? [], addTagNames: input.tagNames ?? [], removeTagIds: [] });
    return opp;
  });
}

// ── Update ───────────────────────────────────────────────────────

const PLAIN_TRACKED = ["name", "description", "sourceId", "customFields"] as const;

export async function updateOpportunity(actor: CrmActor, id: string, raw: unknown) {
  const input: UpdateOpportunityInput = updateOpportunitySchema.parse(raw);
  const before = await loadEditableOpportunity(actor, id, "editing it");
  if (input.version !== before.version) throw conflict(id);
  const scope = await getCrmRecordScope(actor);

  const data: Prisma.CrmOpportunityUncheckedUpdateManyInput = {};
  if (input.name !== undefined) {
    data.name = input.name.trim();
    data.nameKey = nameKey(input.name);
  }
  if (input.description !== undefined) data.description = textOrNull(input.description);
  if (input.sourceId !== undefined) {
    data.sourceId = textOrNull(input.sourceId);
    if (data.sourceId && data.sourceId !== before.sourceId) await assertSelectableSource(actor.companyId, data.sourceId as string);
  }
  if (input.customFields !== undefined) {
    const definitions = await listCustomFields(actor.companyId, "OPPORTUNITY", { includeInactive: true });
    data.customFields = validateCustomFieldValues(definitions, input.customFields, (before.customFields as Record<string, unknown>) ?? {}) as Prisma.InputJsonValue;
  }
  if (input.amount !== undefined) data.amount = input.amount;
  if (input.currencyCode !== undefined) data.currencyCode = textOrNull(input.currencyCode);
  if (input.expectedCloseDate !== undefined) data.expectedCloseDate = toDate(textOrNull(input.expectedCloseDate));
  if (input.crmCompanyId !== undefined) {
    data.crmCompanyId = textOrNull(input.crmCompanyId);
    if (data.crmCompanyId && data.crmCompanyId !== before.crmCompanyId) await assertLinkableCompany(actor, scope, data.crmCompanyId as string);
  }
  if (input.crmContactId !== undefined) {
    data.crmContactId = textOrNull(input.crmContactId);
    if (data.crmContactId && data.crmContactId !== before.crmContactId) await assertLinkableContact(actor, scope, data.crmContactId as string);
  }

  // Stage (and pipeline) through the edit form is tracked exactly like the stage action.
  const stageIdInput = input.stageId !== undefined ? textOrNull(input.stageId) : undefined;
  if (stageIdInput === null && before.stageId) throw new BusinessRuleError("VALIDATION_ERROR", "Choose a stage.", { fieldErrors: { stageId: "Choose a stage." } });
  const stageChange = stageIdInput && stageIdInput !== before.stageId ? await resolvePipelineStage(actor.companyId, { pipelineId: textOrNull(input.pipelineId), stageId: stageIdInput }, before.stageId) : null;
  const oldStage = before.stageId ? await getStage(actor.companyId, before.stageId) : null;
  if (stageChange) {
    data.stageId = stageChange.stage.id;
    data.pipelineId = stageChange.pipeline.id;
    data.stageChangedAt = new Date();
    data.probability = nextProbability(before.probability, oldStage?.probability, stageChange.stage.probability, input.probability);
  } else if (input.probability !== undefined) data.probability = input.probability;

  let newOwner: string | null | undefined;
  if (input.ownerUserId !== undefined) {
    const next = textOrNull(input.ownerUserId);
    if (next !== before.ownerUserId) {
      if (next) await assertAssignableOwner(actor.companyId, next);
      newOwner = next;
    }
  }

  const changed = (f: keyof CrmOpportunity) => data[f as keyof typeof data] !== undefined && comparable(data[f as keyof typeof data]) !== comparable(before[f]);
  const plainChanges: Record<string, { from: unknown; to: unknown }> = {};
  for (const f of PLAIN_TRACKED) {
    if (f === "customFields") {
      if (data.customFields !== undefined && JSON.stringify(data.customFields) !== JSON.stringify(before.customFields)) plainChanges.customFields = { from: before.customFields, to: data.customFields };
    } else if (changed(f)) plainChanges[f] = { from: comparable(before[f]), to: comparable(data[f]) };
  }
  const valueChanged = changed("amount") || changed("currencyCode");
  const probabilityChanged = changed("probability");
  const closeDateChanged = changed("expectedCloseDate");
  const companyChanged = changed("crmCompanyId");
  const contactChanged = changed("crmContactId");
  if (!Object.keys(plainChanges).length && !valueChanged && !probabilityChanged && !closeDateChanged && !companyChanged && !contactChanged && !stageChange && newOwner === undefined) return before;

  if (plainChanges.name || companyChanged || contactChanged) {
    const name = (data.name as string | undefined) ?? before.name;
    const companyId = (data.crmCompanyId === undefined ? before.crmCompanyId : data.crmCompanyId) as string | null;
    const contactId = (data.crmContactId === undefined ? before.crmContactId : data.crmContactId) as string | null;
    assertOpportunityDuplicatesAllowed(await findOpportunityDuplicates(actor, name, companyId, contactId, id), input.confirmDuplicate);
  }
  if (newOwner !== undefined) data.ownerUserId = newOwner;

  const [companyNames, contactNames] = await CrmOpportunityRepository.recordNames(
    actor.companyId,
    [before.crmCompanyId, data.crmCompanyId as string | null | undefined].filter((v): v is string => Boolean(v)),
    [before.crmContactId, data.crmContactId as string | null | undefined].filter((v): v is string => Boolean(v))
  );
  const companyName = (cid: unknown) => companyNames.find((c) => c.id === cid)?.name ?? "None";
  const contactName = (cid: unknown) => contactNames.find((c) => c.id === cid)?.fullName ?? "None";

  return runCrmMutation(actor, async (ctx) => {
    const after = await versionedUpdate(ctx, before, input.version, data, actor);
    if (plainChanges.name) await refreshOpportunitySearchText(ctx, id);
    await ctx.audit({ tableName: TABLE, recordId: id, action: "UPDATE", oldValues: before, newValues: after });
    const emit = (eventType: Parameters<typeof ctx.emit>[0]["eventType"], summary: string, payload: Record<string, unknown>) => ctx.emit({ entityType: "OPPORTUNITY", entityId: id, eventType, summary, payload });
    if (Object.keys(plainChanges).length) emit("opportunity.updated", `Updated ${Object.keys(plainChanges).length} field(s)`, { changes: plainChanges });
    if (valueChanged) emit("opportunity.value_changed", `${fmtValue(before.amount, before.currencyCode)} → ${fmtValue(after.amount, after.currencyCode)}`, { from: { amount: money(before.amount), currencyCode: before.currencyCode }, to: { amount: money(after.amount), currencyCode: after.currencyCode } });
    if (stageChange) emitStageChange(ctx, id, oldStage, stageChange.stage, { from: before.probability, to: after.probability }, { from: before.pipelineId, to: stageChange.pipeline.id });
    else if (probabilityChanged) emit("opportunity.probability_changed", `${before.probability ?? "—"}% → ${after.probability ?? "—"}%`, { from: before.probability, to: after.probability });
    if (closeDateChanged) emit("opportunity.close_date_changed", `${comparable(before.expectedCloseDate) ?? "—"} → ${comparable(after.expectedCloseDate) ?? "—"}`, { from: comparable(before.expectedCloseDate), to: comparable(after.expectedCloseDate) });
    if (companyChanged) {
      emit("opportunity.company_linked", `${companyName(before.crmCompanyId)} → ${companyName(after.crmCompanyId)}`, { fromCompanyId: before.crmCompanyId, toCompanyId: after.crmCompanyId });
      if (after.crmCompanyId) ctx.emit({ entityType: "COMPANY", entityId: after.crmCompanyId, eventType: "company.opportunity_linked", summary: `${after.opportunityNumber} — ${after.name}`, payload: { opportunityId: id } });
    }
    if (contactChanged) {
      emit("opportunity.contact_linked", `${contactName(before.crmContactId)} → ${contactName(after.crmContactId)}`, { fromContactId: before.crmContactId, toContactId: after.crmContactId });
      if (after.crmContactId) ctx.emit({ entityType: "CONTACT", entityId: after.crmContactId, eventType: "contact.opportunity_linked", summary: `${after.opportunityNumber} — ${after.name}`, payload: { opportunityId: id } });
    }
    if (newOwner !== undefined) await emitOwnerChange(ctx, id, before.ownerUserId, newOwner);
    return after;
  });
}

// ── Focused actions ──────────────────────────────────────────────

export async function assignOpportunity(actor: CrmActor, id: string, raw: unknown) {
  const { ownerUserId, version } = assignOpportunitySchema.parse(raw);
  const before = await loadEditableOpportunity(actor, id, "reassigning it", { allowClosed: true });
  if (ownerUserId === before.ownerUserId) return before;
  if (ownerUserId) await assertAssignableOwner(actor.companyId, ownerUserId);
  return runCrmMutation(actor, async (ctx) => {
    const after = await versionedUpdate(ctx, before, version, { ownerUserId }, actor);
    await ctx.audit({ tableName: TABLE, recordId: id, action: "UPDATE", oldValues: { ownerUserId: before.ownerUserId }, newValues: { ownerUserId } });
    await emitOwnerChange(ctx, id, before.ownerUserId, ownerUserId);
    return after;
  });
}

/** Moves an open opportunity to another stage (optionally of another pipeline); history is always recorded. */
export async function changeOpportunityStage(actor: CrmActor, id: string, raw: unknown) {
  const input = changeStageSchema.parse(raw);
  const before = await loadEditableOpportunity(actor, id, "changing its stage");
  if (input.stageId === before.stageId && (input.probability === undefined || input.probability === before.probability)) return before;
  const target = input.stageId === before.stageId ? null : await resolvePipelineStage(actor.companyId, { pipelineId: input.pipelineId, stageId: input.stageId }, before.stageId);
  const oldStage = before.stageId ? await getStage(actor.companyId, before.stageId) : null;
  return runCrmMutation(actor, async (ctx) => {
    if (!target) {
      const after = await versionedUpdate(ctx, before, input.version, { probability: input.probability }, actor);
      await ctx.audit({ tableName: TABLE, recordId: id, action: "UPDATE", oldValues: { probability: before.probability }, newValues: { probability: after.probability } });
      ctx.emit({ entityType: "OPPORTUNITY", entityId: id, eventType: "opportunity.probability_changed", summary: `${before.probability ?? "—"}% → ${after.probability ?? "—"}%`, payload: { from: before.probability, to: after.probability } });
      return after;
    }
    const probability = nextProbability(before.probability, oldStage?.probability, target.stage.probability, input.probability);
    const after = await versionedUpdate(ctx, before, input.version, { stageId: target.stage.id, pipelineId: target.pipeline.id, stageChangedAt: new Date(), probability }, actor);
    await ctx.audit({
      tableName: TABLE,
      recordId: id,
      action: "UPDATE",
      oldValues: { pipelineId: before.pipelineId, stageId: before.stageId, probability: before.probability },
      newValues: { pipelineId: after.pipelineId, stageId: after.stageId, probability: after.probability },
    });
    emitStageChange(ctx, id, oldStage, target.stage, { from: before.probability, to: after.probability }, { from: before.pipelineId, to: target.pipeline.id });
    return after;
  });
}

/**
 * Open → Won / Lost / Abandoned stores closed_at (+ who, + reason); a closed
 * opportunity can only be reopened (→ Open), which is audited and clears the
 * close fields. The record is never deleted.
 */
export async function changeOpportunityStatus(actor: CrmActor, id: string, raw: unknown) {
  const input = changeOpportunityStatusSchema.parse(raw);
  const before = await loadEditableOpportunity(actor, id, "changing its status", { allowClosed: true });
  const from = before.status as OpportunityStatus;
  const to = input.status as OpportunityStatus;
  if (from === to) return before;
  if (!canTransition(from, to)) {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", `A ${OPPORTUNITY_STATUSES[from].label.toLowerCase()} opportunity can't be marked ${OPPORTUNITY_STATUSES[to].label.toLowerCase()} directly. Reopen it first.`, { from, to });
  }
  const reason = textOrNull(input.reason);
  const closing = isClosedStatus(to);
  const data: Prisma.CrmOpportunityUncheckedUpdateManyInput = closing
    ? { status: to as CrmOpportunityStatus, closedAt: new Date(), closedByUserId: actor.userId, closeReason: reason }
    : { status: to as CrmOpportunityStatus, closedAt: null, closedByUserId: null, closeReason: null };
  return runCrmMutation(actor, async (ctx) => {
    const after = await versionedUpdate(ctx, before, input.version, data, actor);
    await ctx.audit({
      tableName: TABLE,
      recordId: id,
      action: "UPDATE",
      oldValues: { status: from, closedAt: before.closedAt, closeReason: before.closeReason },
      newValues: { status: to, closedAt: after.closedAt, closeReason: after.closeReason, reason },
    });
    ctx.emit({
      entityType: "OPPORTUNITY",
      entityId: id,
      eventType: STATUS_EVENT[to],
      summary: `${OPPORTUNITY_STATUSES[from].label} → ${OPPORTUNITY_STATUSES[to].label}${reason ? ` · ${reason}` : ""}`,
      payload: { fromStatus: from, toStatus: to, reason, amount: money(before.amount), currencyCode: before.currencyCode },
    });
    return after;
  });
}

export async function changeOpportunityTags(actor: CrmActor, id: string, change: EntityTagChange) {
  await loadEditableOpportunity(actor, id, "changing its tags", { allowClosed: true });
  await runCrmMutation(actor, (ctx) => applyOpportunityTagsAndEmit(ctx, actor, id, change));
  return (await tagsByEntity(actor.companyId, "OPPORTUNITY", [id])).get(id) ?? [];
}

/** CRM-only archive: timeline, notes, documents, tags and ERP references stay; nothing in the ERP changes. */
export async function archiveOpportunity(actor: CrmActor, id: string) {
  const before = await loadOpportunityForActor(actor, id);
  if (before.archivedAt) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This opportunity is already archived.");
  return runCrmMutation(actor, async (ctx) => {
    const after = await versionedUpdate(ctx, before, undefined, { archivedAt: new Date(), archivedByUserId: actor.userId }, actor);
    await ctx.audit({ tableName: TABLE, recordId: id, action: "UPDATE", oldValues: { archivedAt: null }, newValues: { archivedAt: after.archivedAt } });
    ctx.emit({ entityType: "OPPORTUNITY", entityId: id, eventType: "opportunity.archived", summary: `${before.opportunityNumber} — ${before.name}` });
    return after;
  });
}

export async function restoreOpportunity(actor: CrmActor, id: string) {
  const before = await loadOpportunityForActor(actor, id);
  if (!before.archivedAt) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This opportunity is not archived.");
  return runCrmMutation(actor, async (ctx) => {
    const after = await versionedUpdate(ctx, before, undefined, { archivedAt: null, archivedByUserId: null }, actor);
    await ctx.audit({ tableName: TABLE, recordId: id, action: "UPDATE", oldValues: { archivedAt: before.archivedAt }, newValues: { archivedAt: null } });
    ctx.emit({ entityType: "OPPORTUNITY", entityId: id, eventType: "opportunity.restored", summary: `${before.opportunityNumber} — ${before.name}` });
    return after;
  });
}

// ── Bulk ─────────────────────────────────────────────────────────

export async function bulkOpportunityAction(actor: CrmActor, raw: unknown) {
  const input = bulkOpportunitySchema.parse(raw);
  const scope = await getCrmRecordScope(actor);
  const ids = [...new Set(input.ids)];
  const rows = await CrmOpportunityRepository.findManyRaw({ AND: [{ id: { in: ids }, companyId: actor.companyId }, crmOwnerWhere(scope) as Prisma.CrmOpportunityWhereInput] });
  const found = new Map(rows.map((o) => [o.id, o]));
  const skipped: { id: string; reason: string }[] = ids.filter((i) => !found.has(i)).map((i) => ({ id: i, reason: "Not found or not visible to you" }));
  let targets = rows.filter((o) => (o.archivedAt ? (skipped.push({ id: o.id, reason: "Archived" }), false) : true));

  if (input.action === "assign") {
    if (input.ownerUserId) await assertAssignableOwner(actor.companyId, input.ownerUserId);
    targets = targets.filter((o) => (o.ownerUserId === input.ownerUserId ? (skipped.push({ id: o.id, reason: "Already assigned to this owner" }), false) : true));
  }
  const target = input.action === "stage" ? await resolvePipelineStage(actor.companyId, { stageId: input.stageId }) : null;
  if (target) {
    targets = targets.filter((o) => {
      if (isClosedStatus(o.status)) return (skipped.push({ id: o.id, reason: "Closed — reopen it first" }), false);
      if (o.stageId === target.stage.id) return (skipped.push({ id: o.id, reason: "Already in this stage" }), false);
      if (o.pipelineId && o.pipelineId !== target.pipeline.id) return (skipped.push({ id: o.id, reason: "In a different pipeline" }), false);
      return true;
    });
  }
  if (input.action === "status") {
    const to = input.status as OpportunityStatus;
    targets = targets.filter((o) => {
      if (o.status === to) return (skipped.push({ id: o.id, reason: "Already in this status" }), false);
      if (!canTransition(o.status as OpportunityStatus, to)) return (skipped.push({ id: o.id, reason: "Reopen it first" }), false);
      return true;
    });
  }
  const oldStageIds = target ? [...new Set(targets.map((o) => o.stageId).filter((v): v is string => Boolean(v)))] : [];
  const oldStages = new Map((await Promise.all(oldStageIds.map((sid) => getStage(actor.companyId, sid)))).filter((s): s is NonNullable<typeof s> => Boolean(s)).map((s) => [s.id, s]));

  let updated = 0;
  await runCrmMutation(actor, async (ctx) => {
    for (const o of targets) {
      if (input.action === "assign") {
        await CrmOpportunityRepository.updateRaw(o.id, { ownerUserId: input.ownerUserId, updatedByUserId: actor.userId }, ctx.tx);
        await ctx.audit({ tableName: TABLE, recordId: o.id, action: "UPDATE", oldValues: { ownerUserId: o.ownerUserId }, newValues: { ownerUserId: input.ownerUserId, bulk: true } });
        await emitOwnerChange(ctx, o.id, o.ownerUserId, input.ownerUserId);
        updated++;
      } else if (input.action === "stage" && target) {
        const oldStage = o.stageId ? (oldStages.get(o.stageId) ?? null) : null;
        const probability = nextProbability(o.probability, oldStage?.probability, target.stage.probability);
        await CrmOpportunityRepository.updateRaw(o.id, { stageId: target.stage.id, pipelineId: target.pipeline.id, stageChangedAt: new Date(), probability, updatedByUserId: actor.userId }, ctx.tx);
        await ctx.audit({ tableName: TABLE, recordId: o.id, action: "UPDATE", oldValues: { stageId: o.stageId, probability: o.probability }, newValues: { stageId: target.stage.id, probability, bulk: true } });
        emitStageChange(ctx, o.id, oldStage, target.stage, { from: o.probability, to: probability });
        updated++;
      } else if (input.action === "status") {
        const to = input.status as OpportunityStatus;
        const reason = textOrNull(input.reason);
        const data = isClosedStatus(to) ? { status: to, closedAt: new Date(), closedByUserId: actor.userId, closeReason: reason } : { status: to, closedAt: null, closedByUserId: null, closeReason: null };
        await CrmOpportunityRepository.updateRaw(o.id, { ...data, updatedByUserId: actor.userId }, ctx.tx);
        await ctx.audit({ tableName: TABLE, recordId: o.id, action: "UPDATE", oldValues: { status: o.status }, newValues: { status: to, reason, bulk: true } });
        ctx.emit({
          entityType: "OPPORTUNITY",
          entityId: o.id,
          eventType: STATUS_EVENT[to],
          summary: `${OPPORTUNITY_STATUSES[o.status as OpportunityStatus].label} → ${OPPORTUNITY_STATUSES[to].label}${reason ? ` · ${reason}` : ""}`,
          payload: { fromStatus: o.status, toStatus: to, reason, bulk: true },
        });
        updated++;
      } else if (input.action === "archive") {
        await CrmOpportunityRepository.updateRaw(o.id, { archivedAt: new Date(), archivedByUserId: actor.userId, updatedByUserId: actor.userId }, ctx.tx);
        await ctx.audit({ tableName: TABLE, recordId: o.id, action: "UPDATE", oldValues: { archivedAt: null }, newValues: { archived: true, bulk: true } });
        ctx.emit({ entityType: "OPPORTUNITY", entityId: o.id, eventType: "opportunity.archived", summary: `${o.opportunityNumber} — ${o.name}`, payload: { bulk: true } });
        updated++;
      } else if (input.action === "addTags" || input.action === "removeTags") {
        const change = input.action === "addTags" ? { addTagIds: input.tagIds, addTagNames: input.tagNames, removeTagIds: [] } : { addTagIds: [], addTagNames: [], removeTagIds: input.tagIds };
        const { added, removed } = await applyOpportunityTagsAndEmit(ctx, actor, o.id, change);
        if (added.length || removed.length) updated++;
        else skipped.push({ id: o.id, reason: input.action === "addTags" ? "Already has these tags" : "Doesn't have these tags" });
      }
    }
  });
  return { requested: ids.length, updated, skipped };
}
