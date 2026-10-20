import { PermissionService } from "@/core/rbac/PermissionService";
import type { BulkActionDefinition, BulkActor, BulkAvailability, BulkEntityDefinition, BulkParamField } from "./bulk-types";

/**
 * The bulk action registry. Clients only ever send an entity type and an
 * action key; both must be registered here, and the action must belong to the
 * entity — a client can never name a service, table, field or function.
 *
 * Modules register at import time (see bulk-registrations.ts).
 */
const entities = new Map<string, BulkEntityDefinition>();
const actions = new Map<string, BulkActionDefinition<never>>();

const ENTITY_KEY = /^[A-Z][A-Z0-9_]{1,40}$/;
const ACTION_KEY = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_.]*$/;

export function registerEntity(def: BulkEntityDefinition): void {
  if (!ENTITY_KEY.test(def.entityType)) throw new Error(`Invalid bulk entity type "${def.entityType}".`);
  if (entities.has(def.entityType)) throw new Error(`Bulk entity "${def.entityType}" is already registered.`);
  entities.set(def.entityType, def);
}

export function registerAction<P>(def: BulkActionDefinition<P>): void {
  if (!ACTION_KEY.test(def.key)) throw new Error(`Invalid bulk action key "${def.key}".`);
  if (actions.has(def.key)) throw new Error(`Bulk action "${def.key}" is already registered.`);
  if (!entities.has(def.entityType)) throw new Error(`Bulk action "${def.key}": entity "${def.entityType}" is not registered.`);
  if (!def.unavailableReason && !def.executeItem && !def.executeBatch) throw new Error(`Bulk action "${def.key}" needs executeItem / executeBatch (or an unavailableReason).`);
  if (def.maxItems < 1) throw new Error(`Bulk action "${def.key}": maxItems must be positive.`);
  actions.set(def.key, def as unknown as BulkActionDefinition<never>);
}

export function getEntity(entityType: string): BulkEntityDefinition | null {
  return entities.get(entityType) ?? null;
}

export function listEntities(): BulkEntityDefinition[] {
  return [...entities.values()];
}

/** The handler for a key — only if it belongs to the given entity type. */
export function getHandler(entityType: string, actionKey: string): BulkActionDefinition<Record<string, unknown>> | null {
  const def = actions.get(actionKey);
  if (!def || def.entityType !== entityType) return null;
  return def as unknown as BulkActionDefinition<Record<string, unknown>>;
}

export function listActions(entityType: string): BulkActionDefinition<Record<string, unknown>>[] {
  return [...actions.values()].filter((a) => a.entityType === entityType) as unknown as BulkActionDefinition<Record<string, unknown>>[];
}

export async function hasAllPermissions(userId: string, perms: { module: Parameters<typeof PermissionService.can>[1]; action: Parameters<typeof PermissionService.can>[2] }[]): Promise<boolean> {
  for (const p of perms) if (!(await PermissionService.can(userId, p.module, p.action))) return false;
  return true;
}

/** Whether an action can be used by this user right now, and why not. */
export async function actionAvailability(actor: BulkActor, def: BulkActionDefinition<Record<string, unknown>>): Promise<BulkAvailability> {
  if (def.unavailableReason) return { available: false, reason: def.unavailableReason };
  if (!(await hasAllPermissions(actor.userId, def.permissions))) {
    return { available: false, reason: `You need ${def.permissions.map((p) => `${p.module}.${p.action}`).join(" and ")} for this action.` };
  }
  if (def.availability) return def.availability(actor);
  return { available: true };
}

export interface BulkActionCapability {
  key: string;
  kind: string;
  label: string;
  description: string;
  available: boolean;
  unavailableReason: string | null;
  destructive: boolean;
  confirmation: "none" | "confirm" | "type_count";
  cancellable: boolean;
  retrySafe: boolean;
  maxItems: number;
  fields: BulkParamField[];
}

/**
 * Actions for an entity as this user may see them: available ones with their
 * parameter fields, unavailable ones with the reason (so the UI can explain).
 * Returns [] when the user can't view the entity at all.
 */
export async function getAvailableActions(actor: BulkActor, entityType: string): Promise<BulkActionCapability[]> {
  const entity = getEntity(entityType);
  if (!entity) return [];
  if (!(await PermissionService.can(actor.userId, entity.viewPermission.module, entity.viewPermission.action))) return [];
  const out: BulkActionCapability[] = [];
  for (const def of listActions(entityType)) {
    const av = await actionAvailability(actor, def);
    out.push({
      key: def.key,
      kind: def.kind,
      label: def.label,
      description: def.description,
      available: av.available,
      unavailableReason: av.available ? null : (av.reason ?? "Not available."),
      destructive: Boolean(def.destructive),
      confirmation: def.confirmation,
      cancellable: def.cancellable,
      retrySafe: def.retrySafe,
      maxItems: def.maxItems,
      fields: av.available && def.fields ? await def.fields(actor) : [],
    });
  }
  return out;
}

/** Test-only: empties the registry. */
export function __resetBulkRegistryForTests(): void {
  entities.clear();
  actions.clear();
}
