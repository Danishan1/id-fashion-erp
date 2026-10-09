import { PermissionService } from "@/core/rbac/PermissionService";
import type { CrmActor } from "./crm-actor";

/**
 * Which CRM records a user may see (decision D5, 2026-10-01):
 *   - crm.view_all  → every record in the company ("ALL")
 *   - crm.view only → records they own, plus unassigned records they created ("OWN")
 * Every CRM list/detail/mutation query must apply `crmOwnerWhere(scope)` so the
 * rule is enforced the same way for the UI, the API, bulk actions and (later)
 * workflows. A record outside the scope behaves as "not found".
 */
export type CrmRecordScope = { mode: "ALL" } | { mode: "OWN"; userId: string };

export async function getCrmRecordScope(actor: CrmActor): Promise<CrmRecordScope> {
  const canViewAll = await PermissionService.can(actor.userId, "crm", "view_all");
  return canViewAll ? { mode: "ALL" } : { mode: "OWN", userId: actor.userId };
}

/** Prisma `where` fragment for a scope. Records with no owner stay visible to whoever created them. */
export function crmOwnerWhere(
  scope: CrmRecordScope,
  fields: { owner: string; createdBy: string } = { owner: "ownerUserId", createdBy: "createdByUserId" }
): Record<string, unknown> {
  if (scope.mode === "ALL") return {};
  return {
    OR: [{ [fields.owner]: scope.userId }, { [fields.owner]: null, [fields.createdBy]: scope.userId }],
  };
}

export function isWithinCrmScope(scope: CrmRecordScope, record: { ownerUserId: string | null; createdByUserId: string }): boolean {
  if (scope.mode === "ALL") return true;
  return record.ownerUserId === scope.userId || (record.ownerUserId === null && record.createdByUserId === scope.userId);
}
