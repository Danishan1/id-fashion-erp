import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { PermissionService } from "@/core/rbac/PermissionService";
import { LotRepository, ProductionOrderRepository } from "./production.repository";

/**
 * Branch check for a production record that carries its own branchId (a
 * Lot or a Production Order). Same "deny as not-found" rule as
 * getLotById/getProductionOrderById: a branch-restricted user is told the
 * record doesn't exist, and a record with no branch of its own is out of
 * scope for them. Unrestricted users (the default) are never affected.
 */
export async function assertProductionBranchScope(
  actor: { userId: string },
  branchId: string | null | undefined,
  notFound: { label: string; id: string }
) {
  const allowed = await PermissionService.getAllowedBranchIds(actor.userId);
  if (allowed !== null && (!branchId || !allowed.has(branchId))) {
    throw new BusinessRuleError("NOT_FOUND", `${notFound.label} not found.`, { id: notFound.id });
  }
}

/** Read-route guard: the lot exists in this company and is in the user's branches. */
export async function assertLotInScope(actor: { companyId: string; userId: string }, lotId: string) {
  const lot = await LotRepository.findAnyById(actor.companyId, lotId);
  if (!lot) throw new BusinessRuleError("NOT_FOUND", "Lot not found.", { id: lotId });
  await assertProductionBranchScope(actor, lot.branchId, { label: "Lot", id: lotId });
  return lot;
}

/** Read-route guard: the production order exists in this company and is in the user's branches. */
export async function assertProductionOrderInScope(actor: { companyId: string; userId: string }, productionOrderId: string) {
  const order = await ProductionOrderRepository.findAnyById(actor.companyId, productionOrderId);
  if (!order) throw new BusinessRuleError("NOT_FOUND", "Production order not found.", { id: productionOrderId });
  await assertProductionBranchScope(actor, order.branchId, { label: "Production order", id: productionOrderId });
  return order;
}
