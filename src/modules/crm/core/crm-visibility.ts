import { Prisma } from "@prisma/client";
import { PermissionService } from "@/core/rbac/PermissionService";
import { getTeamScope } from "@/core/hierarchy/team-scope";
import type { CrmActor } from "./crm-actor";

/**
 * Which CRM records a user may see (decision D5, 2026-10-01; team added P3,
 * 2026-10-21):
 *   - crm.view_all  → every record in the company ("ALL")
 *   - crm.view only → records they own, records owned by anyone below them in
 *     the CRM reporting hierarchy, plus unassigned records any of those people
 *     created ("OWN"). With no CRM team, that is just their own records.
 * Every CRM list/detail/mutation query must apply `crmOwnerWhere(scope)` so the
 * rule is enforced the same way for the UI, the API, bulk actions and (later)
 * workflows. A record outside the scope behaves as "not found".
 */
export type CrmRecordScope = { mode: "ALL" } | { mode: "OWN"; userId: string; teamUserIds?: string[] };

export async function getCrmRecordScope(actor: CrmActor): Promise<CrmRecordScope> {
  const canViewAll = await PermissionService.can(actor.userId, "crm", "view_all");
  if (canViewAll) return { mode: "ALL" };
  const team = await getTeamScope(actor.userId, "CRM");
  return { mode: "OWN", userId: actor.userId, teamUserIds: team.teamUserIds };
}

/** The user ids whose records an OWN scope covers: the caller plus their CRM team. */
export function crmScopeUserIds(scope: Extract<CrmRecordScope, { mode: "OWN" }>): string[] {
  return [scope.userId, ...(scope.teamUserIds ?? [])];
}

/** Prisma filter value for "one of the scope's users": a plain id when there's no team. */
export function crmScopeUserFilter(scope: Extract<CrmRecordScope, { mode: "OWN" }>): string | { in: string[] } {
  const ids = crmScopeUserIds(scope);
  return ids.length === 1 ? ids[0] : { in: ids };
}

/** True when `userId` is the caller or someone in their CRM team (always true for ALL). */
export function isCrmScopeUser(scope: CrmRecordScope, userId: string | null | undefined): boolean {
  if (scope.mode === "ALL") return true;
  if (!userId) return false;
  return userId === scope.userId || (scope.teamUserIds ?? []).includes(userId);
}

/** Prisma `where` fragment for a scope. Records with no owner stay visible to whoever created them. */
export function crmOwnerWhere(
  scope: CrmRecordScope,
  fields: { owner: string; createdBy: string } = { owner: "ownerUserId", createdBy: "createdByUserId" }
): Record<string, unknown> {
  if (scope.mode === "ALL") return {};
  const ids = crmScopeUserIds(scope);
  if (ids.length === 1) {
    return {
      OR: [{ [fields.owner]: scope.userId }, { [fields.owner]: null, [fields.createdBy]: scope.userId }],
    };
  }
  return {
    OR: [{ [fields.owner]: { in: ids } }, { [fields.owner]: null, [fields.createdBy]: { in: ids } }],
  };
}

/** Raw-SQL version of crmOwnerWhere for a table alias (e.g. "o"): `AND (...)`, or empty for ALL. */
export function crmOwnerSql(scope: CrmRecordScope, alias: string): Prisma.Sql {
  if (scope.mode === "ALL") return Prisma.empty;
  const ids = Prisma.join(crmScopeUserIds(scope).map((id) => Prisma.sql`${id}::uuid`));
  const owner = Prisma.raw(`"${alias}"."owner_user_id"`);
  const createdBy = Prisma.raw(`"${alias}"."created_by_user_id"`);
  return Prisma.sql`AND (${owner} IN (${ids}) OR (${owner} IS NULL AND ${createdBy} IN (${ids})))`;
}

export function isWithinCrmScope(scope: CrmRecordScope, record: { ownerUserId: string | null; createdByUserId: string }): boolean {
  if (scope.mode === "ALL") return true;
  return isCrmScopeUser(scope, record.ownerUserId) || (record.ownerUserId === null && isCrmScopeUser(scope, record.createdByUserId));
}
