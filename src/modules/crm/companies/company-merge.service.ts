import { CrmActivityRepository } from "../activities/crm-activity.repository";
import type { CrmCompany, Prisma } from "@prisma/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import type { CrmActor } from "../core/crm-actor";
import { runCrmMutation } from "../core/crm-mutation";
import { listCustomFields } from "../custom-fields/crm-custom-fields.service";
import { refreshContactDerived } from "../contacts/crm-contacts.service";
import { COMPANY_MERGE_FIELDS, mergeCompaniesSchema, type CompanyMergeField } from "./company.schema";
import { getCompany, loadCompanyForActor, refreshCompanyDerived } from "./crm-companies.service";
import { CrmCompanyRepository } from "./crm-company.repository";

/**
 * Company merge (survivor ← merged), deterministic and loss-free:
 *  - Every field where both companies hold different non-empty values must
 *    be chosen explicitly (VALIDATION_ERROR lists them otherwise). Empty
 *    fields are filled from the other company. Values that are not kept are
 *    written into a note on the survivor and the merge snapshot.
 *  - Contacts, leads, opportunities, notes, tags, addresses, documents and
 *    earlier merges move to the survivor; the timeline shows both histories.
 *  - ERP safety: the CRM never merges, edits or deletes ERP customers. Two
 *    companies linked to DIFFERENT ERP customers can't be merged here (that
 *    needs an ERP-level decision first). If only the merged company is
 *    linked, the link moves to the survivor.
 *  - The merged company is archived and points at the survivor; it is never
 *    deleted. One transaction, both rows locked, versions re-checked.
 */

const REFERENCE_FIELDS = new Set<CompanyMergeField>(["statusId", "sourceId", "ownerUserId", "primaryContactId"]);
const blank = (v: unknown) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");
const norm = (v: unknown) => (typeof v === "string" ? v.trim().toLowerCase() : v);

export type MergeChoice = "survivor" | "merged";

/** Pure: fields where both companies hold different non-empty values. */
export function conflictingFields(survivor: Pick<CrmCompany, CompanyMergeField>, merged: Pick<CrmCompany, CompanyMergeField>): CompanyMergeField[] {
  return COMPANY_MERGE_FIELDS.filter((f) => !blank(survivor[f]) && !blank(merged[f]) && norm(survivor[f]) !== norm(merged[f]));
}

export function conflictingCustomFields(survivor: Record<string, unknown>, merged: Record<string, unknown>) {
  return Object.keys(merged).filter((k) => !blank(survivor[k]) && !blank(merged[k]) && JSON.stringify(survivor[k]) !== JSON.stringify(merged[k]));
}

/** Pure: which company each field comes from. Conflicts must be chosen; empty fields are filled from the other side. */
export function resolveCompanyChoices(survivor: Pick<CrmCompany, CompanyMergeField>, merged: Pick<CrmCompany, CompanyMergeField>, choices: Partial<Record<CompanyMergeField, MergeChoice>>) {
  const missing = conflictingFields(survivor, merged).filter((f) => !choices[f]);
  const resolved = {} as Record<CompanyMergeField, MergeChoice>;
  for (const f of COMPANY_MERGE_FIELDS) resolved[f] = choices[f] ?? (blank(survivor[f]) && !blank(merged[f]) ? "merged" : "survivor");
  return { resolved, missing };
}

const FIELD_LABELS: Record<CompanyMergeField, string> = {
  name: "Name",
  legalName: "Legal name",
  displayName: "Display name",
  companyType: "Company type",
  industry: "Industry",
  website: "Website",
  email: "Email",
  phone: "Phone",
  mobile: "Mobile",
  city: "City",
  state: "State",
  postalCode: "Postal code",
  country: "Country",
  statusId: "Status",
  sourceId: "Source",
  ownerUserId: "Owner",
  primaryContactId: "Primary contact",
};

async function loadPair(actor: CrmActor, survivorId: string, mergedId: string) {
  if (survivorId === mergedId) throw new BusinessRuleError("VALIDATION_ERROR", "A company can't be merged with itself.");
  const [survivor, merged] = await Promise.all([loadCompanyForActor(actor, survivorId, { allowMerged: true }), loadCompanyForActor(actor, mergedId, { allowMerged: true })]);
  if (survivor.mergedIntoId) throw new BusinessRuleError("INVALID_STATE_TRANSITION", `"${survivor.name}" was already merged into another company. Merge into that company instead.`, { mergedIntoId: survivor.mergedIntoId });
  if (merged.mergedIntoId) throw new BusinessRuleError("INVALID_STATE_TRANSITION", `"${merged.name}" has already been merged.`, { mergedIntoId: merged.mergedIntoId });
  if (survivor.archivedAt) throw new BusinessRuleError("INVALID_STATE_TRANSITION", `Restore "${survivor.name}" before merging into it, or keep the other company instead.`);
  return { survivor, merged };
}

function assertErpSafe(survivor: CrmCompany, merged: CrmCompany) {
  if (survivor.customerId && merged.customerId && survivor.customerId !== merged.customerId) {
    throw new BusinessRuleError(
      "INVALID_STATE_TRANSITION",
      "Both companies are linked to different ERP customers. The CRM can't merge ERP customers — resolve the duplicate customer in the ERP first (or unlink one of them), then merge here.",
      { erpConflict: true, survivorCustomerId: survivor.customerId, mergedCustomerId: merged.customerId }
    );
  }
}

/** Side-by-side data for the merge screen, including the conflicts that need a choice and any ERP conflict. */
export async function getCompanyMergePreview(actor: CrmActor, survivorId: string, mergedId: string) {
  const { survivor, merged } = await loadPair(actor, survivorId, mergedId);
  const [a, b, aCounts, bCounts, customFields] = await Promise.all([
    getCompany(actor, survivorId),
    getCompany(actor, mergedId),
    CrmCompanyRepository.mergeCounts(actor.companyId, survivorId),
    CrmCompanyRepository.mergeCounts(actor.companyId, mergedId),
    listCustomFields(actor.companyId, "COMPANY", { includeInactive: true }),
  ]);
  const erpConflict = Boolean(survivor.customerId && merged.customerId && survivor.customerId !== merged.customerId);
  return {
    survivor: { ...a, counts: aCounts },
    merged: { ...b, counts: bCounts },
    fields: COMPANY_MERGE_FIELDS,
    conflicts: conflictingFields(survivor, merged),
    customFieldConflicts: conflictingCustomFields((survivor.customFields as Record<string, unknown>) ?? {}, (merged.customFields as Record<string, unknown>) ?? {}),
    customFields,
    erpConflict,
    erpLinkMoves: Boolean(!survivor.customerId && merged.customerId),
  };
}

export async function mergeCompanies(actor: CrmActor, raw: unknown) {
  const input = mergeCompaniesSchema.parse(raw);
  const pre = await loadPair(actor, input.survivorId, input.mergedId);
  assertErpSafe(pre.survivor, pre.merged);
  if (pre.survivor.version !== input.survivorVersion || pre.merged.version !== input.mergedVersion) {
    throw new BusinessRuleError("RECORD_VERSION_CONFLICT", "One of these companies was changed after you opened the merge screen. Reload and review the values again.");
  }

  return runCrmMutation(actor, async (ctx) => {
    const { tx } = ctx;
    await CrmCompanyRepository.lockForUpdate([input.survivorId, input.mergedId], tx);
    const survivor = await CrmCompanyRepository.findRaw({ id: input.survivorId, companyId: actor.companyId }, tx);
    const merged = await CrmCompanyRepository.findRaw({ id: input.mergedId, companyId: actor.companyId }, tx);
    if (!survivor || !merged) throw new BusinessRuleError("NOT_FOUND", "Company not found.");
    if (survivor.mergedIntoId || merged.mergedIntoId || (await tx.crmCompanyMerge.findUnique({ where: { mergedId: merged.id } }))) {
      throw new BusinessRuleError("INVALID_STATE_TRANSITION", "One of these companies has already been merged.");
    }
    if (survivor.version !== input.survivorVersion || merged.version !== input.mergedVersion) {
      throw new BusinessRuleError("RECORD_VERSION_CONFLICT", "One of these companies was changed after you opened the merge screen. Reload and review the values again.");
    }
    assertErpSafe(survivor, merged);

    // 1. Deterministic field resolution
    const { resolved, missing } = resolveCompanyChoices(survivor, merged, input.fieldChoices);
    const sCustom = (survivor.customFields as Record<string, unknown>) ?? {};
    const mCustom = (merged.customFields as Record<string, unknown>) ?? {};
    const missingCustom = conflictingCustomFields(sCustom, mCustom).filter((k) => !input.customFieldChoices[k]);
    if (missing.length || missingCustom.length) {
      throw new BusinessRuleError("VALIDATION_ERROR", `Choose which value to keep for: ${[...missing.map((f) => FIELD_LABELS[f]), ...missingCustom].join(", ")}.`, { conflicts: missing, customFieldConflicts: missingCustom });
    }
    const final = Object.fromEntries(COMPANY_MERGE_FIELDS.map((f) => [f, resolved[f] === "merged" ? merged[f] : survivor[f]])) as Record<CompanyMergeField, string | null>;
    if (blank(final.name)) final.name = survivor.name;
    const customFields: Record<string, unknown> = { ...sCustom };
    for (const [k, v] of Object.entries(mCustom)) {
      const choice = input.customFieldChoices[k] ?? (blank(sCustom[k]) ? "merged" : "survivor");
      if (choice === "merged" && !blank(v)) customFields[k] = v;
    }
    // primaryContactId points at a contact that is (or will be) at the survivor.
    const lostValues = COMPANY_MERGE_FIELDS.filter((f) => !blank(survivor[f]) && !blank(merged[f]) && norm(survivor[f]) !== norm(merged[f])).map((f) => ({ f, value: String(resolved[f] === "merged" ? survivor[f] : merged[f]) }));
    // Reference fields are written by name, not id, so the note stays readable.
    const refName = async (f: CompanyMergeField, id: string): Promise<string> => {
      const row =
        f === "statusId"
          ? await tx.crmCompanyStatus.findFirst({ where: { id, companyId: actor.companyId }, select: { name: true } })
          : f === "sourceId"
            ? await tx.crmLeadSource.findFirst({ where: { id, companyId: actor.companyId }, select: { name: true } })
            : f === "ownerUserId"
              ? await tx.user.findFirst({ where: { id, companyId: actor.companyId }, select: { fullName: true } }).then((u) => (u ? { name: u.fullName } : null))
              : f === "primaryContactId"
                ? await tx.crmContact.findFirst({ where: { id, companyId: actor.companyId }, select: { fullName: true } }).then((c) => (c ? { name: c.fullName } : null))
                : null;
      return row?.name ?? id;
    };
    const notKept: string[] = [];
    for (const { f, value } of lostValues) notKept.push(`${FIELD_LABELS[f]}: ${REFERENCE_FIELDS.has(f) ? await refName(f, value) : value}`);

    // 2. ERP link: never merged, only preserved
    const moveErpLink = !survivor.customerId && Boolean(merged.customerId);
    if (moveErpLink) await tx.crmCompany.update({ where: { id: merged.id }, data: { customerId: null } });

    // 3. Move related records
    const contactIds = (await CrmCompanyRepository.contactIdsOf(actor.companyId, merged.id, tx)).map((c) => c.id);
    const moved = {
      contacts: (await tx.crmContact.updateMany({ where: { companyId: actor.companyId, crmCompanyId: merged.id }, data: { crmCompanyId: survivor.id } })).count,
      leads: (await tx.crmLead.updateMany({ where: { companyId: actor.companyId, crmCompanyId: merged.id }, data: { crmCompanyId: survivor.id } })).count,
      opportunities: (await tx.crmOpportunity.updateMany({ where: { companyId: actor.companyId, crmCompanyId: merged.id }, data: { crmCompanyId: survivor.id } })).count,
      notes: (await tx.crmNote.updateMany({ where: { companyId: actor.companyId, entityType: "COMPANY", entityId: merged.id }, data: { entityId: survivor.id } })).count,
      activities: await CrmActivityRepository.moveToSurvivor(actor.companyId, "COMPANY", merged.id, survivor.id, tx),
      // Phase 11: conversations linked to the merged company follow the survivor.
      conversations: (await tx.crmConversation.updateMany({ where: { companyId: actor.companyId, crmCompanyId: merged.id }, data: { crmCompanyId: survivor.id } })).count,
      documents: (await tx.attachment.updateMany({ where: { companyId: actor.companyId, relatedModule: "CRM_COMPANY", relatedRecordId: merged.id }, data: { relatedRecordId: survivor.id } })).count,
      addresses: (await tx.crmAddress.updateMany({ where: { crmCompanyId: merged.id }, data: { crmCompanyId: survivor.id, isPrimary: false } })).count,
      tags: 0,
      earlierMerges: (await tx.crmCompany.updateMany({ where: { mergedIntoId: merged.id }, data: { mergedIntoId: survivor.id } })).count,
      erpCustomerLink: moveErpLink,
    };
    const tagRows = await tx.crmEntityTag.findMany({ where: { companyId: actor.companyId, entityType: "COMPANY", entityId: merged.id }, select: { tagId: true, tag: { select: { name: true } } } });
    if (tagRows.length) {
      moved.tags = (
        await tx.crmEntityTag.createMany({
          data: tagRows.map((r) => ({ companyId: actor.companyId, tagId: r.tagId, entityType: "COMPANY" as const, entityId: survivor.id, createdByUserId: actor.userId })),
          skipDuplicates: true,
        })
      ).count;
      await tx.crmEntityTag.deleteMany({ where: { companyId: actor.companyId, entityType: "COMPANY", entityId: merged.id } });
    }
    if (!(await tx.crmAddress.count({ where: { crmCompanyId: survivor.id, isPrimary: true } }))) {
      const first = await tx.crmAddress.findFirst({ where: { crmCompanyId: survivor.id }, orderBy: { createdAt: "asc" } });
      if (first) await tx.crmAddress.update({ where: { id: first.id }, data: { isPrimary: true } });
    }

    // 4. Survivor
    const remainingFlags = survivor.flaggedDuplicateIds.filter((x) => x !== merged.id);
    const data: Prisma.CrmCompanyUncheckedUpdateManyInput = {
      ...final,
      name: final.name ?? survivor.name,
      customFields: customFields as Prisma.InputJsonValue,
      sourceLeadId: survivor.sourceLeadId ?? merged.sourceLeadId,
      ...(moveErpLink ? { customerId: merged.customerId } : {}),
      flaggedDuplicateIds: remainingFlags,
      duplicateFlaggedAt: remainingFlags.length ? survivor.duplicateFlaggedAt : null,
      updatedByUserId: actor.userId,
    };
    const { count } = await CrmCompanyRepository.updateVersioned(survivor.id, survivor.version, data, tx);
    if (count === 0) throw new BusinessRuleError("RECORD_VERSION_CONFLICT", "The company you are keeping was changed while merging. Reload and try again.");
    await refreshCompanyDerived(ctx, survivor.id);
    for (const cid of contactIds) await refreshContactDerived(ctx, cid, actor.companyId);
    if (final.name !== survivor.name) for (const c of await CrmCompanyRepository.contactIdsOf(actor.companyId, survivor.id, tx)) if (!contactIds.includes(c.id)) await refreshContactDerived(ctx, c.id, actor.companyId);
    const survivorAfter = (await CrmCompanyRepository.findRaw({ id: survivor.id }, tx))!;

    // 5. Values that were not kept stay readable on the survivor
    if (notKept.length) {
      const note = await tx.crmNote.create({
        data: { companyId: actor.companyId, entityType: "COMPANY", entityId: survivor.id, body: `Values not kept when ${merged.name} was merged into this company:\n${notKept.join("\n")}`, createdByUserId: actor.userId },
      });
      ctx.emit({ entityType: "COMPANY", entityId: survivor.id, eventType: "company.note_added", summary: `Values not kept from ${merged.name}`, payload: { noteId: note.id, fromMerge: true } });
    }

    // 6. Merged company: archived + pointer, never deleted
    const now = new Date();
    await CrmCompanyRepository.updateRaw(
      merged.id,
      { mergedIntoId: survivor.id, mergedAt: now, mergedByUserId: actor.userId, primaryContactId: null, archivedAt: merged.archivedAt ?? now, archivedByUserId: merged.archivedByUserId ?? actor.userId, duplicateFlaggedAt: null, flaggedDuplicateIds: [], updatedByUserId: actor.userId },
      tx
    );
    const addresses = await tx.crmAddress.findMany({ where: { crmCompanyId: survivor.id } });
    const record = await tx.crmCompanyMerge.create({
      data: {
        companyId: actor.companyId,
        survivorId: survivor.id,
        mergedId: merged.id,
        fieldChoices: { fields: resolved, customFields: input.customFieldChoices } as Prisma.InputJsonValue,
        mergedSnapshot: JSON.parse(JSON.stringify({ company: merged, tags: tagRows.map((t) => t.tag.name), addressIdsNowOnSurvivor: addresses.map((a) => a.id), contactIds })) as Prisma.InputJsonValue,
        moved: moved as Prisma.InputJsonValue,
        mergedByUserId: actor.userId,
      },
    });

    await ctx.audit({ tableName: "crm_companies", recordId: survivor.id, action: "UPDATE", oldValues: survivor, newValues: { ...survivorAfter, mergedFrom: merged.id } });
    await ctx.audit({ tableName: "crm_companies", recordId: merged.id, action: "UPDATE", oldValues: { mergedIntoId: null, archivedAt: merged.archivedAt, customerId: merged.customerId }, newValues: { mergedIntoId: survivor.id, mergedAt: now, customerId: null } });
    await ctx.audit({ tableName: "crm_company_merges", recordId: record.id, action: "CREATE", newValues: { survivorId: survivor.id, mergedId: merged.id, fieldChoices: resolved, moved } });
    ctx.emit({ entityType: "COMPANY", entityId: survivor.id, eventType: "company.merged", summary: `Merged ${merged.name} into this company`, payload: { mergedId: merged.id, mergeId: record.id, moved } });
    ctx.emit({ entityType: "COMPANY", entityId: merged.id, eventType: "company.merged_into", summary: `Merged into ${survivorAfter.name}`, payload: { survivorId: survivor.id, mergeId: record.id } });
    if (moveErpLink) ctx.emit({ entityType: "COMPANY", entityId: survivor.id, eventType: "company.erp_customer_linked", summary: "Kept from the merged company", payload: { customerId: merged.customerId, fromMerge: true } });
    return { survivor: survivorAfter, mergeId: record.id, moved };
  });
}
