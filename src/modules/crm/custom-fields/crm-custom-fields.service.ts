import type { CrmCustomFieldDefinition, CrmEntityType } from "@prisma/client";
import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import type { CrmActor } from "../core/crm-actor";
import { keyFromName } from "../settings/crm-settings.schema";
import { CrmCustomFieldRepository } from "./crm-custom-field.repository";
import { createCustomFieldSchema, updateCustomFieldSchema } from "./crm-custom-field.schema";
import type { CrmCustomFieldDefinitionDto, CrmCustomFieldOption } from "./crm-custom-field-types";

/**
 * Shared CRM custom-field engine (decision: one engine for every CRM entity).
 * Definitions are metadata rows; values live in the record's `customFields`
 * JSON keyed by definition `key`, so creating a field needs no migration.
 * Phase 15 adds grouping, defaults, filtering and reporting on top of this.
 */
export function toCustomFieldDto(d: CrmCustomFieldDefinition): CrmCustomFieldDefinitionDto {
  return {
    id: d.id,
    key: d.key,
    label: d.label,
    fieldType: d.fieldType,
    description: d.description,
    options: (d.options as CrmCustomFieldOption[] | null) ?? null,
    isRequired: d.isRequired,
    isActive: d.isActive,
    sortOrder: d.sortOrder,
  };
}

export async function listCustomFields(companyId: string, entityType: CrmEntityType, { includeInactive = false } = {}) {
  return (await CrmCustomFieldRepository.list(companyId, entityType, includeInactive)).map(toCustomFieldDto);
}

export async function createCustomField(actor: CrmActor, entityType: CrmEntityType, raw: unknown) {
  const input = createCustomFieldSchema.parse(raw);
  let key = input.key ?? keyFromName(input.label).slice(0, 50);
  if (!input.key) {
    for (let i = 2; await CrmCustomFieldRepository.findByKey(actor.companyId, entityType, key); i++) key = `${keyFromName(input.label).slice(0, 45)}_${i}`;
  } else if (await CrmCustomFieldRepository.findByKey(actor.companyId, entityType, key)) {
    throw new BusinessRuleError("VALIDATION_ERROR", `A field with key "${key}" already exists.`);
  }
  const max = await CrmCustomFieldRepository.maxSortOrder(actor.companyId, entityType);
  const created = await CrmCustomFieldRepository.create({
    companyId: actor.companyId,
    entityType,
    key,
    label: input.label,
    fieldType: input.fieldType as CrmCustomFieldDefinition["fieldType"],
    description: input.description || null,
    options: input.options && (input.fieldType === "DROPDOWN" || input.fieldType === "MULTI_SELECT") ? input.options : undefined,
    isRequired: input.isRequired,
    sortOrder: (max._max.sortOrder ?? 0) + 10,
  });
  await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName: "crm_custom_field_definitions", recordId: created.id, action: "CREATE", newValues: created });
  return toCustomFieldDto(created);
}

export async function updateCustomField(actor: CrmActor, id: string, raw: unknown) {
  const input = updateCustomFieldSchema.parse(raw);
  const before = await CrmCustomFieldRepository.findById(actor.companyId, id);
  if (!before) throw new BusinessRuleError("NOT_FOUND", "Custom field not found.", { id });
  if (input.options && !(before.fieldType === "DROPDOWN" || before.fieldType === "MULTI_SELECT")) {
    throw new BusinessRuleError("VALIDATION_ERROR", "Only dropdown and multi-select fields have options.");
  }
  const updated = await CrmCustomFieldRepository.update(id, {
    ...(input.label !== undefined ? { label: input.label } : {}),
    ...(input.description !== undefined ? { description: input.description || null } : {}),
    ...(input.options !== undefined ? { options: input.options } : {}),
    ...(input.isRequired !== undefined ? { isRequired: input.isRequired } : {}),
    ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
  });
  await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName: "crm_custom_field_definitions", recordId: id, action: "UPDATE", oldValues: before, newValues: updated });
  return toCustomFieldDto(updated);
}

export type CustomFieldValues = Record<string, unknown>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function coerce(def: CrmCustomFieldDefinitionDto, raw: unknown): { value?: unknown; error?: string } {
  if (raw === null || raw === undefined || raw === "" || (Array.isArray(raw) && raw.length === 0)) return { value: null };
  const asString = typeof raw === "string" ? raw.trim() : raw;
  switch (def.fieldType) {
    case "TEXT":
    case "TEXTAREA":
    case "PHONE": {
      if (typeof asString !== "string") return { error: "must be text" };
      const max = def.fieldType === "TEXTAREA" ? 5000 : 300;
      if (asString.length > max) return { error: `must be at most ${max} characters` };
      if (def.fieldType === "PHONE" && !/^[+\d\s().-]{5,30}$/.test(asString)) return { error: "must be a valid phone number" };
      return { value: asString };
    }
    case "EMAIL":
      if (typeof asString !== "string" || !EMAIL_RE.test(asString)) return { error: "must be a valid email" };
      return { value: asString.toLowerCase() };
    case "URL":
      try {
        const u = new URL(String(asString));
        if (!["http:", "https:"].includes(u.protocol)) return { error: "must start with http:// or https://" };
        return { value: u.toString() };
      } catch {
        return { error: "must be a valid URL" };
      }
    case "NUMBER": {
      const n = typeof asString === "number" ? asString : Number(asString);
      if (!Number.isInteger(n)) return { error: "must be a whole number" };
      return { value: n };
    }
    case "DECIMAL":
    case "CURRENCY": {
      const n = typeof asString === "number" ? asString : Number(asString);
      if (!Number.isFinite(n)) return { error: "must be a number" };
      return { value: def.fieldType === "CURRENCY" ? Math.round(n * 100) / 100 : n };
    }
    case "DATE":
      if (typeof asString !== "string" || !DATE_RE.test(asString) || Number.isNaN(Date.parse(asString))) return { error: "must be a date (YYYY-MM-DD)" };
      return { value: asString };
    case "DATETIME": {
      const d = new Date(String(asString));
      if (Number.isNaN(d.getTime())) return { error: "must be a date and time" };
      return { value: d.toISOString() };
    }
    case "BOOLEAN":
      if (typeof raw === "boolean") return { value: raw };
      if (raw === "true" || raw === "false") return { value: raw === "true" };
      return { error: "must be yes or no" };
    case "DROPDOWN": {
      const allowed = new Set((def.options ?? []).map((o) => o.value));
      if (typeof asString !== "string" || !allowed.has(asString)) return { error: "must be one of the listed options" };
      return { value: asString };
    }
    case "MULTI_SELECT": {
      const allowed = new Set((def.options ?? []).map((o) => o.value));
      const arr = Array.isArray(raw) ? raw : [raw];
      if (!arr.every((v) => typeof v === "string" && allowed.has(v))) return { error: "must only contain listed options" };
      return { value: [...new Set(arr as string[])] };
    }
  }
}

/**
 * Validates submitted custom-field values against the company's definitions.
 * - Unknown keys are rejected (they would otherwise silently pile up).
 * - Values for inactive fields that the record already has are preserved.
 * - Required active fields must have a value (on update, only if submitted
 *   or if the record has no stored value yet).
 * Returns the full JSON to store.
 */
export function validateCustomFieldValues(
  definitions: CrmCustomFieldDefinitionDto[],
  submitted: CustomFieldValues | undefined,
  existing: CustomFieldValues = {}
): CustomFieldValues {
  const byKey = new Map(definitions.map((d) => [d.key, d]));
  const errors: Record<string, string> = {};
  const result: CustomFieldValues = { ...existing };

  for (const [key, raw] of Object.entries(submitted ?? {})) {
    const def = byKey.get(key);
    if (!def) {
      errors[key] = "Unknown custom field.";
      continue;
    }
    if (!def.isActive) continue; // archived field: keep whatever was stored
    const { value, error } = coerce(def, raw);
    if (error) errors[key] = `${def.label} ${error}.`;
    else if (value === null) delete result[key];
    else result[key] = value;
  }
  for (const def of definitions) {
    if (def.isActive && def.isRequired && (result[def.key] === undefined || result[def.key] === null) && !errors[def.key]) {
      errors[def.key] = `${def.label} is required.`;
    }
  }
  if (Object.keys(errors).length > 0) {
    throw new BusinessRuleError("VALIDATION_ERROR", Object.values(errors)[0], { fieldErrors: Object.fromEntries(Object.entries(errors).map(([k, v]) => [`customFields.${k}`, v])) });
  }
  return result;
}
