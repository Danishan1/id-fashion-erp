import type { CrmEntityType } from "@prisma/client";
import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError, isUniqueConstraintViolationOnColumn } from "@/core/errors/BusinessRuleError";
import type { CrmActor } from "../core/crm-actor";
import type { CrmDb } from "../core/crm-db";
import { nameKey } from "../core/crm-normalize";
import { CrmTagRepository, type CrmTagDto } from "./crm-tag.repository";
import { createTagSchema, updateTagSchema, type EntityTagChange } from "./crm-tag.schema";

/**
 * Reusable tagging for every CRM record type. A tag is unique per company by
 * its normalised name, so "VIP", "vip " and "Vip" are the same tag.
 */
export async function listTags(companyId: string, search?: string, take = 100) {
  const rows = await CrmTagRepository.list(companyId, search?.trim() || undefined, take);
  return rows.map((t) => ({ id: t.id, name: t.name, color: t.color, usageCount: t._count.assignments }));
}

/** Returns the existing tag when one with the same normalised name exists. */
export async function findOrCreateTags(actor: CrmActor, names: string[], db?: CrmDb): Promise<CrmTagDto[]> {
  const unique = new Map<string, string>();
  for (const n of names) {
    const display = n.trim().replace(/\s+/g, " ");
    if (display) unique.set(nameKey(display), display);
  }
  if (unique.size === 0) return [];
  const keys = [...unique.keys()];
  await CrmTagRepository.createMany(
    keys.map((k) => ({ companyId: actor.companyId, name: unique.get(k)!, nameKey: k, createdByUserId: actor.userId })),
    db
  );
  const rows = await CrmTagRepository.findManyByKeys(actor.companyId, keys, db);
  return rows.map(({ id, name, color }) => ({ id, name, color }));
}

export async function createTag(actor: CrmActor, raw: unknown) {
  const input = createTagSchema.parse(raw);
  const [tag] = await findOrCreateTags(actor, [input.name]);
  return tag;
}

export async function updateTag(actor: CrmActor, id: string, raw: unknown) {
  const input = updateTagSchema.parse(raw);
  const before = await CrmTagRepository.findById(actor.companyId, id);
  if (!before) throw new BusinessRuleError("NOT_FOUND", "Tag not found.", { id });
  try {
    const updated = await CrmTagRepository.update(id, {
      ...(input.name !== undefined ? { name: input.name.replace(/\s+/g, " "), nameKey: nameKey(input.name) } : {}),
      ...(input.color !== undefined ? { color: input.color } : {}),
    });
    await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName: "crm_tags", recordId: id, action: "UPDATE", oldValues: before, newValues: updated });
    return updated;
  } catch (error) {
    if (isUniqueConstraintViolationOnColumn(error, "name_key") || isUniqueConstraintViolationOnColumn(error, "nameKey")) {
      throw new BusinessRuleError("VALIDATION_ERROR", "Another tag already has that name.");
    }
    throw error;
  }
}

/** Removes the tag everywhere it is used (settings action). */
export async function deleteTag(actor: CrmActor, id: string) {
  const before = await CrmTagRepository.findById(actor.companyId, id);
  if (!before) throw new BusinessRuleError("NOT_FOUND", "Tag not found.", { id });
  await CrmTagRepository.delete(id);
  await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName: "crm_tags", recordId: id, action: "DELETE", oldValues: before });
}

/**
 * Applies a tag change to one record inside the caller's transaction and
 * reports exactly which tags were added/removed (no-ops are dropped), so the
 * caller can emit one timeline event per real change.
 */
export async function applyEntityTagChange(
  actor: CrmActor,
  entityType: CrmEntityType,
  entityId: string,
  change: Pick<EntityTagChange, "addTagIds" | "addTagNames" | "removeTagIds">,
  db: CrmDb
): Promise<{ added: CrmTagDto[]; removed: CrmTagDto[] }> {
  const current = new Set((await CrmTagRepository.assignedTagIds(actor.companyId, entityType, entityId, db)).map((r) => r.tagId));

  const byId = change.addTagIds.length ? await CrmTagRepository.findManyByIds(actor.companyId, change.addTagIds, db) : [];
  if (byId.length !== new Set(change.addTagIds).size) throw new BusinessRuleError("NOT_FOUND", "One or more tags were not found.");
  const byName = await findOrCreateTags(actor, change.addTagNames, db);
  const toAdd = [...new Map([...byId, ...byName].map((t) => [t.id, t])).values()].filter((t) => !current.has(t.id));

  const removeIds = change.removeTagIds.filter((id) => current.has(id) && !toAdd.some((t) => t.id === id));
  const removed = removeIds.length ? await CrmTagRepository.findManyByIds(actor.companyId, removeIds, db) : [];

  if (toAdd.length) {
    await CrmTagRepository.assign(
      toAdd.map((t) => ({ companyId: actor.companyId, tagId: t.id, entityType, entityId, createdByUserId: actor.userId })),
      db
    );
  }
  if (removeIds.length) await CrmTagRepository.unassign(actor.companyId, entityType, entityId, removeIds, db);
  return { added: toAdd, removed };
}

export async function tagsByEntity(companyId: string, entityType: CrmEntityType, entityIds: string[]): Promise<Map<string, CrmTagDto[]>> {
  const map = new Map<string, CrmTagDto[]>();
  if (entityIds.length === 0) return map;
  for (const row of await CrmTagRepository.tagsForEntities(companyId, entityType, entityIds)) {
    const list = map.get(row.entityId) ?? [];
    list.push(row.tag);
    map.set(row.entityId, list);
  }
  return map;
}
