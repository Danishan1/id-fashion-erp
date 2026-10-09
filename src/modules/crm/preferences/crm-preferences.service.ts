import type { Prisma } from "@prisma/client";
import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import type { CrmActor } from "../core/crm-actor";
import { CRM_PREFERENCES, isCrmPreferenceKey, type CrmPreferenceKey } from "./crm-preference-registry";

/**
 * Per-user CRM screen preferences (Phase 08). Always scoped to the signed-in
 * user — nobody reads or writes another user's preferences. Not audited:
 * presentation only.
 */
function assertKey(key: string): asserts key is CrmPreferenceKey {
  if (!isCrmPreferenceKey(key)) throw new BusinessRuleError("VALIDATION_ERROR", `Unknown preference "${key}".`);
}

/** All of the user's preferences under a prefix (e.g. "opportunities."), as { key: value }. */
export async function getPreferences(actor: CrmActor, prefix = "") {
  const rows = await prisma.crmUserPreference.findMany({ where: { companyId: actor.companyId, userId: actor.userId, key: { startsWith: prefix } }, select: { key: true, value: true } });
  // Values that no longer match their schema (a key's shape changed) are ignored, not returned.
  return Object.fromEntries(rows.filter((r) => isCrmPreferenceKey(r.key) && CRM_PREFERENCES[r.key].safeParse(r.value).success).map((r) => [r.key, r.value]));
}

export async function setPreference(actor: CrmActor, key: string, raw: unknown) {
  assertKey(key);
  const value = CRM_PREFERENCES[key].parse(raw) as Prisma.InputJsonValue;
  await prisma.crmUserPreference.upsert({
    where: { userId_key: { userId: actor.userId, key } },
    create: { companyId: actor.companyId, userId: actor.userId, key, value },
    update: { value },
  });
  return { key, value };
}

export async function deletePreference(actor: CrmActor, key: string) {
  assertKey(key);
  await prisma.crmUserPreference.deleteMany({ where: { userId: actor.userId, companyId: actor.companyId, key } });
}
