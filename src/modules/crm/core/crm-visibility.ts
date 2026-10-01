import type { CrmActor } from "./crm-actor";

/**
 * Which CRM records a user may see. Decision D5 in
 * docs/crm/PHASE_00_ARCHITECTURE_ASSESSMENT.md is still open:
 *   - "ALL": anyone holding crm.view sees every record in their company (today's behaviour)
 *   - "OWN": only records they own (planned for salespeople)
 * Every CRM list/detail query must go through `crmOwnerWhere(scope)` from
 * Phase 02 on, so switching the policy later is a change here, not in every
 * service. Until the decision is made this always returns ALL.
 */
export type CrmRecordScope = { mode: "ALL" } | { mode: "OWN"; userId: string };

export async function getCrmRecordScope(actor: CrmActor): Promise<CrmRecordScope> {
  void actor;
  return { mode: "ALL" };
}

/** Prisma `where` fragment for a record scope. `ownerField` is the model's owner column. */
export function crmOwnerWhere(scope: CrmRecordScope, ownerField = "ownerUserId"): Record<string, string> {
  return scope.mode === "OWN" ? { [ownerField]: scope.userId } : {};
}
