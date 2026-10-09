import { CrmActivityRepository } from "../activities/crm-activity.repository";
import type { CrmContact, Prisma } from "@prisma/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import type { CrmActor } from "../core/crm-actor";
import { runCrmMutation } from "../core/crm-mutation";
import { listCustomFields } from "../custom-fields/crm-custom-fields.service";
import { channelValueKey } from "./contact-keys";
import { ContactMergeRepository } from "./contact-merge.repository";
import { MERGE_FIELDS, mergeContactsSchema, type MergeField } from "./contact.schema";
import { mergeConsents, type ConsentRow } from "./contactability";
import { CrmContactRepository } from "./crm-contact.repository";
import { getContact, loadContactForActor, refreshContactDerived } from "./crm-contacts.service";

/**
 * Contact merge (survivor ← merged). Rules:
 *  - Both contacts must be visible to the user, in the same company, not
 *    already merged, and different. The survivor must not be archived.
 *  - Each scalar field takes the value the user chose; unchosen fields keep
 *    the survivor's value, or the merged one's when the survivor's is empty.
 *  - No contact detail is lost: emails/phones that don't win a core field
 *    are kept on the survivor as extra channels; channels, addresses, notes,
 *    tags, documents, leads and opportunities move to the survivor.
 *  - Contactability: per channel the stricter status wins (never re-allow).
 *  - The merged contact is archived and points at the survivor
 *    (mergedIntoId) — never deleted. A crm_contact_merges row keeps a
 *    snapshot of it. Everything runs in one transaction with both rows
 *    locked, so a concurrent edit or a second merge cannot interleave.
 */

const blank = (v: unknown) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");

export type MergeChoice = "survivor" | "merged";

/** Pure: which contact each field's value comes from. */
export function resolveFieldChoices(survivor: Pick<CrmContact, MergeField>, merged: Pick<CrmContact, MergeField>, choices: Partial<Record<MergeField, MergeChoice>>) {
  const out = {} as Record<MergeField, MergeChoice>;
  for (const f of MERGE_FIELDS) out[f] = choices[f] ?? (blank(survivor[f]) && !blank(merged[f]) ? "merged" : "survivor");
  return out;
}

/** Pure: custom-field values after merge (same default rule as fields). */
export function mergeCustomFieldValues(survivor: Record<string, unknown>, merged: Record<string, unknown>, choices: Record<string, MergeChoice>) {
  const out: Record<string, unknown> = { ...survivor };
  for (const [key, value] of Object.entries(merged)) {
    const choice = choices[key] ?? (blank(survivor[key]) ? "merged" : "survivor");
    if (choice === "merged" && !blank(value)) out[key] = value;
  }
  return out;
}

const EMAIL_FIELDS = ["email", "alternateEmail"] as const;
const PHONE_FIELDS = { phone: "PHONE", mobile: "MOBILE", whatsapp: "WHATSAPP" } as const;

/** Pure: contact values that would otherwise disappear, as channels to keep on the survivor. */
export function leftoverChannels(survivor: CrmContact, merged: CrmContact, final: Record<MergeField, unknown>) {
  const out: { channelType: string; value: string }[] = [];
  const finalEmails = new Set(EMAIL_FIELDS.map((f) => String(final[f] ?? "").toLowerCase()).filter(Boolean));
  for (const c of [survivor, merged]) {
    for (const f of EMAIL_FIELDS) {
      const v = c[f];
      if (v && !finalEmails.has(v.toLowerCase())) out.push({ channelType: "EMAIL", value: v.toLowerCase() });
    }
  }
  const finalPhones = new Set(Object.keys(PHONE_FIELDS).map((f) => channelValueKey("PHONE", String(final[f as MergeField] ?? ""))).filter(Boolean));
  for (const c of [survivor, merged]) {
    for (const [f, type] of Object.entries(PHONE_FIELDS)) {
      const v = c[f as keyof typeof PHONE_FIELDS];
      if (v && !finalPhones.has(channelValueKey("PHONE", v))) out.push({ channelType: type, value: v });
    }
  }
  const seen = new Set<string>();
  return out.filter((ch) => {
    const k = `${ch.channelType}:${channelValueKey(ch.channelType, ch.value)}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

async function loadPair(actor: CrmActor, survivorId: string, mergedId: string) {
  if (survivorId === mergedId) throw new BusinessRuleError("VALIDATION_ERROR", "A contact can't be merged with itself.");
  const [survivor, merged] = await Promise.all([loadContactForActor(actor, survivorId, { allowMerged: true }), loadContactForActor(actor, mergedId, { allowMerged: true })]);
  if (survivor.mergedIntoId) throw new BusinessRuleError("INVALID_STATE_TRANSITION", `"${survivor.fullName}" was already merged into another contact. Merge into that contact instead.`, { mergedIntoId: survivor.mergedIntoId });
  if (merged.mergedIntoId) throw new BusinessRuleError("INVALID_STATE_TRANSITION", `"${merged.fullName}" has already been merged.`, { mergedIntoId: merged.mergedIntoId });
  if (survivor.archivedAt) throw new BusinessRuleError("INVALID_STATE_TRANSITION", `Restore "${survivor.fullName}" before merging into it, or keep the other contact instead.`);
  return { survivor, merged };
}

/** Side-by-side data for the merge screen. */
export async function getMergePreview(actor: CrmActor, survivorId: string, mergedId: string) {
  await loadPair(actor, survivorId, mergedId);
  const [a, b, aCounts, bCounts, customFields] = await Promise.all([
    getContact(actor, survivorId),
    getContact(actor, mergedId),
    ContactMergeRepository.relatedCounts(actor.companyId, survivorId),
    ContactMergeRepository.relatedCounts(actor.companyId, mergedId),
    listCustomFields(actor.companyId, "CONTACT", { includeInactive: true }),
  ]);
  return { survivor: { ...a, counts: aCounts }, merged: { ...b, counts: bCounts }, fields: MERGE_FIELDS, customFields };
}

export async function mergeContacts(actor: CrmActor, raw: unknown) {
  const input = mergeContactsSchema.parse(raw);
  const pre = await loadPair(actor, input.survivorId, input.mergedId);
  if (pre.survivor.version !== input.survivorVersion || pre.merged.version !== input.mergedVersion) {
    throw new BusinessRuleError("RECORD_VERSION_CONFLICT", "One of these contacts was changed after you opened the merge screen. Reload and review the values again.");
  }

  const result = await runCrmMutation(actor, async (ctx) => {
    const { tx } = ctx;
    await CrmContactRepository.lockForUpdate([input.survivorId, input.mergedId], tx);
    const survivor = await CrmContactRepository.findRaw({ id: input.survivorId, companyId: actor.companyId }, tx);
    const merged = await CrmContactRepository.findRaw({ id: input.mergedId, companyId: actor.companyId }, tx);
    if (!survivor || !merged) throw new BusinessRuleError("NOT_FOUND", "Contact not found.");
    // Re-checked under the lock: a parallel merge or edit may have won the race.
    if (survivor.mergedIntoId || merged.mergedIntoId || (await ContactMergeRepository.findMergeRecord(merged.id, tx))) {
      throw new BusinessRuleError("INVALID_STATE_TRANSITION", "One of these contacts has already been merged.");
    }
    if (survivor.version !== input.survivorVersion || merged.version !== input.mergedVersion) {
      throw new BusinessRuleError("RECORD_VERSION_CONFLICT", "One of these contacts was changed after you opened the merge screen. Reload and review the values again.");
    }

    const [mergedChannels, survivorAddresses, mergedAddresses, survivorConsents, mergedConsents, mergedTags] = await Promise.all([
      CrmContactRepository.channels(merged.id, tx),
      CrmContactRepository.addresses(survivor.id, tx),
      CrmContactRepository.addresses(merged.id, tx),
      CrmContactRepository.consents(survivor.id, tx),
      CrmContactRepository.consents(merged.id, tx),
      ContactMergeRepository.tagNames(actor.companyId, merged.id, tx),
    ]);

    // 1. Field values
    const choices = resolveFieldChoices(survivor, merged, input.fieldChoices);
    const final = Object.fromEntries(MERGE_FIELDS.map((f) => [f, choices[f] === "merged" ? merged[f] : survivor[f]])) as Record<MergeField, unknown>;
    if (blank(final.firstName)) final.firstName = survivor.firstName;
    const customFields = mergeCustomFieldValues((survivor.customFields as Record<string, unknown>) ?? {}, (merged.customFields as Record<string, unknown>) ?? {}, input.customFieldChoices);

    // 2. Keep every contact detail: merged channels + values that lost their core field
    const keep = [...mergedChannels.map((c) => ({ channelType: c.channelType, value: c.value, label: c.label })), ...leftoverChannels(survivor, merged, final).map((c) => ({ ...c, label: `From merge (${merged.fullName})` }))];
    if (keep.length) {
      await CrmContactRepository.createChannels(
        keep.map((c) => ({ companyId: actor.companyId, contactId: survivor.id, channelType: c.channelType, value: c.value, valueKey: channelValueKey(c.channelType, c.value), label: c.label ?? null, createdByUserId: actor.userId })),
        tx
      );
    }
    await ContactMergeRepository.deleteChannels(merged.id, tx);

    // 3. Move related records
    const moved = {
      leads: (await ContactMergeRepository.moveLeads(actor.companyId, merged.id, survivor.id, tx)).count,
      opportunities: (await ContactMergeRepository.moveOpportunities(actor.companyId, merged.id, survivor.id, tx)).count,
      notes: (await ContactMergeRepository.moveNotes(actor.companyId, merged.id, survivor.id, tx)).count,
      activities: await CrmActivityRepository.moveToSurvivor(actor.companyId, "CONTACT", merged.id, survivor.id, tx),
      documents: (await ContactMergeRepository.moveDocuments(actor.companyId, merged.id, survivor.id, tx)).count,
      tags: await ContactMergeRepository.moveTags(actor.companyId, merged.id, survivor.id, actor.userId, tx),
      addresses: (await ContactMergeRepository.moveAddresses(merged.id, survivor.id, survivorAddresses.some((a) => a.isPrimary), tx)).count,
      channels: keep.length,
      earlierMerges: (await ContactMergeRepository.repointEarlierMerges(merged.id, survivor.id, tx)).count,
      // Companies whose primary contact was the merged person now point at the survivor.
      primaryOf: (await ContactMergeRepository.repointPrimaryContact(merged.id, survivor.id, tx)).count,
    };

    // 4. Contactability: stricter wins
    const consentChanges = mergeConsents(survivorConsents as ConsentRow[], mergedConsents as ConsentRow[]);
    for (const { channel } of consentChanges) {
      const m = mergedConsents.find((c) => c.channel === channel)!;
      await CrmContactRepository.upsertConsent(actor.companyId, survivor.id, channel, { status: m.status, reason: m.reason ? `${m.reason} (from merged contact ${merged.fullName})` : `From merged contact ${merged.fullName}`, source: "MERGE", changedAt: new Date(), changedByUserId: actor.userId }, tx);
    }

    // 5. Survivor
    const remainingFlags = survivor.flaggedDuplicateIds.filter((x) => x !== merged.id);
    const survivorData: Prisma.CrmContactUncheckedUpdateManyInput = {
      ...(final as Prisma.CrmContactUncheckedUpdateManyInput),
      customFields: customFields as Prisma.InputJsonValue,
      sourceLeadId: survivor.sourceLeadId ?? merged.sourceLeadId,
      flaggedDuplicateIds: remainingFlags,
      duplicateFlaggedAt: remainingFlags.length ? survivor.duplicateFlaggedAt : null,
      updatedByUserId: actor.userId,
    };
    const { count } = await CrmContactRepository.updateVersioned(survivor.id, survivor.version, survivorData, tx);
    if (count === 0) throw new BusinessRuleError("RECORD_VERSION_CONFLICT", "The contact you are keeping was changed while merging. Reload and try again.");
    await refreshContactDerived(ctx, survivor.id, actor.companyId);
    const survivorAfter = (await CrmContactRepository.findRaw({ id: survivor.id }, tx))!;

    // 6. Merged contact: archived + pointer, never deleted
    const now = new Date();
    await CrmContactRepository.updateRaw(
      merged.id,
      { mergedIntoId: survivor.id, mergedAt: now, mergedByUserId: actor.userId, archivedAt: merged.archivedAt ?? now, archivedByUserId: merged.archivedByUserId ?? actor.userId, duplicateFlaggedAt: null, flaggedDuplicateIds: [], updatedByUserId: actor.userId },
      tx
    );

    const record = await ContactMergeRepository.createMergeRecord(
      {
        companyId: actor.companyId,
        survivorId: survivor.id,
        mergedId: merged.id,
        fieldChoices: { fields: choices, customFields: input.customFieldChoices } as Prisma.InputJsonValue,
        mergedSnapshot: JSON.parse(JSON.stringify({ contact: merged, channels: mergedChannels, addresses: mergedAddresses, consents: mergedConsents, tags: mergedTags.map((t) => t.tag.name) })) as Prisma.InputJsonValue,
        moved: moved as Prisma.InputJsonValue,
        mergedByUserId: actor.userId,
      },
      tx
    );

    await ctx.audit({ tableName: "crm_contacts", recordId: survivor.id, action: "UPDATE", oldValues: survivor, newValues: { ...survivorAfter, mergedFrom: merged.id } });
    await ctx.audit({ tableName: "crm_contacts", recordId: merged.id, action: "UPDATE", oldValues: { mergedIntoId: null, archivedAt: merged.archivedAt }, newValues: { mergedIntoId: survivor.id, mergedAt: now } });
    await ctx.audit({ tableName: "crm_contact_merges", recordId: record.id, action: "CREATE", newValues: { survivorId: survivor.id, mergedId: merged.id, fieldChoices: choices, moved } });
    ctx.emit({ entityType: "CONTACT", entityId: survivor.id, eventType: "contact.merged", summary: `Merged ${merged.fullName} into this contact`, payload: { mergedId: merged.id, mergeId: record.id, moved, consentChannels: consentChanges.map((c) => c.channel) } });
    ctx.emit({ entityType: "CONTACT", entityId: merged.id, eventType: "contact.merged_into", summary: `Merged into ${survivorAfter.fullName}`, payload: { survivorId: survivor.id, mergeId: record.id } });
    return { survivor: survivorAfter, mergeId: record.id, moved };
  });
  return result;
}
