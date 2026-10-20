import type { Prisma } from "@prisma/client";
import { prisma } from "@/core/db/client";
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

/**
 * Which production records a user may see (P1, 2026-10-20).
 * - ALL: holds `production.view_all` — every record, subject to the usual
 *   branch/stage limits. Managers, supervisors, QC, store etc.
 * - ASSIGNED: `production.view` only (e.g. PRODUCTION_WORKER) — only lots
 *   and job orders the user's own linked Employee is assigned to, and only
 *   their own assignment rows. No linked Employee = nothing.
 * Re-read on every call (no cache), like the branch/stage limits.
 */
export type ProductionRecordScope = { mode: "ALL" } | { mode: "ASSIGNED"; employeeId: string | null };

export async function getProductionRecordScope(userId: string): Promise<ProductionRecordScope> {
  if (await PermissionService.can(userId, "production", "view_all")) return { mode: "ALL" };
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { employeeId: true } });
  return { mode: "ASSIGNED", employeeId: user?.employeeId ?? null };
}

/** An assignment that still counts for visibility — completed work stays visible as history. */
export function ownAssignmentWhere(employeeId: string): Prisma.JobOrderAssignmentWhereInput {
  return { employeeId, status: { not: "CANCELLED" } };
}

/** Matches nothing — used when an assigned-only user has no linked Employee. */
const NO_MATCH = "00000000-0000-0000-0000-000000000000";

/** `where` fragment for job orders an assigned-only user may see. */
export function assignedJobOrderWhere(scope: ProductionRecordScope): Prisma.JobOrderWhereInput {
  if (scope.mode === "ALL") return {};
  if (!scope.employeeId) return { id: NO_MATCH };
  return { assignments: { some: ownAssignmentWhere(scope.employeeId) } };
}

/** `where` fragment for lots an assigned-only user may see. */
export function assignedLotWhere(scope: ProductionRecordScope): Prisma.LotWhereInput {
  if (scope.mode === "ALL") return {};
  if (!scope.employeeId) return { id: NO_MATCH };
  return { jobOrders: { some: assignedJobOrderWhere(scope) } };
}

/** `where` fragment for production orders an assigned-only user may see. */
export function assignedProductionOrderWhere(scope: ProductionRecordScope): Prisma.ProductionOrderWhereInput {
  if (scope.mode === "ALL") return {};
  if (!scope.employeeId) return { id: NO_MATCH };
  return { lots: { some: assignedLotWhere(scope) } };
}

async function isLotAssigned(scope: ProductionRecordScope, lotId: string): Promise<boolean> {
  if (scope.mode === "ALL") return true;
  if (!scope.employeeId) return false;
  const count = await prisma.lot.count({ where: { id: lotId, ...assignedLotWhere(scope) } });
  return count > 0;
}

/** Read guard: the lot exists, is in the user's branches, and (for an
 * assigned-only user) has one of their assignments. Otherwise "not found". */
export async function assertLotInScope(actor: { companyId: string; userId: string }, lotId: string) {
  const lot = await LotRepository.findAnyById(actor.companyId, lotId);
  if (!lot) throw new BusinessRuleError("NOT_FOUND", "Lot not found.", { id: lotId });
  await assertProductionBranchScope(actor, lot.branchId, { label: "Lot", id: lotId });
  const scope = await getProductionRecordScope(actor.userId);
  if (!(await isLotAssigned(scope, lotId))) {
    throw new BusinessRuleError("NOT_FOUND", "Lot not found.", { id: lotId });
  }
  return lot;
}

/** Read guard for a production order — same rules as assertLotInScope. */
export async function assertProductionOrderInScope(actor: { companyId: string; userId: string }, productionOrderId: string) {
  const order = await ProductionOrderRepository.findAnyById(actor.companyId, productionOrderId);
  if (!order) throw new BusinessRuleError("NOT_FOUND", "Production order not found.", { id: productionOrderId });
  await assertProductionBranchScope(actor, order.branchId, { label: "Production order", id: productionOrderId });
  const scope = await getProductionRecordScope(actor.userId);
  if (scope.mode === "ASSIGNED") {
    const visible = scope.employeeId
      ? await prisma.productionOrder.count({ where: { id: productionOrderId, ...assignedProductionOrderWhere(scope) } })
      : 0;
    if (visible === 0) throw new BusinessRuleError("NOT_FOUND", "Production order not found.", { id: productionOrderId });
  }
  return order;
}

/** For pages/APIs an assigned-only user must not use at all (job work,
 * order-level planning numbers): refuses with "not found"-style permission
 * denial so nothing is revealed. */
export async function assertFullProductionView(userId: string) {
  const scope = await getProductionRecordScope(userId);
  if (scope.mode !== "ALL") {
    throw new BusinessRuleError("PERMISSION_DENIED", "You can only see production work assigned to you.", {
      module: "production",
      action: "view_all",
    });
  }
}
