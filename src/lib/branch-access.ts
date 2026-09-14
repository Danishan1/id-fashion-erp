import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { PermissionService } from "@/core/rbac/PermissionService";

/**
 * Shared branch-access enforcement — read side (list/query filtering) and
 * write side (a single record's own branch), both built on
 * PermissionService.getAllowedBranchIds(). Deliberately generic (no
 * per-model knowledge) so it can be reused across every branchId-carrying
 * model as branch enforcement gets rolled out; see RoleBranchAccess's own
 * schema doc comment for the "zero rows = unrestricted" design this is
 * built on.
 */

/**
 * A Prisma `where` fragment to spread alongside a model's own `companyId`
 * filter — `{}` for an unrestricted user (every branch, including records
 * with a null branchId), or `{ branchId: { in: [...] } }` for a restricted
 * one. A restricted user deliberately never sees a null-branchId record —
 * a record with no branch of its own can't be confirmed to be "in scope"
 * for a restriction that only ever lists specific, real branches.
 */
export function branchScopeWhere(allowedBranchIds: Set<string> | null): { branchId?: { in: string[] } } {
  if (allowedBranchIds === null) return {};
  return { branchId: { in: [...allowedBranchIds] } };
}

/**
 * Write-side guard — call before creating/updating a record against a
 * specific branchId (or the actor's own default branch, when a record has
 * no branch of its own yet). A `null` branchId always passes -- there's
 * nothing to restrict access to, matching branchScopeWhere's own
 * unrestricted-only treatment of null-branchId records.
 */
export async function assertBranchAccess(actor: { userId: string }, branchId: string | null | undefined): Promise<void> {
  if (!branchId) return;
  const allowed = await PermissionService.getAllowedBranchIds(actor.userId);
  if (allowed !== null && !allowed.has(branchId)) {
    throw new BusinessRuleError("BRANCH_ACCESS_DENIED", "You do not have access to this branch.", { branchId });
  }
}
