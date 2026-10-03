import type { CrmContact, Prisma } from "@prisma/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { PermissionService } from "@/core/rbac/PermissionService";
import type { CrmActor } from "../core/crm-actor";
import { runCrmMutation, type CrmMutationContext } from "../core/crm-mutation";
import { crmOwnerWhere, getCrmRecordScope, type CrmRecordScope } from "../core/crm-visibility";
import { findOrCreateCrmCompanyForCustomer, getCrmCompanyForActor } from "../companies/crm-companies.service";
import { listCustomFields, validateCustomFieldValues } from "../custom-fields/crm-custom-fields.service";
import { getLeadSourceByKey, getLeadSourceForCompany, listLeadSources, optionSuggestions } from "../settings/crm-settings.service";
import { applyEntityTagChange, tagsByEntity } from "../tags/crm-tags.service";
import type { EntityTagChange } from "../tags/crm-tag.schema";
import { assertContactDuplicatesAllowed, contactDuplicateKeys, findContactDuplicates, type ContactDuplicateResult } from "./contact-duplicates";
import { buildContactOrderBy, buildContactWhere } from "./contact-filters";
import { channelValueKey, contactDerivedFields, contactMatchKeys } from "./contact-keys";
import { CONTACT_CHANNEL_TYPES, type ContactChannelType } from "./contact-registry";
import {
  assignContactSchema,
  bulkContactSchema,
  contactAddressSchema,
  contactChannelSchema,
  contactDuplicateCheckSchema,
  contactabilityChangeSchema,
  createContactSchema,
  updateContactAddressSchema,
  updateContactSchema,
  type ContactAddressInput,
  type ContactFilter,
  type ContactSortField,
  type CreateContactInput,
  type UpdateContactInput,
} from "./contact.schema";
import { canContact, contactabilitySummary } from "./contactability";
import { CrmContactRepository, type ContactListRow } from "./crm-contact.repository";

/**
 * CRM Contacts — the CRM's person record (the ERP has no person master).
 * Every way a contact is created (form, lead conversion, later imports and
 * integrations) goes through this service so duplicate rules, derived match
 * keys, audit and timeline events are identical. Reaches the ERP Customer
 * only through its CRM company; nothing from the Customer is copied here.
 */

const TABLE = "crm_contacts";
const blank = (v: unknown) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");
const textOrNull = (v: string | null | undefined) => (blank(v) ? null : (v as string).trim());

const TEXT_FIELDS = ["middleName", "lastName", "designation", "department", "relationshipRole", "email", "alternateEmail", "phone", "mobile", "whatsapp"] as const;
type TextField = (typeof TEXT_FIELDS)[number];
const KEY_FIELDS = ["firstName", "middleName", "lastName", "email", "alternateEmail", "phone", "mobile", "whatsapp", "crmCompanyId"] as const;
const TRACKED = ["firstName", ...TEXT_FIELDS, "crmCompanyId", "sourceId"] as const;

const conflict = (id: string) =>
  new BusinessRuleError("RECORD_VERSION_CONFLICT", "This contact was changed by someone else after you opened it. Reload to see the latest version, then try again.", { id });

export interface NewChannel {
  channelType: string;
  value: string;
  label?: string | null;
}

// ── Phase 02 surface (lookup + creation during lead conversion) ──

export async function searchCrmContacts(actor: CrmActor, term: string | undefined, take = 20) {
  const scope = await getCrmRecordScope(actor);
  const t = term?.trim().toLowerCase();
  const where: Prisma.CrmContactWhereInput = {
    AND: [
      { companyId: actor.companyId, archivedAt: null, mergedIntoId: null },
      crmOwnerWhere(scope) as Prisma.CrmContactWhereInput,
      ...(t ? [{ OR: [{ searchText: { contains: t } }, { fullName: { contains: t, mode: "insensitive" as const } }] }] : []),
    ],
  };
  return CrmContactRepository.search(where, take);
}

/** Phase 02 helper kept for callers: match keys of a lead/contact's core fields. */
export function contactKeys(c: { email?: string | null; phone?: string | null; mobile?: string | null; whatsapp?: string | null; alternateEmail?: string | null }) {
  return contactMatchKeys({ firstName: "", ...c });
}

/** Existing (active, unmerged) contacts sharing an email or phone — conversion suggestions. */
export async function findContactMatches(actor: CrmActor, details: Parameters<typeof contactKeys>[0]) {
  const keys = contactKeys(details);
  return CrmContactRepository.findMatches(actor.companyId, keys.emailKeys, keys.phoneKeys);
}

/** Active contact the actor may link to (visibility applies; merged/archived → not found). */
export async function getCrmContactForActor(actor: CrmActor, id: string, db?: Prisma.TransactionClient) {
  const scope = await getCrmRecordScope(actor);
  const contact = await CrmContactRepository.findById({ AND: [{ id, companyId: actor.companyId, archivedAt: null, mergedIntoId: null }, crmOwnerWhere(scope) as Prisma.CrmContactWhereInput] }, db);
  if (!contact) throw new BusinessRuleError("NOT_FOUND", "Contact not found.", { id });
  return contact;
}

export interface ContactCreateData {
  firstName: string;
  middleName?: string | null;
  lastName?: string | null;
  designation?: string | null;
  department?: string | null;
  relationshipRole?: string | null;
  email?: string | null;
  alternateEmail?: string | null;
  phone?: string | null;
  mobile?: string | null;
  whatsapp?: string | null;
  crmCompanyId?: string | null;
  sourceId?: string | null;
  ownerUserId?: string | null;
  customFields?: Record<string, unknown>;
}

/**
 * Creates a contact inside an existing CRM mutation (used by the contact form
 * and by lead conversion). Duplicate rules are applied here unless the caller
 * already ran them (`duplicates`); FLAG matches mark the new contact for review.
 */
export async function createCrmContactInMutation(
  ctx: CrmMutationContext,
  actor: CrmActor,
  data: ContactCreateData,
  {
    allowDuplicate = false,
    sourceLeadId,
    channels = [],
    duplicates,
    duplicateErrorCode = "CRM_DUPLICATE_RECORD",
  }: { allowDuplicate?: boolean; sourceLeadId?: string; channels?: NewChannel[]; duplicates?: ContactDuplicateResult; duplicateErrorCode?: "CRM_POSSIBLE_DUPLICATE" | "CRM_DUPLICATE_RECORD" } = {}
) {
  const texts = Object.fromEntries(TEXT_FIELDS.map((f) => [f, textOrNull(data[f])])) as Record<TextField, string | null>;
  texts.email = texts.email?.toLowerCase() ?? null;
  texts.alternateEmail = texts.alternateEmail?.toLowerCase() ?? null;
  const firstName = data.firstName.trim();
  const crmCompanyId = textOrNull(data.crmCompanyId);
  const company = await CrmContactRepository.crmCompanyName(actor.companyId, crmCompanyId, ctx.tx);
  const derived = contactDerivedFields({ firstName, ...texts }, channels, company?.name);

  const dup = duplicates ?? (await findContactDuplicates(actor.companyId, contactDuplicateKeys({ ...derived, ...texts, crmCompanyId })));
  assertContactDuplicatesAllowed(dup, allowDuplicate, duplicateErrorCode);
  const flagged = dup.flaggedIds;

  const contact = await CrmContactRepository.createRaw(
    {
      companyId: actor.companyId,
      firstName,
      ...texts,
      ...derived,
      crmCompanyId,
      sourceId: textOrNull(data.sourceId),
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
  if (channels.length) {
    await CrmContactRepository.createChannels(
      channels.map((ch) => ({ companyId: actor.companyId, contactId: contact.id, channelType: ch.channelType, value: ch.value, valueKey: channelValueKey(ch.channelType, ch.value), label: ch.label ?? null, createdByUserId: actor.userId })),
      ctx.tx
    );
  }
  await ctx.audit({ tableName: TABLE, recordId: contact.id, action: "CREATE", newValues: { ...contact, channels } });
  ctx.emit({
    entityType: "CONTACT",
    entityId: contact.id,
    eventType: "contact.created",
    summary: [contact.fullName, company?.name].filter(Boolean).join(" · "),
    payload: { ...(sourceLeadId ? { fromLeadId: sourceLeadId } : {}), ownerUserId: contact.ownerUserId, sourceId: contact.sourceId, crmCompanyId },
  });
  if (crmCompanyId) ctx.emit({ entityType: "COMPANY", entityId: crmCompanyId, eventType: "company.contact_added", summary: contact.fullName, payload: { contactId: contact.id } });
  if (flagged.length) {
    ctx.emit({ entityType: "CONTACT", entityId: contact.id, eventType: "contact.duplicate_flagged", summary: `${flagged.length} possible duplicate(s)`, payload: { contactIds: flagged } });
  }
  return contact;
}

// ── Reads ────────────────────────────────────────────────────────

function presentListRow(row: ContactListRow, tags: { id: string; name: string; color: string | null }[]) {
  const { consents, ...rest } = row;
  return {
    ...rest,
    ownerInactive: row.owner ? row.owner.status !== "ACTIVE" : false,
    restrictedChannels: consents.filter((c) => c.status !== "ALLOWED").map((c) => c.channel),
    tags,
  };
}
export type ContactListItem = ReturnType<typeof presentListRow>;

export async function listContacts(actor: CrmActor, filter: ContactFilter, sort: { sortBy: ContactSortField; sortOrder: "asc" | "desc" }, page: { skip: number; take: number }) {
  const scope = await getCrmRecordScope(actor);
  const tagMatched = filter.tagIds?.length ? (await CrmContactRepository.entityIdsWithAnyTag(actor.companyId, "CONTACT", filter.tagIds)).map((r) => r.entityId) : undefined;
  const where = buildContactWhere(actor.companyId, filter, scope, tagMatched);
  const [rows, totalCount] = await Promise.all([CrmContactRepository.findMany(where, buildContactOrderBy(sort.sortBy, sort.sortOrder), page.skip, page.take), CrmContactRepository.count(where)]);
  const tags = await tagsByEntity(actor.companyId, "CONTACT", rows.map((r) => r.id));
  return { data: rows.map((r) => presentListRow(r, tags.get(r.id) ?? [])), totalCount };
}

function scopedWhere(actor: CrmActor, scope: CrmRecordScope, id: string): Prisma.CrmContactWhereInput {
  return { AND: [{ id, companyId: actor.companyId }, crmOwnerWhere(scope) as Prisma.CrmContactWhereInput] };
}

/** Raw contact the actor may act on (NOT_FOUND outside their visibility). Merged contacts are read-only. */
export async function loadContactForActor(actor: CrmActor, id: string, { allowMerged = false, db }: { allowMerged?: boolean; db?: Prisma.TransactionClient } = {}) {
  const scope = await getCrmRecordScope(actor);
  const contact = await CrmContactRepository.findRaw(scopedWhere(actor, scope, id), db);
  if (!contact) throw new BusinessRuleError("NOT_FOUND", "Contact not found.", { id });
  if (contact.mergedIntoId && !allowMerged) {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This contact was merged into another contact and can't be changed.", { mergedIntoId: contact.mergedIntoId });
  }
  return contact;
}

async function loadEditable(actor: CrmActor, id: string, verb: string) {
  const contact = await loadContactForActor(actor, id);
  if (contact.archivedAt) throw new BusinessRuleError("INVALID_STATE_TRANSITION", `Restore this contact before ${verb}.`);
  return contact;
}

export async function getContact(actor: CrmActor, id: string) {
  const scope = await getCrmRecordScope(actor);
  const contact = await CrmContactRepository.findDetail(scopedWhere(actor, scope, id));
  if (!contact) throw new BusinessRuleError("NOT_FOUND", "Contact not found.", { id });
  const [tags, mergedIds, flagged] = await Promise.all([
    tagsByEntity(actor.companyId, "CONTACT", [id]).then((m) => m.get(id) ?? []),
    CrmContactRepository.mergedIdsInto(actor.companyId, id),
    CrmContactRepository.summaries(actor.companyId, contact.flaggedDuplicateIds),
  ]);
  const userIds = [contact.updatedByUserId, contact.archivedByUserId, contact.mergedByUserId, ...contact.consents.map((c) => c.changedByUserId)].filter((v): v is string => Boolean(v));
  const names = new Map((await CrmContactRepository.userNames([...new Set(userIds)])).map((u) => [u.id, u.fullName]));
  const name = (uid: string | null) => (uid ? (names.get(uid) ?? null) : null);
  return {
    ...contact,
    tags,
    mergedContactIds: mergedIds,
    ownerInactive: contact.owner ? contact.owner.status !== "ACTIVE" : false,
    updatedByName: name(contact.updatedByUserId),
    archivedByName: name(contact.archivedByUserId),
    mergedByName: name(contact.mergedByUserId),
    consents: contact.consents.map((c) => ({ ...c, changedByName: name(c.changedByUserId) })),
    contactability: contactabilitySummary(contact.consents),
    // Suspected duplicates still worth reviewing (already merged ones drop out).
    flaggedDuplicates: flagged
      .filter((f) => !f.mergedIntoId)
      .map(({ id: fid, fullName, email, mobile, phone, crmCompany, archivedAt }) => ({ id: fid, fullName, email, phone: mobile ?? phone, companyName: crmCompany?.name ?? null, archived: Boolean(archivedAt) })),
  };
}
export type ContactDetail = Awaited<ReturnType<typeof getContact>>;

/** Picking an ERP Customer as a contact's company needs read access to customers (masters or sales). */
export async function canLinkCustomers(actor: CrmActor) {
  const [masters, sales] = await Promise.all([PermissionService.can(actor.userId, "masters_core", "view"), PermissionService.can(actor.userId, "sales_orders", "view")]);
  return masters || sales;
}

/** Everything the contact form and filters need in one call. */
export async function getContactFormMeta(actor: CrmActor) {
  const [sources, customFields, suggestions, canPickCustomer] = await Promise.all([
    listLeadSources(actor.companyId),
    listCustomFields(actor.companyId, "CONTACT", { includeInactive: true }),
    optionSuggestions(actor.companyId),
    canLinkCustomers(actor),
  ]);
  return {
    sources: sources.map(({ id, key, name, isActive }) => ({ id, key, name, isActive })),
    customFields,
    suggestions,
    canPickCustomer,
  };
}

// ── Shared write helpers ─────────────────────────────────────────

async function assertAssignableOwner(companyId: string, userId: string) {
  const user = await CrmContactRepository.activeUserInCompany(companyId, userId);
  if (!user) throw new BusinessRuleError("VALIDATION_ERROR", "The selected owner is not an active user in this company.", { fieldErrors: { ownerUserId: "Choose an active user." } });
  return user;
}

async function assertSelectableSource(companyId: string, sourceId: string) {
  const source = await getLeadSourceForCompany(companyId, sourceId);
  if (!source.isActive) throw new BusinessRuleError("VALIDATION_ERROR", `"${source.name}" is no longer in use.`, { fieldErrors: { sourceId: "Choose an active source." } });
  return source;
}

/** Validates and normalises one extra channel value (email lower-cased, links get https://). */
export function normaliseChannel(raw: unknown): NewChannel {
  const ch = contactChannelSchema.parse(raw);
  const kind = CONTACT_CHANNEL_TYPES[ch.channelType as ContactChannelType].kind;
  let value = ch.value.trim();
  if (kind === "email") {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new BusinessRuleError("VALIDATION_ERROR", `"${value}" is not a valid email.`, { fieldErrors: { value: "Enter a valid email" } });
    value = value.toLowerCase();
  } else if (kind === "phone") {
    if (!/^[+\d\s().-]{5,30}$/.test(value)) throw new BusinessRuleError("VALIDATION_ERROR", `"${value}" is not a valid phone number.`, { fieldErrors: { value: "Enter a valid phone number" } });
  } else if (kind === "url") {
    try {
      const u = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
      if (!u.hostname.includes(".")) throw new Error("no host");
      value = u.toString();
    } catch {
      throw new BusinessRuleError("VALIDATION_ERROR", `"${value}" is not a valid link.`, { fieldErrors: { value: "Enter a valid link" } });
    }
  }
  return { channelType: ch.channelType, value, label: textOrNull(ch.label) };
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

/** Recomputes the stored match keys / search text after channels or the company changed (no version bump). */
export async function refreshContactDerived(ctx: CrmMutationContext, contactId: string, companyId: string) {
  const c = await CrmContactRepository.findRaw({ id: contactId }, ctx.tx);
  if (!c) return;
  const [channels, company] = await Promise.all([CrmContactRepository.channels(contactId, ctx.tx), CrmContactRepository.crmCompanyName(companyId, c.crmCompanyId, ctx.tx)]);
  await ctx.tx.crmContact.update({ where: { id: contactId }, data: contactDerivedFields(c, channels, company?.name) });
}

async function emitOwnerChange(ctx: CrmMutationContext, contactId: string, from: string | null, to: string | null) {
  const names = new Map((await CrmContactRepository.userNames([from, to].filter((v): v is string => Boolean(v)))).map((u) => [u.id, u.fullName]));
  const label = (id: string | null) => (id ? (names.get(id) ?? "Unknown user") : "Unassigned");
  ctx.emit({ entityType: "CONTACT", entityId: contactId, eventType: "contact.owner_changed", summary: from ? `${label(from)} → ${label(to)}` : `Assigned to ${label(to)}`, payload: { fromUserId: from, toUserId: to } });
}

async function applyTagsAndEmit(ctx: CrmMutationContext, actor: CrmActor, contactId: string, change: Pick<EntityTagChange, "addTagIds" | "addTagNames" | "removeTagIds">) {
  const { added, removed } = await applyEntityTagChange(actor, "CONTACT", contactId, change, ctx.tx);
  for (const t of added) ctx.emit({ entityType: "CONTACT", entityId: contactId, eventType: "contact.tag_added", summary: t.name, payload: { tagId: t.id } });
  for (const t of removed) ctx.emit({ entityType: "CONTACT", entityId: contactId, eventType: "contact.tag_removed", summary: t.name, payload: { tagId: t.id } });
  if (added.length || removed.length) {
    await ctx.audit({ tableName: "crm_entity_tags", recordId: contactId, action: "UPDATE", newValues: { entityType: "CONTACT", added: added.map((t) => t.name), removed: removed.map((t) => t.name) } });
  }
  return { added, removed };
}

async function versionedUpdate(ctx: CrmMutationContext, contact: CrmContact, expectedVersion: number | undefined, data: Prisma.CrmContactUncheckedUpdateManyInput, actor: CrmActor) {
  const { count } = await CrmContactRepository.updateVersioned(contact.id, expectedVersion ?? contact.version, { ...data, updatedByUserId: actor.userId }, ctx.tx);
  if (count === 0) throw conflict(contact.id);
  return (await CrmContactRepository.findRaw({ id: contact.id }, ctx.tx))!;
}

function comparable(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  return v ?? null;
}

async function customerCompanyLink(actor: CrmActor, customerId: string) {
  if (!(await canLinkCustomers(actor))) throw new BusinessRuleError("PERMISSION_DENIED", "You don't have access to ERP customers.");
  const customer = await CrmContactRepository.customer(actor.companyId, customerId);
  if (!customer) throw new BusinessRuleError("NOT_FOUND", "Customer not found.", { id: customerId });
  if (customer.crmCompany?.archivedAt) throw new BusinessRuleError("INVALID_STATE_TRANSITION", `The CRM company "${customer.crmCompany.name}" for this customer is archived.`);
  return customer.crmCompany?.id ?? null;
}

// ── Create ───────────────────────────────────────────────────────

export async function createContact(actor: CrmActor, raw: unknown) {
  const input: CreateContactInput = createContactSchema.parse(raw);

  // Undefined → the creator owns it (if an active user here); explicit null/"" → unassigned.
  let ownerUserId = input.ownerUserId === undefined ? actor.userId : textOrNull(input.ownerUserId);
  if (ownerUserId && input.ownerUserId === undefined) {
    if (!(await CrmContactRepository.activeUserInCompany(actor.companyId, ownerUserId))) ownerUserId = null;
  } else if (ownerUserId) await assertAssignableOwner(actor.companyId, ownerUserId);

  let sourceId: string | null = null;
  if (input.sourceId) sourceId = (await assertSelectableSource(actor.companyId, input.sourceId)).id;
  else {
    const manual = await getLeadSourceByKey(actor.companyId, "manual");
    sourceId = manual?.isActive ? manual.id : null;
  }

  const customerId = textOrNull(input.customerId);
  let crmCompanyId = textOrNull(input.crmCompanyId);
  if (customerId) crmCompanyId = await customerCompanyLink(actor, customerId);
  else if (crmCompanyId) await getCrmCompanyForActor(actor, crmCompanyId);

  const definitions = await listCustomFields(actor.companyId, "CONTACT", { includeInactive: true });
  const customFields = validateCustomFieldValues(definitions, input.customFields);
  const channels = (input.channels ?? []).map(normaliseChannel);
  const addresses = (input.addresses ?? []).map((a) => contactAddressSchema.parse(a));

  // Duplicate check before the transaction so a warning never half-creates a company.
  const texts = Object.fromEntries(TEXT_FIELDS.map((f) => [f, textOrNull(input[f])])) as Record<TextField, string | null>;
  const derived = contactDerivedFields({ firstName: input.firstName, ...texts }, channels);
  const duplicates = await findContactDuplicates(actor.companyId, contactDuplicateKeys({ ...derived, ...texts, crmCompanyId }));
  assertContactDuplicatesAllowed(duplicates, input.confirmDuplicate);

  return runCrmMutation(actor, async (ctx) => {
    if (customerId && !crmCompanyId) crmCompanyId = (await findOrCreateCrmCompanyForCustomer(ctx, actor, customerId, ownerUserId)).company.id;
    const contact = await createCrmContactInMutation(ctx, actor, { ...input, ...texts, crmCompanyId, sourceId, ownerUserId, customFields }, { allowDuplicate: true, channels, duplicates });
    const primaryIndex = Math.max(0, addresses.findIndex((a) => a.isPrimary));
    for (const [i, a] of addresses.entries()) {
      await CrmContactRepository.createAddress({ companyId: actor.companyId, contactId: contact.id, ...addressData(a), isPrimary: i === primaryIndex, createdByUserId: actor.userId }, ctx.tx);
    }
    if (input.tagIds?.length || input.tagNames?.length) await applyTagsAndEmit(ctx, actor, contact.id, { addTagIds: input.tagIds ?? [], addTagNames: input.tagNames ?? [], removeTagIds: [] });
    return contact;
  });
}

// ── Update ───────────────────────────────────────────────────────

export async function updateContact(actor: CrmActor, id: string, raw: unknown) {
  const input: UpdateContactInput = updateContactSchema.parse(raw);
  const before = await loadEditable(actor, id, "editing it");
  if (input.version !== before.version) throw conflict(id);

  const data: Prisma.CrmContactUncheckedUpdateManyInput = {};
  if (input.firstName !== undefined) data.firstName = input.firstName.trim();
  for (const f of TEXT_FIELDS) {
    if (input[f] !== undefined) {
      const v = textOrNull(input[f]);
      data[f] = f === "email" || f === "alternateEmail" ? (v?.toLowerCase() ?? null) : v;
    }
  }
  const customerId = textOrNull(input.customerId);
  let linkCustomer = false;
  if (customerId) {
    const existingCompanyId = await customerCompanyLink(actor, customerId);
    if (existingCompanyId) data.crmCompanyId = existingCompanyId;
    else linkCustomer = true;
  } else if (input.crmCompanyId !== undefined) {
    data.crmCompanyId = textOrNull(input.crmCompanyId);
    if (data.crmCompanyId && data.crmCompanyId !== before.crmCompanyId) await getCrmCompanyForActor(actor, data.crmCompanyId as string);
  }
  if (input.sourceId !== undefined) {
    data.sourceId = textOrNull(input.sourceId);
    if (data.sourceId && data.sourceId !== before.sourceId) await assertSelectableSource(actor.companyId, data.sourceId as string);
  }
  if (input.customFields !== undefined) {
    const definitions = await listCustomFields(actor.companyId, "CONTACT", { includeInactive: true });
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

  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const f of TRACKED) {
    if (data[f] !== undefined && comparable(data[f]) !== comparable(before[f])) changes[f] = { from: comparable(before[f]), to: comparable(data[f]) };
  }
  if (data.customFields !== undefined && JSON.stringify(data.customFields) !== JSON.stringify(before.customFields)) changes.customFields = { from: before.customFields, to: data.customFields };
  if (!Object.keys(changes).length && newOwner === undefined && !linkCustomer) return before;

  const merged = { ...before, ...data } as CrmContact;
  if (KEY_FIELDS.some((f) => changes[f])) {
    const channels = await CrmContactRepository.channels(id);
    const derived = contactDerivedFields(merged, channels);
    const dup = await findContactDuplicates(actor.companyId, contactDuplicateKeys({ ...derived, ...merged }), id);
    // FLAG rules only apply when a contact is created.
    assertContactDuplicatesAllowed({ ...dup, flaggedIds: [] }, input.confirmDuplicate);
  }
  if (newOwner !== undefined) data.ownerUserId = newOwner;

  return runCrmMutation(actor, async (ctx) => {
    if (linkCustomer) {
      const { company } = await findOrCreateCrmCompanyForCustomer(ctx, actor, customerId as string, merged.ownerUserId);
      if (company.id !== before.crmCompanyId) {
        data.crmCompanyId = company.id;
        changes.crmCompanyId = { from: before.crmCompanyId, to: company.id };
      }
    }
    await versionedUpdate(ctx, before, input.version, data, actor);
    await refreshContactDerived(ctx, id, actor.companyId);
    const after = (await CrmContactRepository.findRaw({ id }, ctx.tx))!;
    await ctx.audit({ tableName: TABLE, recordId: id, action: "UPDATE", oldValues: before, newValues: after });
    if (Object.keys(changes).length) ctx.emit({ entityType: "CONTACT", entityId: id, eventType: "contact.updated", summary: `Updated ${Object.keys(changes).length} field(s)`, payload: { changes } });
    if (changes.crmCompanyId) {
      // Company timeline: the person joined / left. A leaving primary contact stops being primary.
      if (before.crmCompanyId) {
        await ctx.tx.crmCompany.updateMany({ where: { id: before.crmCompanyId, primaryContactId: id }, data: { primaryContactId: null } });
        ctx.emit({ entityType: "COMPANY", entityId: before.crmCompanyId, eventType: "company.contact_removed", summary: after.fullName, payload: { contactId: id } });
      }
      if (after.crmCompanyId) ctx.emit({ entityType: "COMPANY", entityId: after.crmCompanyId, eventType: "company.contact_added", summary: after.fullName, payload: { contactId: id } });
    }
    if (newOwner !== undefined) await emitOwnerChange(ctx, id, before.ownerUserId, newOwner);
    return after;
  });
}

// ── Focused actions ──────────────────────────────────────────────

export async function assignContact(actor: CrmActor, id: string, raw: unknown) {
  const { ownerUserId, version } = assignContactSchema.parse(raw);
  const before = await loadEditable(actor, id, "reassigning it");
  if (ownerUserId === before.ownerUserId) return before;
  if (ownerUserId) await assertAssignableOwner(actor.companyId, ownerUserId);
  return runCrmMutation(actor, async (ctx) => {
    const after = await versionedUpdate(ctx, before, version, { ownerUserId }, actor);
    await ctx.audit({ tableName: TABLE, recordId: id, action: "UPDATE", oldValues: { ownerUserId: before.ownerUserId }, newValues: { ownerUserId } });
    await emitOwnerChange(ctx, id, before.ownerUserId, ownerUserId);
    return after;
  });
}

export async function changeContactTags(actor: CrmActor, id: string, change: EntityTagChange) {
  await loadEditable(actor, id, "changing its tags");
  await runCrmMutation(actor, (ctx) => applyTagsAndEmit(ctx, actor, id, change));
  return (await tagsByEntity(actor.companyId, "CONTACT", [id])).get(id) ?? [];
}

export async function archiveContact(actor: CrmActor, id: string) {
  const before = await loadContactForActor(actor, id);
  if (before.archivedAt) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This contact is already archived.");
  return runCrmMutation(actor, async (ctx) => {
    const after = await versionedUpdate(ctx, before, undefined, { archivedAt: new Date(), archivedByUserId: actor.userId }, actor);
    await ctx.audit({ tableName: TABLE, recordId: id, action: "UPDATE", oldValues: { archivedAt: null }, newValues: { archivedAt: after.archivedAt } });
    ctx.emit({ entityType: "CONTACT", entityId: id, eventType: "contact.archived", summary: before.fullName });
    return after;
  });
}

export async function restoreContact(actor: CrmActor, id: string) {
  const before = await loadContactForActor(actor, id);
  if (!before.archivedAt) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This contact is not archived.");
  return runCrmMutation(actor, async (ctx) => {
    const after = await versionedUpdate(ctx, before, undefined, { archivedAt: null, archivedByUserId: null }, actor);
    await ctx.audit({ tableName: TABLE, recordId: id, action: "UPDATE", oldValues: { archivedAt: before.archivedAt }, newValues: { archivedAt: null } });
    ctx.emit({ entityType: "CONTACT", entityId: id, eventType: "contact.restored", summary: before.fullName });
    return after;
  });
}

export async function checkContactDuplicates(actor: CrmActor, raw: unknown) {
  const input = contactDuplicateCheckSchema.parse(raw);
  const texts = Object.fromEntries(TEXT_FIELDS.map((f) => [f, textOrNull((input as Record<string, string | null | undefined>)[f])])) as Record<TextField, string | null>;
  const derived = contactDerivedFields({ firstName: input.firstName ?? "", ...texts });
  return findContactDuplicates(actor.companyId, contactDuplicateKeys({ ...derived, ...texts, crmCompanyId: textOrNull(input.crmCompanyId) }), textOrNull(input.excludeContactId) ?? undefined);
}

/** "These are different people" — clears a FLAG left by a duplicate rule. */
export async function dismissDuplicateFlag(actor: CrmActor, id: string) {
  const before = await loadContactForActor(actor, id);
  if (!before.duplicateFlaggedAt) return before;
  return runCrmMutation(actor, async (ctx) => {
    const after = await versionedUpdate(ctx, before, undefined, { duplicateFlaggedAt: null, flaggedDuplicateIds: [] }, actor);
    await ctx.audit({ tableName: TABLE, recordId: id, action: "UPDATE", oldValues: { flaggedDuplicateIds: before.flaggedDuplicateIds }, newValues: { flaggedDuplicateIds: [] } });
    ctx.emit({ entityType: "CONTACT", entityId: id, eventType: "contact.duplicate_dismissed", summary: "Marked as not a duplicate", payload: { contactIds: before.flaggedDuplicateIds } });
    return after;
  });
}

// ── Channels ─────────────────────────────────────────────────────

export async function addContactChannel(actor: CrmActor, id: string, raw: unknown) {
  await loadEditable(actor, id, "changing it");
  const ch = normaliseChannel(raw);
  const valueKey = channelValueKey(ch.channelType, ch.value);
  const existing = await CrmContactRepository.channels(id);
  if (existing.some((e) => e.channelType === ch.channelType && e.valueKey === valueKey)) throw new BusinessRuleError("VALIDATION_ERROR", "This contact already has that value.");
  return runCrmMutation(actor, async (ctx) => {
    await CrmContactRepository.lockForUpdate([id], ctx.tx);
    const row = await ctx.tx.crmContactChannel.create({ data: { companyId: actor.companyId, contactId: id, channelType: ch.channelType, value: ch.value, valueKey, label: ch.label ?? null, createdByUserId: actor.userId } });
    await refreshContactDerived(ctx, id, actor.companyId);
    await ctx.audit({ tableName: "crm_contact_channels", recordId: row.id, action: "CREATE", newValues: row });
    ctx.emit({ entityType: "CONTACT", entityId: id, eventType: "contact.channel_added", summary: `${CONTACT_CHANNEL_TYPES[ch.channelType as ContactChannelType].label}: ${ch.value}`, payload: { channelId: row.id, channelType: ch.channelType } });
    return row;
  });
}

export async function removeContactChannel(actor: CrmActor, id: string, channelId: string) {
  await loadEditable(actor, id, "changing it");
  const row = await CrmContactRepository.findChannel(actor.companyId, id, channelId);
  if (!row) throw new BusinessRuleError("NOT_FOUND", "Contact detail not found.", { id: channelId });
  await runCrmMutation(actor, async (ctx) => {
    await CrmContactRepository.deleteChannel(channelId, ctx.tx);
    await refreshContactDerived(ctx, id, actor.companyId);
    await ctx.audit({ tableName: "crm_contact_channels", recordId: channelId, action: "DELETE", oldValues: row });
    ctx.emit({ entityType: "CONTACT", entityId: id, eventType: "contact.channel_removed", summary: `${CONTACT_CHANNEL_TYPES[row.channelType as ContactChannelType]?.label ?? row.channelType}: ${row.value}`, payload: { channelType: row.channelType } });
  });
}

// ── Addresses ────────────────────────────────────────────────────

export async function addContactAddress(actor: CrmActor, id: string, raw: unknown) {
  await loadEditable(actor, id, "changing it");
  const input = contactAddressSchema.parse(raw);
  return runCrmMutation(actor, async (ctx) => {
    await CrmContactRepository.lockForUpdate([id], ctx.tx);
    const existing = await CrmContactRepository.addresses(id, ctx.tx);
    const isPrimary = Boolean(input.isPrimary) || existing.length === 0;
    if (isPrimary) await CrmContactRepository.clearPrimaryAddress(id, ctx.tx);
    const row = await CrmContactRepository.createAddress({ companyId: actor.companyId, contactId: id, ...addressData(input), isPrimary, createdByUserId: actor.userId }, ctx.tx);
    await ctx.audit({ tableName: "crm_addresses", recordId: row.id, action: "CREATE", newValues: row });
    ctx.emit({ entityType: "CONTACT", entityId: id, eventType: "contact.address_added", summary: addressSummary(row), payload: { addressId: row.id, addressType: row.addressType } });
    return row;
  });
}

export async function updateContactAddress(actor: CrmActor, id: string, addressId: string, raw: unknown) {
  await loadEditable(actor, id, "changing it");
  const input = updateContactAddressSchema.parse(raw);
  const before = await CrmContactRepository.findAddress(actor.companyId, id, addressId);
  if (!before) throw new BusinessRuleError("NOT_FOUND", "Address not found.", { id: addressId });
  const next = contactAddressSchema.parse({ ...before, ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) });
  return runCrmMutation(actor, async (ctx) => {
    await CrmContactRepository.lockForUpdate([id], ctx.tx);
    if (input.isPrimary) await CrmContactRepository.clearPrimaryAddress(id, ctx.tx, addressId);
    const row = await CrmContactRepository.updateAddress(addressId, { ...addressData(next), ...(input.isPrimary ? { isPrimary: true } : {}) }, ctx.tx);
    await ctx.audit({ tableName: "crm_addresses", recordId: addressId, action: "UPDATE", oldValues: before, newValues: row });
    ctx.emit({ entityType: "CONTACT", entityId: id, eventType: "contact.address_updated", summary: addressSummary(row), payload: { addressId } });
    return row;
  });
}

export async function deleteContactAddress(actor: CrmActor, id: string, addressId: string) {
  await loadEditable(actor, id, "changing it");
  const before = await CrmContactRepository.findAddress(actor.companyId, id, addressId);
  if (!before) throw new BusinessRuleError("NOT_FOUND", "Address not found.", { id: addressId });
  await runCrmMutation(actor, async (ctx) => {
    await CrmContactRepository.lockForUpdate([id], ctx.tx);
    await CrmContactRepository.deleteAddress(addressId, ctx.tx);
    if (before.isPrimary) {
      const [next] = await CrmContactRepository.addresses(id, ctx.tx);
      if (next) await CrmContactRepository.updateAddress(next.id, { isPrimary: true }, ctx.tx);
    }
    await ctx.audit({ tableName: "crm_addresses", recordId: addressId, action: "DELETE", oldValues: before });
    ctx.emit({ entityType: "CONTACT", entityId: id, eventType: "contact.address_removed", summary: addressSummary(before), payload: { addressId } });
  });
}

// ── Contactability ───────────────────────────────────────────────

const statusWords = (s: string) => s.replace(/_/g, " ").toLowerCase();

/**
 * Records a contactability decision for one channel (or "ALL"). Allowed on
 * archived contacts too — a Do Not Contact request must always be recordable.
 */
export async function setContactability(actor: CrmActor, id: string, raw: unknown) {
  const input = contactabilityChangeSchema.parse(raw);
  await loadContactForActor(actor, id);
  const reason = textOrNull(input.reason);
  if (input.status !== "ALLOWED" && !reason) throw new BusinessRuleError("VALIDATION_ERROR", "Give a reason so others know why this contact must not be contacted.", { fieldErrors: { reason: "Reason is required." } });
  const current = (await CrmContactRepository.consents(id)).find((c) => c.channel === input.channel) ?? null;
  if (current && current.status === input.status && (current.reason ?? null) === reason) return current;
  if (!current && input.status === "ALLOWED") return null;
  return runCrmMutation(actor, async (ctx) => {
    const row = await CrmContactRepository.upsertConsent(actor.companyId, id, input.channel, { status: input.status, reason, source: input.source, changedAt: new Date(), changedByUserId: actor.userId }, ctx.tx);
    await ctx.audit({ tableName: "crm_contact_consents", recordId: row.id, action: current ? "UPDATE" : "CREATE", oldValues: current, newValues: row });
    ctx.emit({
      entityType: "CONTACT",
      entityId: id,
      eventType: "contact.contactability_changed",
      summary: `${input.channel === "ALL" ? "All channels" : input.channel}: ${statusWords(current?.status ?? "ALLOWED")} → ${statusWords(input.status)}`,
      payload: { channel: input.channel, from: current?.status ?? "ALLOWED", to: input.status, reason, source: input.source },
    });
    return row;
  });
}

/** Server-side check for later phases (campaigns, sequences, inbox): may we contact this person on this channel? Follows merges. */
export async function canContactContact(actor: CrmActor, id: string, channel: "EMAIL" | "PHONE" | "SMS" | "WHATSAPP") {
  const contact = await loadContactForActor(actor, id, { allowMerged: true });
  return canContact(await CrmContactRepository.consents(contact.mergedIntoId ?? id), channel);
}

// ── Bulk ─────────────────────────────────────────────────────────

/**
 * Synchronous bulk actions for up to BULK_CONTACT_LIMIT selected contacts in
 * one transaction, one timeline event per changed contact. Hidden, merged,
 * archived or unchanged contacts are reported as skipped, never dropped.
 */
export async function bulkContactAction(actor: CrmActor, raw: unknown) {
  const input = bulkContactSchema.parse(raw);
  const scope = await getCrmRecordScope(actor);
  const ids = [...new Set(input.ids)];
  const contacts = await CrmContactRepository.findManyRaw({ AND: [{ id: { in: ids }, companyId: actor.companyId, mergedIntoId: null }, crmOwnerWhere(scope) as Prisma.CrmContactWhereInput] });
  const found = new Map(contacts.map((c) => [c.id, c]));
  const skipped: { id: string; reason: string }[] = ids.filter((i) => !found.has(i)).map((i) => ({ id: i, reason: "Not found or not visible to you" }));
  let targets = contacts.filter((c) => (c.archivedAt ? (skipped.push({ id: c.id, reason: "Archived" }), false) : true));
  if (input.action === "assign") {
    if (input.ownerUserId) await assertAssignableOwner(actor.companyId, input.ownerUserId);
    targets = targets.filter((c) => (c.ownerUserId === input.ownerUserId ? (skipped.push({ id: c.id, reason: "Already assigned to this owner" }), false) : true));
  }
  let updated = 0;
  await runCrmMutation(actor, async (ctx) => {
    for (const c of targets) {
      if (input.action === "assign") {
        await CrmContactRepository.updateRaw(c.id, { ownerUserId: input.ownerUserId, updatedByUserId: actor.userId }, ctx.tx);
        await ctx.audit({ tableName: TABLE, recordId: c.id, action: "UPDATE", oldValues: { ownerUserId: c.ownerUserId }, newValues: { ownerUserId: input.ownerUserId, bulk: true } });
        await emitOwnerChange(ctx, c.id, c.ownerUserId, input.ownerUserId);
        updated++;
      } else if (input.action === "archive") {
        await CrmContactRepository.updateRaw(c.id, { archivedAt: new Date(), archivedByUserId: actor.userId, updatedByUserId: actor.userId }, ctx.tx);
        await ctx.audit({ tableName: TABLE, recordId: c.id, action: "UPDATE", oldValues: { archivedAt: null }, newValues: { archived: true, bulk: true } });
        ctx.emit({ entityType: "CONTACT", entityId: c.id, eventType: "contact.archived", summary: c.fullName, payload: { bulk: true } });
        updated++;
      } else {
        const change = input.action === "addTags" ? { addTagIds: input.tagIds, addTagNames: input.tagNames, removeTagIds: [] } : { addTagIds: [], addTagNames: [], removeTagIds: input.tagIds };
        const { added, removed } = await applyTagsAndEmit(ctx, actor, c.id, change);
        if (added.length || removed.length) updated++;
        else skipped.push({ id: c.id, reason: input.action === "addTags" ? "Already has these tags" : "Doesn't have these tags" });
      }
    }
  });
  return { requested: ids.length, updated, skipped };
}
