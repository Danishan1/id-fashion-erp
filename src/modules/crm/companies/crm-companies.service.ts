import type { CrmCompany, Prisma } from "@prisma/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { PermissionService } from "@/core/rbac/PermissionService";
import type { CrmActor } from "../core/crm-actor";
import { runCrmMutation, type CrmMutationContext } from "../core/crm-mutation";
import { crmOwnerWhere, getCrmRecordScope, type CrmRecordScope } from "../core/crm-visibility";
import { listCustomFields, validateCustomFieldValues } from "../custom-fields/crm-custom-fields.service";
import {
  getCompanyStatusForCompany,
  getDefaultCompanyStatus,
  getLeadSourceByKey,
  getLeadSourceForCompany,
  listCompanyStatuses,
  listLeadSources,
  optionSuggestions,
} from "../settings/crm-settings.service";
import { applyEntityTagChange, tagsByEntity } from "../tags/crm-tags.service";
import type { EntityTagChange } from "../tags/crm-tag.schema";
import { contactAddressSchema, updateContactAddressSchema, type ContactAddressInput } from "../contacts/contact.schema";
import { assertCompanyDuplicatesAllowed, findCompanyDuplicates, type CompanyDuplicateKeys, type CompanyDuplicateResult } from "./company-duplicates";
import { buildCompanyOrderBy, buildCompanyWhere } from "./company-filters";
import { companyDerivedFields, companyMatchKey, normaliseWebsite, type CompanyCore } from "./company-keys";
import {
  assignCompanySchema,
  bulkCompanySchema,
  changeCompanyStatusSchema,
  companyDuplicateCheckSchema,
  createCompanySchema,
  linkCustomerSchema,
  updateCompanySchema,
  type CompanyFilter,
  type CompanySortField,
  type CreateCompanyInput,
  type UpdateCompanyInput,
} from "./company.schema";
import { CrmCompanyRepository, type CompanyListRow } from "./crm-company.repository";

/**
 * CRM Companies / Accounts — how the CRM understands and manages a business
 * relationship. The authoritative customer master is the ERP `Customer`; a
 * CRM company only references it (customer_id) and never copies or edits
 * its commercial, tax or financial data. Every way a company is created
 * (form, lead conversion, picking an ERP customer on a contact) goes through
 * this service so duplicate rules, derived keys, audit and events match.
 */

const TABLE = "crm_companies";
const blank = (v: unknown) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");
const textOrNull = (v: string | null | undefined) => (blank(v) ? null : (v as string).trim());

const TEXT_FIELDS = ["legalName", "displayName", "companyType", "industry", "email", "phone", "mobile", "city", "state", "postalCode", "country"] as const;
type TextField = (typeof TEXT_FIELDS)[number];
const KEY_FIELDS = ["name", "legalName", "website", "email", "phone", "mobile"] as const;
const TRACKED = ["name", ...TEXT_FIELDS, "website", "sourceId"] as const;

const conflict = (id: string) =>
  new BusinessRuleError("RECORD_VERSION_CONFLICT", "This company was changed by someone else after you opened it. Reload to see the latest version, then try again.", { id });

function websiteOrError(value: string | null | undefined) {
  try {
    return normaliseWebsite(value);
  } catch {
    throw new BusinessRuleError("VALIDATION_ERROR", "Enter a valid website, e.g. abc.com.", { fieldErrors: { website: "Enter a valid website" } });
  }
}

const dupKeys = (derived: ReturnType<typeof companyDerivedFields>, customerId: string | null): CompanyDuplicateKeys => ({
  nameMatchKey: derived.nameMatchKey,
  legalMatchKey: derived.legalMatchKey,
  websiteKey: derived.websiteKey,
  emailKeys: derived.emailKeys,
  phoneKeys: derived.phoneKeys,
  customerId,
});

// ── Phase 02 surface (pickers, lead conversion) ──────────────────

export async function searchCrmCompanies(actor: CrmActor, term: string | undefined, take = 20) {
  const scope = await getCrmRecordScope(actor);
  const t = term?.trim().toLowerCase();
  const where: Prisma.CrmCompanyWhereInput = {
    AND: [
      { companyId: actor.companyId, archivedAt: null, mergedIntoId: null },
      crmOwnerWhere(scope) as Prisma.CrmCompanyWhereInput,
      ...(t ? [{ OR: [{ searchText: { contains: t } }, { name: { contains: t, mode: "insensitive" as const } }] }] : []),
    ],
  };
  return CrmCompanyRepository.search(where, take);
}

/** Existing active companies with the same name (ignoring punctuation / legal suffixes) — shown before creating a new one. */
export async function findCompanyNameMatches(actor: CrmActor, name: string) {
  const key = companyMatchKey(name);
  if (!key) return [];
  const dup = await findCompanyDuplicates(actor.companyId, { nameMatchKey: key, legalMatchKey: null, websiteKey: null, emailKeys: [], phoneKeys: [], customerId: null }, undefined, [
    { rule: "NAME", action: "WARN" },
    { rule: "LEGAL_NAME", action: "WARN" },
  ]);
  const ids = new Set(dup.matches.filter((m) => !m.archived).map((m) => m.id));
  return ids.size ? CrmCompanyRepository.search({ id: { in: [...ids] } }, 5) : [];
}

/** Active company the actor may link to (visibility applies; merged/archived → not found). */
export async function getCrmCompanyForActor(actor: CrmActor, id: string, db?: Prisma.TransactionClient) {
  const scope = await getCrmRecordScope(actor);
  const company = await CrmCompanyRepository.findById({ AND: [{ id, companyId: actor.companyId, archivedAt: null, mergedIntoId: null }, crmOwnerWhere(scope) as Prisma.CrmCompanyWhereInput] }, db);
  if (!company) throw new BusinessRuleError("NOT_FOUND", "Company not found.", { id });
  return company;
}

/** Picking an ERP customer (link, contact form) needs read access to customers (masters or sales). */
export async function canLinkCustomers(actor: CrmActor) {
  const [masters, sales] = await Promise.all([PermissionService.can(actor.userId, "masters_core", "view"), PermissionService.can(actor.userId, "sales_orders", "view")]);
  return masters || sales;
}

export async function searchCustomersForLinking(actor: CrmActor, term: string | undefined, take = 20) {
  const rows = await CrmCompanyRepository.searchCustomers(actor.companyId, term?.trim() || undefined, take);
  return rows.map((c) => ({
    id: c.id,
    code: c.code,
    name: c.name,
    city: c.city,
    country: c.country,
    isActive: c.isActive,
    crmCompanyId: c.crmCompany && !c.crmCompany.archivedAt && !c.crmCompany.mergedIntoId ? c.crmCompany.id : null,
    linkedCompany: c.crmCompany ? { id: c.crmCompany.id, name: c.crmCompany.name, archived: Boolean(c.crmCompany.archivedAt) } : null,
  }));
}

export interface CompanyCreateData extends Partial<Record<TextField, string | null>> {
  name: string;
  website?: string | null;
  statusId?: string | null;
  sourceId?: string | null;
  ownerUserId?: string | null;
  customerId?: string | null;
  customFields?: Record<string, unknown>;
}

/**
 * Creates a company inside an existing CRM mutation (form, lead conversion,
 * ERP-customer pick). Duplicate rules are applied unless the caller already
 * ran them (`duplicates`); FLAG matches mark the new company for review.
 */
export async function createCrmCompanyInMutation(
  ctx: CrmMutationContext,
  actor: CrmActor,
  data: CompanyCreateData,
  {
    allowDuplicate = false,
    sourceLeadId,
    duplicates,
    duplicateErrorCode = "CRM_DUPLICATE_RECORD",
    customer,
  }: {
    allowDuplicate?: boolean;
    sourceLeadId?: string;
    duplicates?: CompanyDuplicateResult;
    duplicateErrorCode?: "CRM_POSSIBLE_DUPLICATE" | "CRM_DUPLICATE_RECORD";
    customer?: { code: string; name: string } | null;
  } = {}
) {
  const texts = Object.fromEntries(TEXT_FIELDS.map((f) => [f, textOrNull(data[f])])) as Record<TextField, string | null>;
  texts.email = texts.email?.toLowerCase() ?? null;
  const core: CompanyCore = { name: data.name.trim(), ...texts, website: websiteOrError(data.website) };
  const derived = companyDerivedFields(core, customer);
  const customerId = textOrNull(data.customerId);

  const dup = duplicates ?? (await findCompanyDuplicates(actor.companyId, dupKeys(derived, customerId)));
  assertCompanyDuplicatesAllowed(dup, allowDuplicate, duplicateErrorCode);
  const flagged = dup.flaggedIds;

  const statusId = textOrNull(data.statusId) ?? (await getDefaultCompanyStatus(actor.companyId))?.id ?? null;
  let sourceId = textOrNull(data.sourceId);
  if (!sourceId) {
    const manual = await getLeadSourceByKey(actor.companyId, "manual");
    sourceId = manual?.isActive ? manual.id : null;
  }

  const company = await CrmCompanyRepository.createRaw(
    {
      companyId: actor.companyId,
      ...core,
      ...derived,
      customerId,
      statusId,
      sourceId,
      sourceLeadId: sourceLeadId ?? null,
      ownerUserId: data.ownerUserId === undefined ? actor.userId : data.ownerUserId,
      customFields: (data.customFields ?? {}) as Prisma.InputJsonValue,
      duplicateFlaggedAt: flagged.length ? new Date() : null,
      flaggedDuplicateIds: flagged,
      lastActivityAt: new Date(),
      createdByUserId: actor.userId,
      updatedByUserId: actor.userId,
    },
    ctx.tx
  );
  await ctx.audit({ tableName: TABLE, recordId: company.id, action: "CREATE", newValues: company });
  ctx.emit({
    entityType: "COMPANY",
    entityId: company.id,
    eventType: "company.created",
    summary: company.name,
    payload: { ...(sourceLeadId ? { fromLeadId: sourceLeadId } : {}), ...(customerId ? { fromCustomerId: customerId, customerCode: customer?.code } : {}), ownerUserId: company.ownerUserId, statusId, sourceId },
  });
  if (customerId) ctx.emit({ entityType: "COMPANY", entityId: company.id, eventType: "company.erp_customer_linked", summary: customer ? `${customer.name} (${customer.code})` : undefined, payload: { customerId } });
  if (flagged.length) ctx.emit({ entityType: "COMPANY", entityId: company.id, eventType: "company.duplicate_flagged", summary: `${flagged.length} possible duplicate(s)`, payload: { companyIds: flagged } });
  return company;
}

/**
 * "This contact works at ERP customer X": reuses the CRM company that
 * references the customer, or creates one (name + location only — the
 * customer's commercial data stays on the ERP Customer). Similar existing
 * companies don't stop this (the user picked an authoritative customer) but
 * flag the new company for review. Trusted link: the ERP customer master is
 * company-wide, so CRM owner scope does not apply.
 */
export async function findOrCreateCrmCompanyForCustomer(ctx: CrmMutationContext, actor: CrmActor, customerId: string, ownerUserId: string | null) {
  const existing = await CrmCompanyRepository.findByCustomerId(actor.companyId, customerId, ctx.tx);
  if (existing) {
    if (existing.archivedAt || existing.mergedIntoId) throw new BusinessRuleError("INVALID_STATE_TRANSITION", `The CRM company "${existing.name}" for this customer is archived.`, { crmCompanyId: existing.id });
    return { company: existing, created: false };
  }
  const customer = await CrmCompanyRepository.customer(actor.companyId, customerId, ctx.tx);
  if (!customer) throw new BusinessRuleError("NOT_FOUND", "Customer not found.", { id: customerId });
  const derived = companyDerivedFields({ name: customer.name }, customer);
  const dup = await findCompanyDuplicates(actor.companyId, dupKeys(derived, customer.id));
  const asFlags: CompanyDuplicateResult = { matches: dup.matches, blocking: false, needsConfirmation: false, flaggedIds: dup.matches.map((m) => m.id) };
  const customerStatus = (await listCompanyStatuses(actor.companyId, { includeInactive: false })).find((s) => s.key === "customer");
  const company = await createCrmCompanyInMutation(
    ctx,
    actor,
    { name: customer.name, city: customer.city, country: customer.country, customerId: customer.id, ownerUserId, statusId: customerStatus?.id ?? null },
    { duplicates: asFlags, customer }
  );
  return { company, created: true };
}

// ── Reads ────────────────────────────────────────────────────────

function presentListRow(row: CompanyListRow, tags: { id: string; name: string; color: string | null }[], openOpportunities: number) {
  return { ...row, ownerInactive: row.owner ? row.owner.status !== "ACTIVE" : false, openOpportunities, tags };
}
export type CompanyListItem = ReturnType<typeof presentListRow>;

export async function listCompanies(actor: CrmActor, filter: CompanyFilter, sort: { sortBy: CompanySortField; sortOrder: "asc" | "desc" }, page: { skip: number; take: number }) {
  const scope = await getCrmRecordScope(actor);
  const tagMatched = filter.tagIds?.length ? (await CrmCompanyRepository.entityIdsWithAnyTag(actor.companyId, "COMPANY", filter.tagIds)).map((r) => r.entityId) : undefined;
  const where = buildCompanyWhere(actor.companyId, filter, scope, tagMatched);
  const [rows, totalCount] = await Promise.all([CrmCompanyRepository.findMany(where, buildCompanyOrderBy(sort.sortBy, sort.sortOrder), page.skip, page.take), CrmCompanyRepository.count(where)]);
  const ids = rows.map((r) => r.id);
  const [tags, opp] = await Promise.all([tagsByEntity(actor.companyId, "COMPANY", ids), CrmCompanyRepository.openOpportunityCounts(actor.companyId, ids)]);
  return { data: rows.map((r) => presentListRow(r, tags.get(r.id) ?? [], opp.get(r.id) ?? 0)), totalCount };
}

function scopedWhere(actor: CrmActor, scope: CrmRecordScope, id: string): Prisma.CrmCompanyWhereInput {
  return { AND: [{ id, companyId: actor.companyId }, crmOwnerWhere(scope) as Prisma.CrmCompanyWhereInput] };
}

/** Raw company the actor may act on (NOT_FOUND outside their visibility). Merged companies are read-only. */
export async function loadCompanyForActor(actor: CrmActor, id: string, { allowMerged = false, db }: { allowMerged?: boolean; db?: Prisma.TransactionClient } = {}) {
  const scope = await getCrmRecordScope(actor);
  const company = await CrmCompanyRepository.findRaw(scopedWhere(actor, scope, id), db);
  if (!company) throw new BusinessRuleError("NOT_FOUND", "Company not found.", { id });
  if (company.mergedIntoId && !allowMerged) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This company was merged into another company and can't be changed.", { mergedIntoId: company.mergedIntoId });
  return company;
}

export async function loadEditableCompany(actor: CrmActor, id: string, verb: string) {
  const company = await loadCompanyForActor(actor, id);
  if (company.archivedAt) throw new BusinessRuleError("INVALID_STATE_TRANSITION", `Restore this company before ${verb}.`);
  return company;
}

export async function getCompany(actor: CrmActor, id: string) {
  const scope = await getCrmRecordScope(actor);
  const company = await CrmCompanyRepository.findDetail(scopedWhere(actor, scope, id));
  if (!company) throw new BusinessRuleError("NOT_FOUND", "Company not found.", { id });
  const own = crmOwnerWhere(scope);
  const [tags, mergedIds, flagged, counts] = await Promise.all([
    tagsByEntity(actor.companyId, "COMPANY", [id]).then((m) => m.get(id) ?? []),
    CrmCompanyRepository.mergedIdsInto(actor.companyId, id),
    CrmCompanyRepository.summaries(actor.companyId, company.flaggedDuplicateIds),
    CrmCompanyRepository.relatedCounts(actor.companyId, id, own as Prisma.CrmContactWhereInput, own as Prisma.CrmLeadWhereInput, own as Prisma.CrmOpportunityWhereInput),
  ]);
  const names = new Map(
    (await CrmCompanyRepository.userNames([company.updatedByUserId, company.archivedByUserId, company.mergedByUserId].filter((v): v is string => Boolean(v)))).map((u) => [u.id, u.fullName])
  );
  const name = (uid: string | null) => (uid ? (names.get(uid) ?? null) : null);
  const { customer, ...rest } = company;
  return {
    ...rest,
    // ERP reference only: identity + status, never balances or transactions.
    customer: customer ? { id: customer.id, code: customer.code, name: customer.name, type: customer.type, status: customer.deletedAt ? "DELETED" : customer.isActive ? "ACTIVE" : "INACTIVE" } : null,
    tags,
    counts,
    mergedCompanyIds: mergedIds,
    ownerInactive: company.owner ? company.owner.status !== "ACTIVE" : false,
    updatedByName: name(company.updatedByUserId),
    archivedByName: name(company.archivedByUserId),
    mergedByName: name(company.mergedByUserId),
    flaggedDuplicates: flagged.filter((f) => !f.mergedIntoId).map((f) => ({ id: f.id, name: f.name, website: f.website, city: f.city, customerCode: f.customer?.code ?? null, archived: Boolean(f.archivedAt) })),
  };
}
export type CompanyDetail = Awaited<ReturnType<typeof getCompany>>;

/** Everything the company form and filters need in one call. */
export async function getCompanyFormMeta(actor: CrmActor) {
  const [statuses, sources, customFields, suggestions, canPickCustomer] = await Promise.all([
    listCompanyStatuses(actor.companyId),
    listLeadSources(actor.companyId),
    listCustomFields(actor.companyId, "COMPANY", { includeInactive: true }),
    optionSuggestions(actor.companyId),
    canLinkCustomers(actor),
  ]);
  return {
    statuses: statuses.map(({ id, key, name, color, isDefault, isActive }) => ({ id, key, name, color, isDefault, isActive })),
    sources: sources.map(({ id, key, name, isActive }) => ({ id, key, name, isActive })),
    customFields,
    suggestions: { company_industry: suggestions.company_industry ?? [], company_type: suggestions.company_type ?? [] },
    canPickCustomer,
  };
}

// ── Shared write helpers ─────────────────────────────────────────

async function assertAssignableOwner(companyId: string, userId: string) {
  const user = await CrmCompanyRepository.activeUserInCompany(companyId, userId);
  if (!user) throw new BusinessRuleError("VALIDATION_ERROR", "The selected owner is not an active user in this company.", { fieldErrors: { ownerUserId: "Choose an active user." } });
  return user;
}

async function assertSelectableSource(companyId: string, sourceId: string) {
  const source = await getLeadSourceForCompany(companyId, sourceId);
  if (!source.isActive) throw new BusinessRuleError("VALIDATION_ERROR", `"${source.name}" is no longer in use.`, { fieldErrors: { sourceId: "Choose an active source." } });
  return source;
}

async function assertSelectableStatus(companyId: string, statusId: string) {
  const status = await getCompanyStatusForCompany(companyId, statusId);
  if (!status.isActive) throw new BusinessRuleError("VALIDATION_ERROR", `"${status.name}" is no longer in use.`, { fieldErrors: { statusId: "Choose an active status." } });
  return status;
}

/** Validates an ERP customer for linking: exists, not deleted, user may see customers, not linked to another company. */
async function assertLinkableCustomer(actor: CrmActor, customerId: string, forCompanyId?: string) {
  if (!(await canLinkCustomers(actor))) throw new BusinessRuleError("PERMISSION_DENIED", "You don't have access to ERP customers.");
  const customer = await CrmCompanyRepository.customer(actor.companyId, customerId);
  if (!customer) throw new BusinessRuleError("NOT_FOUND", "ERP customer not found.", { id: customerId });
  const linked = await CrmCompanyRepository.findByCustomerId(actor.companyId, customerId);
  if (linked && linked.id !== forCompanyId) {
    throw new BusinessRuleError("CRM_DUPLICATE_RECORD", `This ERP customer is already linked to the CRM company "${linked.name}"${linked.archivedAt ? " (archived)" : ""}.`, {
      entityType: "COMPANY",
      blocking: true,
      matches: [{ id: linked.id, name: linked.name, archived: Boolean(linked.archivedAt), rules: ["ERP_CUSTOMER"], action: "BLOCK" }],
    });
  }
  return customer;
}

function addressData(input: ContactAddressInput) {
  return {
    addressType: input.addressType,
    label: textOrNull(input.label),
    line1: input.line1.trim(),
    line2: textOrNull(input.line2),
    city: textOrNull(input.city),
    state: textOrNull(input.state),
    postalCode: textOrNull(input.postalCode),
    country: textOrNull(input.country),
  };
}
const addressSummary = (a: { line1: string; city: string | null; country: string | null }) => [a.line1, a.city, a.country].filter(Boolean).join(", ");

/** Recomputes stored match keys / search text (after a customer link change). No version bump. */
export async function refreshCompanyDerived(ctx: CrmMutationContext, id: string) {
  const c = await CrmCompanyRepository.findRaw({ id }, ctx.tx);
  if (!c) return;
  const customer = c.customerId ? await CrmCompanyRepository.customer(c.companyId, c.customerId, ctx.tx) : null;
  await CrmCompanyRepository.setDerived(id, companyDerivedFields(c, customer), ctx.tx);
}

async function emitOwnerChange(ctx: CrmMutationContext, id: string, from: string | null, to: string | null) {
  const names = new Map((await CrmCompanyRepository.userNames([from, to].filter((v): v is string => Boolean(v)))).map((u) => [u.id, u.fullName]));
  const label = (uid: string | null) => (uid ? (names.get(uid) ?? "Unknown user") : "Unassigned");
  ctx.emit({ entityType: "COMPANY", entityId: id, eventType: "company.owner_changed", summary: from ? `${label(from)} → ${label(to)}` : `Assigned to ${label(to)}`, payload: { fromUserId: from, toUserId: to } });
}

function emitStatusChange(ctx: CrmMutationContext, id: string, from: { id: string; name: string } | null, to: { id: string; name: string; key: string }) {
  ctx.emit({ entityType: "COMPANY", entityId: id, eventType: "company.status_changed", summary: from ? `${from.name} → ${to.name}` : `Status: ${to.name}`, payload: { fromStatusId: from?.id ?? null, toStatusId: to.id, toStatusKey: to.key } });
}

export async function applyCompanyTagsAndEmit(ctx: CrmMutationContext, actor: CrmActor, id: string, change: Pick<EntityTagChange, "addTagIds" | "addTagNames" | "removeTagIds">) {
  const { added, removed } = await applyEntityTagChange(actor, "COMPANY", id, change, ctx.tx);
  for (const t of added) ctx.emit({ entityType: "COMPANY", entityId: id, eventType: "company.tag_added", summary: t.name, payload: { tagId: t.id } });
  for (const t of removed) ctx.emit({ entityType: "COMPANY", entityId: id, eventType: "company.tag_removed", summary: t.name, payload: { tagId: t.id } });
  if (added.length || removed.length) await ctx.audit({ tableName: "crm_entity_tags", recordId: id, action: "UPDATE", newValues: { entityType: "COMPANY", added: added.map((t) => t.name), removed: removed.map((t) => t.name) } });
  return { added, removed };
}

async function versionedUpdate(ctx: CrmMutationContext, company: CrmCompany, expectedVersion: number | undefined, data: Prisma.CrmCompanyUncheckedUpdateManyInput, actor: CrmActor) {
  const { count } = await CrmCompanyRepository.updateVersioned(company.id, expectedVersion ?? company.version, { ...data, updatedByUserId: actor.userId }, ctx.tx);
  if (count === 0) throw conflict(company.id);
  return (await CrmCompanyRepository.findRaw({ id: company.id }, ctx.tx))!;
}

const comparable = (v: unknown) => (v instanceof Date ? v.toISOString() : (v ?? null));

/** Company name / location changed → contacts' search text (which includes the company name) is refreshed. */
async function refreshContactsOf(ctx: CrmMutationContext, actor: CrmActor, id: string) {
  const { refreshContactDerived } = await import("../contacts/crm-contacts.service");
  for (const c of await CrmCompanyRepository.contactIdsOf(actor.companyId, id, ctx.tx)) await refreshContactDerived(ctx, c.id, actor.companyId);
}

// ── Create ───────────────────────────────────────────────────────

export async function createCompany(actor: CrmActor, raw: unknown) {
  const input: CreateCompanyInput = createCompanySchema.parse(raw);

  let ownerUserId = input.ownerUserId === undefined ? actor.userId : textOrNull(input.ownerUserId);
  if (ownerUserId && input.ownerUserId === undefined) {
    if (!(await CrmCompanyRepository.activeUserInCompany(actor.companyId, ownerUserId))) ownerUserId = null;
  } else if (ownerUserId) await assertAssignableOwner(actor.companyId, ownerUserId);

  const statusId = input.statusId ? (await assertSelectableStatus(actor.companyId, input.statusId)).id : null;
  const sourceId = input.sourceId ? (await assertSelectableSource(actor.companyId, input.sourceId)).id : null;
  const customerId = textOrNull(input.customerId);
  const customer = customerId ? await assertLinkableCustomer(actor, customerId) : null;

  const definitions = await listCustomFields(actor.companyId, "COMPANY", { includeInactive: true });
  const customFields = validateCustomFieldValues(definitions, input.customFields);
  const addresses = (input.addresses ?? []).map((a) => contactAddressSchema.parse(a));

  const texts = Object.fromEntries(TEXT_FIELDS.map((f) => [f, textOrNull(input[f])])) as Record<TextField, string | null>;
  const derived = companyDerivedFields({ name: input.name, ...texts, website: websiteOrError(input.website) }, customer);
  const duplicates = await findCompanyDuplicates(actor.companyId, dupKeys(derived, customerId));
  assertCompanyDuplicatesAllowed(duplicates, input.confirmDuplicate);

  return runCrmMutation(actor, async (ctx) => {
    const company = await createCrmCompanyInMutation(
      ctx,
      actor,
      { ...input, ...texts, statusId, sourceId, ownerUserId, customerId, customFields },
      { allowDuplicate: true, duplicates, customer }
    );
    const primaryIndex = Math.max(0, addresses.findIndex((a) => a.isPrimary));
    for (const [i, a] of addresses.entries()) {
      await ctx.tx.crmAddress.create({ data: { companyId: actor.companyId, crmCompanyId: company.id, ...addressData(a), isPrimary: i === primaryIndex, createdByUserId: actor.userId } });
    }
    if (input.tagIds?.length || input.tagNames?.length) await applyCompanyTagsAndEmit(ctx, actor, company.id, { addTagIds: input.tagIds ?? [], addTagNames: input.tagNames ?? [], removeTagIds: [] });
    return company;
  });
}

// ── Update ───────────────────────────────────────────────────────

export async function updateCompany(actor: CrmActor, id: string, raw: unknown) {
  const input: UpdateCompanyInput = updateCompanySchema.parse(raw);
  const before = await loadEditableCompany(actor, id, "editing it");
  if (input.version !== before.version) throw conflict(id);

  const data: Prisma.CrmCompanyUncheckedUpdateManyInput = {};
  if (input.name !== undefined) data.name = input.name.trim();
  for (const f of TEXT_FIELDS) {
    if (input[f] !== undefined) {
      const v = textOrNull(input[f]);
      data[f] = f === "email" ? (v?.toLowerCase() ?? null) : v;
    }
  }
  if (input.website !== undefined) data.website = websiteOrError(input.website);
  if (input.sourceId !== undefined) {
    data.sourceId = textOrNull(input.sourceId);
    if (data.sourceId && data.sourceId !== before.sourceId) await assertSelectableSource(actor.companyId, data.sourceId as string);
  }
  if (input.customFields !== undefined) {
    const definitions = await listCustomFields(actor.companyId, "COMPANY", { includeInactive: true });
    data.customFields = validateCustomFieldValues(definitions, input.customFields, (before.customFields as Record<string, unknown>) ?? {}) as Prisma.InputJsonValue;
  }
  let newOwner: string | null | undefined;
  if (input.ownerUserId !== undefined) {
    const next = textOrNull(input.ownerUserId);
    if (next !== before.ownerUserId) {
      if (next) await assertAssignableOwner(actor.companyId, next);
      newOwner = next;
    }
  }
  let newStatus: Awaited<ReturnType<typeof assertSelectableStatus>> | null = null;
  const statusIdInput = textOrNull(input.statusId);
  if (statusIdInput && statusIdInput !== before.statusId) newStatus = await assertSelectableStatus(actor.companyId, statusIdInput);

  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const f of TRACKED) {
    if (data[f] !== undefined && comparable(data[f]) !== comparable(before[f])) changes[f] = { from: comparable(before[f]), to: comparable(data[f]) };
  }
  if (data.customFields !== undefined && JSON.stringify(data.customFields) !== JSON.stringify(before.customFields)) changes.customFields = { from: before.customFields, to: data.customFields };
  if (!Object.keys(changes).length && newOwner === undefined && !newStatus) return before;

  const merged = { ...before, ...data } as CrmCompany;
  if (KEY_FIELDS.some((f) => changes[f])) {
    const derived = companyDerivedFields(merged);
    const dup = await findCompanyDuplicates(actor.companyId, dupKeys(derived, before.customerId), id);
    // FLAG rules only apply when a company is created.
    assertCompanyDuplicatesAllowed({ ...dup, flaggedIds: [] }, input.confirmDuplicate);
  }
  if (newOwner !== undefined) data.ownerUserId = newOwner;
  if (newStatus) data.statusId = newStatus.id;
  const previousStatus = newStatus && before.statusId ? await getCompanyStatusForCompany(actor.companyId, before.statusId).catch(() => null) : null;

  return runCrmMutation(actor, async (ctx) => {
    await versionedUpdate(ctx, before, input.version, data, actor);
    await refreshCompanyDerived(ctx, id);
    const after = (await CrmCompanyRepository.findRaw({ id }, ctx.tx))!;
    if (changes.name) await refreshContactsOf(ctx, actor, id);
    await ctx.audit({ tableName: TABLE, recordId: id, action: "UPDATE", oldValues: before, newValues: after });
    if (Object.keys(changes).length) ctx.emit({ entityType: "COMPANY", entityId: id, eventType: "company.updated", summary: `Updated ${Object.keys(changes).length} field(s)`, payload: { changes } });
    if (newOwner !== undefined) await emitOwnerChange(ctx, id, before.ownerUserId, newOwner);
    if (newStatus) emitStatusChange(ctx, id, previousStatus, newStatus);
    return after;
  });
}

// ── Focused actions ──────────────────────────────────────────────

export async function assignCompany(actor: CrmActor, id: string, raw: unknown) {
  const { ownerUserId, version } = assignCompanySchema.parse(raw);
  const before = await loadEditableCompany(actor, id, "reassigning it");
  if (ownerUserId === before.ownerUserId) return before;
  if (ownerUserId) await assertAssignableOwner(actor.companyId, ownerUserId);
  return runCrmMutation(actor, async (ctx) => {
    const after = await versionedUpdate(ctx, before, version, { ownerUserId }, actor);
    await ctx.audit({ tableName: TABLE, recordId: id, action: "UPDATE", oldValues: { ownerUserId: before.ownerUserId }, newValues: { ownerUserId } });
    await emitOwnerChange(ctx, id, before.ownerUserId, ownerUserId);
    return after;
  });
}

/** Explicit status change (never driven by ERP activity — no automatic rule exists). */
export async function changeCompanyStatus(actor: CrmActor, id: string, raw: unknown) {
  const { statusId, version } = changeCompanyStatusSchema.parse(raw);
  const before = await loadEditableCompany(actor, id, "changing its status");
  if (statusId === before.statusId) return before;
  const [status, previous] = await Promise.all([assertSelectableStatus(actor.companyId, statusId), before.statusId ? getCompanyStatusForCompany(actor.companyId, before.statusId).catch(() => null) : null]);
  return runCrmMutation(actor, async (ctx) => {
    const after = await versionedUpdate(ctx, before, version, { statusId }, actor);
    await ctx.audit({ tableName: TABLE, recordId: id, action: "UPDATE", oldValues: { statusId: before.statusId }, newValues: { statusId } });
    emitStatusChange(ctx, id, previous, status);
    return after;
  });
}

export async function changeCompanyTags(actor: CrmActor, id: string, change: EntityTagChange) {
  await loadEditableCompany(actor, id, "changing its tags");
  await runCrmMutation(actor, (ctx) => applyCompanyTagsAndEmit(ctx, actor, id, change));
  return (await tagsByEntity(actor.companyId, "COMPANY", [id])).get(id) ?? [];
}

/** CRM-only archive: contacts, leads, opportunities, documents and the ERP customer link stay; nothing in the ERP changes. */
export async function archiveCompany(actor: CrmActor, id: string) {
  const before = await loadCompanyForActor(actor, id);
  if (before.archivedAt) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This company is already archived.");
  return runCrmMutation(actor, async (ctx) => {
    const after = await versionedUpdate(ctx, before, undefined, { archivedAt: new Date(), archivedByUserId: actor.userId }, actor);
    await ctx.audit({ tableName: TABLE, recordId: id, action: "UPDATE", oldValues: { archivedAt: null }, newValues: { archivedAt: after.archivedAt } });
    ctx.emit({ entityType: "COMPANY", entityId: id, eventType: "company.archived", summary: before.name });
    return after;
  });
}

export async function restoreCompany(actor: CrmActor, id: string) {
  const before = await loadCompanyForActor(actor, id);
  if (!before.archivedAt) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This company is not archived.");
  return runCrmMutation(actor, async (ctx) => {
    const after = await versionedUpdate(ctx, before, undefined, { archivedAt: null, archivedByUserId: null }, actor);
    await ctx.audit({ tableName: TABLE, recordId: id, action: "UPDATE", oldValues: { archivedAt: before.archivedAt }, newValues: { archivedAt: null } });
    ctx.emit({ entityType: "COMPANY", entityId: id, eventType: "company.restored", summary: before.name });
    return after;
  });
}

export async function checkCompanyDuplicates(actor: CrmActor, raw: unknown) {
  const input = companyDuplicateCheckSchema.parse(raw);
  let website: string | null = null;
  try {
    website = normaliseWebsite(input.website);
  } catch {
    website = null;
  }
  const derived = companyDerivedFields({ name: input.name ?? "", legalName: input.legalName, website, email: input.email, phone: input.phone, mobile: input.mobile });
  return findCompanyDuplicates(actor.companyId, dupKeys(derived, textOrNull(input.customerId)), textOrNull(input.excludeCompanyId) ?? undefined);
}

export async function dismissCompanyDuplicateFlag(actor: CrmActor, id: string) {
  const before = await loadCompanyForActor(actor, id);
  if (!before.duplicateFlaggedAt) return before;
  return runCrmMutation(actor, async (ctx) => {
    const after = await versionedUpdate(ctx, before, undefined, { duplicateFlaggedAt: null, flaggedDuplicateIds: [] }, actor);
    await ctx.audit({ tableName: TABLE, recordId: id, action: "UPDATE", oldValues: { flaggedDuplicateIds: before.flaggedDuplicateIds }, newValues: { flaggedDuplicateIds: [] } });
    ctx.emit({ entityType: "COMPANY", entityId: id, eventType: "company.duplicate_dismissed", summary: "Marked as not a duplicate", payload: { companyIds: before.flaggedDuplicateIds } });
    return after;
  });
}

// ── ERP customer link ────────────────────────────────────────────

/**
 * Links an existing ERP customer (never creates or edits one). Validates that
 * the customer exists (not deleted), the user may view customers and the
 * customer isn't already linked to another CRM company; other duplicate
 * signals (same name / website…) warn like any company save.
 */
export async function linkErpCustomer(actor: CrmActor, id: string, raw: unknown) {
  const { customerId, confirmDuplicate } = linkCustomerSchema.parse(raw);
  const before = await loadEditableCompany(actor, id, "linking an ERP customer");
  if (before.customerId === customerId) return before;
  if (before.customerId) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This company is already linked to an ERP customer. Unlink it first.");
  const customer = await assertLinkableCustomer(actor, customerId, id);
  const dup = await findCompanyDuplicates(actor.companyId, dupKeys(companyDerivedFields({ name: customer.name }), customerId), id);
  assertCompanyDuplicatesAllowed({ ...dup, flaggedIds: [] }, confirmDuplicate);
  return runCrmMutation(actor, async (ctx) => {
    const after = await versionedUpdate(ctx, before, undefined, { customerId }, actor);
    await refreshCompanyDerived(ctx, id);
    await ctx.audit({ tableName: TABLE, recordId: id, action: "UPDATE", oldValues: { customerId: null }, newValues: { customerId, customerCode: customer.code } });
    ctx.emit({ entityType: "COMPANY", entityId: id, eventType: "company.erp_customer_linked", summary: `${customer.name} (${customer.code})`, payload: { customerId, customerCode: customer.code } });
    return after;
  });
}

/** Removes the reference only — the ERP customer and its transactions are untouched. */
export async function unlinkErpCustomer(actor: CrmActor, id: string) {
  const before = await loadEditableCompany(actor, id, "unlinking the ERP customer");
  if (!before.customerId) return before;
  if (!(await canLinkCustomers(actor))) throw new BusinessRuleError("PERMISSION_DENIED", "You don't have access to ERP customers.");
  const customer = await CrmCompanyRepository.customer(actor.companyId, before.customerId);
  return runCrmMutation(actor, async (ctx) => {
    const after = await versionedUpdate(ctx, before, undefined, { customerId: null }, actor);
    await refreshCompanyDerived(ctx, id);
    await ctx.audit({ tableName: TABLE, recordId: id, action: "UPDATE", oldValues: { customerId: before.customerId }, newValues: { customerId: null } });
    ctx.emit({ entityType: "COMPANY", entityId: id, eventType: "company.erp_customer_unlinked", summary: customer ? `${customer.name} (${customer.code})` : undefined, payload: { customerId: before.customerId } });
    return after;
  });
}

// ── Addresses (shared crm_addresses table) ───────────────────────

export async function addCompanyAddress(actor: CrmActor, id: string, raw: unknown) {
  await loadEditableCompany(actor, id, "changing it");
  const input = contactAddressSchema.parse(raw);
  return runCrmMutation(actor, async (ctx) => {
    await CrmCompanyRepository.lockForUpdate([id], ctx.tx);
    const existing = await CrmCompanyRepository.addresses(id, ctx.tx);
    const isPrimary = Boolean(input.isPrimary) || existing.length === 0;
    if (isPrimary) await CrmCompanyRepository.clearPrimaryAddress(id, ctx.tx);
    const row = await ctx.tx.crmAddress.create({ data: { companyId: actor.companyId, crmCompanyId: id, ...addressData(input), isPrimary, createdByUserId: actor.userId } });
    await ctx.audit({ tableName: "crm_addresses", recordId: row.id, action: "CREATE", newValues: row });
    ctx.emit({ entityType: "COMPANY", entityId: id, eventType: "company.address_added", summary: addressSummary(row), payload: { addressId: row.id, addressType: row.addressType } });
    return row;
  });
}

export async function updateCompanyAddress(actor: CrmActor, id: string, addressId: string, raw: unknown) {
  await loadEditableCompany(actor, id, "changing it");
  const input = updateContactAddressSchema.parse(raw);
  const before = await CrmCompanyRepository.findAddress(actor.companyId, id, addressId);
  if (!before) throw new BusinessRuleError("NOT_FOUND", "Address not found.", { id: addressId });
  const next = contactAddressSchema.parse({ ...before, ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) });
  return runCrmMutation(actor, async (ctx) => {
    await CrmCompanyRepository.lockForUpdate([id], ctx.tx);
    if (input.isPrimary) await CrmCompanyRepository.clearPrimaryAddress(id, ctx.tx, addressId);
    const row = await ctx.tx.crmAddress.update({ where: { id: addressId }, data: { ...addressData(next), ...(input.isPrimary ? { isPrimary: true } : {}) } });
    await ctx.audit({ tableName: "crm_addresses", recordId: addressId, action: "UPDATE", oldValues: before, newValues: row });
    ctx.emit({ entityType: "COMPANY", entityId: id, eventType: "company.address_updated", summary: addressSummary(row), payload: { addressId } });
    return row;
  });
}

export async function deleteCompanyAddress(actor: CrmActor, id: string, addressId: string) {
  await loadEditableCompany(actor, id, "changing it");
  const before = await CrmCompanyRepository.findAddress(actor.companyId, id, addressId);
  if (!before) throw new BusinessRuleError("NOT_FOUND", "Address not found.", { id: addressId });
  await runCrmMutation(actor, async (ctx) => {
    await CrmCompanyRepository.lockForUpdate([id], ctx.tx);
    await ctx.tx.crmAddress.delete({ where: { id: addressId } });
    if (before.isPrimary) {
      const [next] = await CrmCompanyRepository.addresses(id, ctx.tx);
      if (next) await ctx.tx.crmAddress.update({ where: { id: next.id }, data: { isPrimary: true } });
    }
    await ctx.audit({ tableName: "crm_addresses", recordId: addressId, action: "DELETE", oldValues: before });
    ctx.emit({ entityType: "COMPANY", entityId: id, eventType: "company.address_removed", summary: addressSummary(before), payload: { addressId } });
  });
}

// ── Bulk ─────────────────────────────────────────────────────────

export async function bulkCompanyAction(actor: CrmActor, raw: unknown) {
  const input = bulkCompanySchema.parse(raw);
  const scope = await getCrmRecordScope(actor);
  const ids = [...new Set(input.ids)];
  const rows = await CrmCompanyRepository.findManyRaw({ AND: [{ id: { in: ids }, companyId: actor.companyId, mergedIntoId: null }, crmOwnerWhere(scope) as Prisma.CrmCompanyWhereInput] });
  const found = new Map(rows.map((c) => [c.id, c]));
  const skipped: { id: string; reason: string }[] = ids.filter((i) => !found.has(i)).map((i) => ({ id: i, reason: "Not found or not visible to you" }));
  let targets = rows.filter((c) => (c.archivedAt ? (skipped.push({ id: c.id, reason: "Archived" }), false) : true));
  if (input.action === "assign") {
    if (input.ownerUserId) await assertAssignableOwner(actor.companyId, input.ownerUserId);
    targets = targets.filter((c) => (c.ownerUserId === input.ownerUserId ? (skipped.push({ id: c.id, reason: "Already assigned to this owner" }), false) : true));
  }
  const status = input.action === "status" ? await assertSelectableStatus(actor.companyId, input.statusId) : null;
  if (status) targets = targets.filter((c) => (c.statusId === status.id ? (skipped.push({ id: c.id, reason: "Already in this status" }), false) : true));
  const statusNames = status ? new Map((await listCompanyStatuses(actor.companyId)).map((s) => [s.id, s])) : new Map();
  let updated = 0;
  await runCrmMutation(actor, async (ctx) => {
    for (const c of targets) {
      if (input.action === "assign") {
        await CrmCompanyRepository.updateRaw(c.id, { ownerUserId: input.ownerUserId, updatedByUserId: actor.userId }, ctx.tx);
        await ctx.audit({ tableName: TABLE, recordId: c.id, action: "UPDATE", oldValues: { ownerUserId: c.ownerUserId }, newValues: { ownerUserId: input.ownerUserId, bulk: true } });
        await emitOwnerChange(ctx, c.id, c.ownerUserId, input.ownerUserId);
        updated++;
      } else if (input.action === "status" && status) {
        await CrmCompanyRepository.updateRaw(c.id, { statusId: status.id, updatedByUserId: actor.userId }, ctx.tx);
        await ctx.audit({ tableName: TABLE, recordId: c.id, action: "UPDATE", oldValues: { statusId: c.statusId }, newValues: { statusId: status.id, bulk: true } });
        emitStatusChange(ctx, c.id, c.statusId ? (statusNames.get(c.statusId) ?? null) : null, status);
        updated++;
      } else if (input.action === "archive") {
        await CrmCompanyRepository.updateRaw(c.id, { archivedAt: new Date(), archivedByUserId: actor.userId, updatedByUserId: actor.userId }, ctx.tx);
        await ctx.audit({ tableName: TABLE, recordId: c.id, action: "UPDATE", oldValues: { archivedAt: null }, newValues: { archived: true, bulk: true } });
        ctx.emit({ entityType: "COMPANY", entityId: c.id, eventType: "company.archived", summary: c.name, payload: { bulk: true } });
        updated++;
      } else if (input.action === "addTags" || input.action === "removeTags") {
        const change = input.action === "addTags" ? { addTagIds: input.tagIds, addTagNames: input.tagNames, removeTagIds: [] } : { addTagIds: [], addTagNames: [], removeTagIds: input.tagIds };
        const { added, removed } = await applyCompanyTagsAndEmit(ctx, actor, c.id, change);
        if (added.length || removed.length) updated++;
        else skipped.push({ id: c.id, reason: input.action === "addTags" ? "Already has these tags" : "Doesn't have these tags" });
      }
    }
  });
  return { requested: ids.length, updated, skipped };
}
