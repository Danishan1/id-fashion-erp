import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError, isUniqueConstraintViolationOnColumn } from "@/core/errors/BusinessRuleError";
import type { CrmActor } from "../core/crm-actor";
import {
  DEFAULT_LEAD_DUPLICATE_RULES,
  DEFAULT_LEAD_SOURCES,
  DEFAULT_LEAD_STATUSES,
  type LeadDuplicateRule,
  type LeadDuplicateRuleKey,
} from "./crm-defaults";
import { CrmLeadSourceRepository, CrmLeadStatusRepository, CrmSettingsRepository } from "./crm-settings.repository";
import {
  createLeadSourceSchema,
  createLeadStatusSchema,
  keyFromName,
  leadDuplicateRulesSchema,
  reorderSchema,
  updateLeadSourceSchema,
  updateLeadStatusSchema,
} from "./crm-settings.schema";

/**
 * Creates the default lead statuses / sources for a company the first time
 * they are needed (idempotent: unique (company, key) + skipDuplicates, so two
 * concurrent first requests cannot create doubles).
 */
export async function ensureCrmLeadDefaults(companyId: string): Promise<void> {
  const [statusCount, sourceCount] = await Promise.all([
    CrmLeadStatusRepository.count(companyId),
    CrmLeadSourceRepository.count(companyId),
  ]);
  if (statusCount === 0) {
    await CrmLeadStatusRepository.createMany(
      DEFAULT_LEAD_STATUSES.map((s, i) => ({
        companyId,
        key: s.key,
        name: s.name,
        kind: s.kind,
        color: s.color,
        isDefault: Boolean(s.isDefault),
        sortOrder: (i + 1) * 10,
      }))
    );
  }
  if (sourceCount === 0) {
    await CrmLeadSourceRepository.createMany(
      DEFAULT_LEAD_SOURCES.map((s, i) => ({ companyId, key: s.key, name: s.name, isSystem: s.isSystem, sortOrder: (i + 1) * 10 }))
    );
  }
}

// ── Lead statuses ────────────────────────────────────────────────

export async function listLeadStatuses(companyId: string, { includeInactive = true } = {}) {
  await ensureCrmLeadDefaults(companyId);
  return CrmLeadStatusRepository.list(companyId, includeInactive);
}

export async function getDefaultLeadStatus(companyId: string) {
  await ensureCrmLeadDefaults(companyId);
  const status = (await CrmLeadStatusRepository.findDefault(companyId)) ?? (await CrmLeadStatusRepository.findFirstOfKind(companyId, "OPEN"));
  if (!status) throw new BusinessRuleError("VALIDATION_ERROR", "No active open lead status is configured. Add one in CRM Settings.");
  return status;
}

export async function getConvertedLeadStatus(companyId: string) {
  await ensureCrmLeadDefaults(companyId);
  const status = await CrmLeadStatusRepository.findFirstOfKind(companyId, "CONVERTED");
  if (!status) throw new BusinessRuleError("VALIDATION_ERROR", "No active 'Converted' lead status is configured. Add one in CRM Settings.");
  return status;
}

export async function getLeadStatusForCompany(companyId: string, statusId: string) {
  const status = await CrmLeadStatusRepository.findById(companyId, statusId);
  if (!status) throw new BusinessRuleError("NOT_FOUND", "Lead status not found.", { id: statusId });
  return status;
}

async function uniqueKey(companyId: string, base: string, exists: (key: string) => Promise<unknown>) {
  let key = base;
  for (let i = 2; await exists(key); i++) key = `${base}_${i}`.slice(0, 40);
  return key;
}

export async function createLeadStatus(actor: CrmActor, raw: unknown) {
  const input = createLeadStatusSchema.parse(raw);
  await ensureCrmLeadDefaults(actor.companyId);
  const key = input.key ?? (await uniqueKey(actor.companyId, keyFromName(input.name), (k) => CrmLeadStatusRepository.findByKey(actor.companyId, k)));
  const max = await CrmLeadStatusRepository.maxSortOrder(actor.companyId);
  try {
    const status = await CrmLeadStatusRepository.create({
      companyId: actor.companyId,
      key,
      name: input.name,
      kind: input.kind,
      color: input.color,
      sortOrder: (max._max.sortOrder ?? 0) + 10,
    });
    await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName: "crm_lead_statuses", recordId: status.id, action: "CREATE", newValues: status });
    return status;
  } catch (error) {
    if (isUniqueConstraintViolationOnColumn(error, "key")) throw new BusinessRuleError("VALIDATION_ERROR", `A status with key "${key}" already exists.`);
    throw error;
  }
}

/**
 * Guards keep the configuration usable: there is always exactly one default
 * (an active OPEN status), at least one active OPEN and one active CONVERTED
 * status, and a status that leads are using cannot change what it means.
 */
export async function updateLeadStatus(actor: CrmActor, id: string, raw: unknown) {
  const input = updateLeadStatusSchema.parse(raw);
  const before = await getLeadStatusForCompany(actor.companyId, id);
  const nextKind = input.kind ?? before.kind;
  const nextActive = input.isActive ?? before.isActive;

  if (input.kind && input.kind !== before.kind && (await CrmLeadStatusRepository.countLeadsUsing(actor.companyId, id)) > 0) {
    throw new BusinessRuleError("VALIDATION_ERROR", "This status is used by leads, so its meaning (Open / Converted / Lost) can't change. Create a new status instead.");
  }
  if (before.isDefault && (!nextActive || nextKind !== "OPEN")) {
    throw new BusinessRuleError("VALIDATION_ERROR", "This is the default status for new leads. Make another status the default first.");
  }
  if (input.isDefault && (!nextActive || nextKind !== "OPEN")) {
    throw new BusinessRuleError("VALIDATION_ERROR", "Only an active 'Open' status can be the default for new leads.");
  }
  const losingKind = before.isActive && before.kind !== "LOST" && (!nextActive || nextKind !== before.kind);
  if (losingKind && (await CrmLeadStatusRepository.countActiveOfKind(actor.companyId, before.kind, id)) === 0) {
    throw new BusinessRuleError(
      "VALIDATION_ERROR",
      before.kind === "OPEN" ? "At least one active 'Open' status is required." : "At least one active 'Converted' status is required for lead conversion."
    );
  }

  const updated = await CrmLeadStatusRepository.transaction(async (tx) => {
    if (input.isDefault) await CrmLeadStatusRepository.clearDefault(actor.companyId, tx);
    return CrmLeadStatusRepository.update(
      id,
      {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.kind !== undefined ? { kind: input.kind } : {}),
        ...(input.color !== undefined ? { color: input.color } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(input.isDefault ? { isDefault: true } : {}),
      },
      tx
    );
  });
  await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName: "crm_lead_statuses", recordId: id, action: "UPDATE", oldValues: before, newValues: updated });
  return updated;
}

export async function reorderLeadStatuses(actor: CrmActor, raw: unknown) {
  const { ids } = reorderSchema.parse(raw);
  const existing = await CrmLeadStatusRepository.list(actor.companyId);
  const known = new Set(existing.map((s) => s.id));
  if (ids.length !== known.size || ids.some((id) => !known.has(id))) {
    throw new BusinessRuleError("VALIDATION_ERROR", "Send every status exactly once to reorder.");
  }
  await CrmLeadStatusRepository.transaction(async (tx) => {
    for (const [i, id] of ids.entries()) await CrmLeadStatusRepository.update(id, { sortOrder: (i + 1) * 10 }, tx);
  });
  await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName: "crm_lead_statuses", recordId: ids[0], action: "UPDATE", newValues: { order: ids } });
  return CrmLeadStatusRepository.list(actor.companyId);
}

// ── Lead sources ─────────────────────────────────────────────────

export async function listLeadSources(companyId: string, { includeInactive = true } = {}) {
  await ensureCrmLeadDefaults(companyId);
  return CrmLeadSourceRepository.list(companyId, includeInactive);
}

export async function getLeadSourceForCompany(companyId: string, sourceId: string) {
  const source = await CrmLeadSourceRepository.findById(companyId, sourceId);
  if (!source) throw new BusinessRuleError("NOT_FOUND", "Lead source not found.", { id: sourceId });
  return source;
}

/** For integrations / imports: resolve a source by its stable key ("indiamart"). */
export async function getLeadSourceByKey(companyId: string, key: string) {
  await ensureCrmLeadDefaults(companyId);
  return CrmLeadSourceRepository.findByKey(companyId, key);
}

export async function createLeadSource(actor: CrmActor, raw: unknown) {
  const input = createLeadSourceSchema.parse(raw);
  await ensureCrmLeadDefaults(actor.companyId);
  const key = input.key ?? (await uniqueKey(actor.companyId, keyFromName(input.name), (k) => CrmLeadSourceRepository.findByKey(actor.companyId, k)));
  const max = await CrmLeadSourceRepository.maxSortOrder(actor.companyId);
  try {
    const source = await CrmLeadSourceRepository.create({ companyId: actor.companyId, key, name: input.name, sortOrder: (max._max.sortOrder ?? 0) + 10 });
    await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName: "crm_lead_sources", recordId: source.id, action: "CREATE", newValues: source });
    return source;
  } catch (error) {
    if (isUniqueConstraintViolationOnColumn(error, "key")) throw new BusinessRuleError("VALIDATION_ERROR", `A source with key "${key}" already exists.`);
    throw error;
  }
}

export async function updateLeadSource(actor: CrmActor, id: string, raw: unknown) {
  const input = updateLeadSourceSchema.parse(raw);
  const before = await getLeadSourceForCompany(actor.companyId, id);
  if (input.isActive === false && before.isSystem) {
    throw new BusinessRuleError("VALIDATION_ERROR", `"${before.name}" is used by the system (manual entry, import, API or a connector) and can't be deactivated. You can rename it.`);
  }
  const updated = await CrmLeadSourceRepository.update(id, {
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
  });
  await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName: "crm_lead_sources", recordId: id, action: "UPDATE", oldValues: before, newValues: updated });
  return updated;
}

// ── Duplicate rules ──────────────────────────────────────────────

export async function getLeadDuplicateRules(companyId: string): Promise<LeadDuplicateRule[]> {
  const settings = await CrmSettingsRepository.find(companyId);
  const stored = Array.isArray(settings?.leadDuplicateRules) ? (settings!.leadDuplicateRules as unknown as LeadDuplicateRule[]) : [];
  const byRule = new Map<LeadDuplicateRuleKey, LeadDuplicateRule>(stored.map((r) => [r.rule, r]));
  return DEFAULT_LEAD_DUPLICATE_RULES.map((d) => byRule.get(d.rule) ?? d);
}

export async function updateLeadDuplicateRules(actor: CrmActor, raw: unknown) {
  const { rules } = leadDuplicateRulesSchema.parse(raw);
  const before = await getLeadDuplicateRules(actor.companyId);
  const byRule = new Map(rules.map((r) => [r.rule, r]));
  const merged = before.map((r) => byRule.get(r.rule) ?? r);
  await CrmSettingsRepository.upsertDuplicateRules(actor.companyId, merged as never, actor.userId);
  await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName: "crm_settings", recordId: actor.companyId, action: "UPDATE", oldValues: { leadDuplicateRules: before }, newValues: { leadDuplicateRules: merged } });
  return merged;
}
