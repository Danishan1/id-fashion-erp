import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { PermissionService } from "@/core/rbac/PermissionService";
import { prisma } from "@/core/db/client";
import { convertUomQuantity, type UomLike } from "@/lib/uom-conversion";
import { LookupRepository } from "@/modules/lookups/lookup.repository";
import { ProductRepository } from "@/modules/products/product.repository";
import { MaterialRequestItemRepository } from "./material-request.repository";
import { issueSubstituteMaterial } from "./material-request.service";
import { MaterialSubstitutionRepository } from "./material-substitution.repository";
import type { ProposeMaterialSubstitutionInput, DecideMaterialSubstitutionInput } from "./material-substitution.schema";

export interface ActorContext {
  companyId: string;
  userId: string;
}

/**
 * Material Substitution (2026-09-24) — a stock-driven, unplanned event
 * (the Effective BOM's own required material isn't available, so an
 * acceptable alternative is issued instead) — deliberately distinct from
 * SalesOrderBomOverride (a deliberate, customer/buyer-driven BOM change).
 * Never modifies the Effective BOM, MaterialRequestItem.materialId, or the
 * Style/Sample's own real material list — the plan stays exactly what it
 * was; this only records what actually got issued and why. Per the user's
 * own explicit decision:
 *   Store/Warehouse User: propose only (PENDING), cannot approve their own.
 *   Authorized Production Manager/Supervisor (holds `production`/`approve`):
 *     may Propose + Approve in one action via `autoApprove`, but the
 *     complete record — original material, substitute, quantity, reason,
 *     user, timestamp — is still always created; nothing is ever bypassed.
 * Approval itself reuses `production`/`approve` (no new RBAC permission),
 * matching decision #5's identical instruction for Additional/Damage
 * Material Request approval, and is self-approval-guarded via
 * PermissionService's existing `resourceContext.createdBy` mechanism for the
 * separate (not-autoApprove) decide action — a Store User's own PENDING
 * proposal can never be approved by that same user as a later, separate
 * call, even if they somehow also held `production`/`approve`.
 */

async function loadLineForSubstitution(actor: ActorContext, materialRequestItemId: string) {
  const line = await MaterialRequestItemRepository.findWithRequestOwner(materialRequestItemId);
  if (!line || line.materialRequest.companyId !== actor.companyId) {
    throw new BusinessRuleError("NOT_FOUND", "Material request line not found.", { id: materialRequestItemId });
  }
  if (["CANCELLED", "CLOSED", "ON_HOLD"].includes(line.materialRequest.status)) {
    throw new BusinessRuleError(
      "INVALID_STATE_TRANSITION",
      `Cannot substitute material for a request in "${line.materialRequest.status}" status.`,
      { id: materialRequestItemId }
    );
  }
  return line;
}

/**
 * Caps a proposed substitution's own quantity — converted to the ORIGINAL
 * line material's base unit, the same dimension `requestedQuantity` is
 * expressed in, matching the spec's own worked example (Green Fabric 100 M
 * capped against a Light Blue Fabric substitute measured the same way, in
 * meters) — against what's genuinely still uncommitted on the line: already-
 * issued quantity PLUS every other PENDING/APPROVED (not yet issued)
 * substitution already sitting against this same line. A genuine hard,
 * race-safe cap belongs at the actual issue step (Phase 6's guarded
 * accumulator, mirroring issueMaterialRequestLine's own); this is the
 * friendly pre-check for the deliberate, human-reviewed propose action.
 */
async function assertSubstitutionQuantityWithinRemaining(
  line: Awaited<ReturnType<typeof MaterialRequestItemRepository.findWithRequestOwner>>,
  substituteQuantity: number,
  substituteUom: UomLike & { name: string; code: string },
  excludeSubstitutionId?: string
) {
  if (!line) return; // narrows for TS — loadLineForSubstitution already guarantees non-null to real callers
  if (!line.material.baseUom) {
    throw new BusinessRuleError(
      "UOM_CONVERSION_UNAVAILABLE",
      `"${line.material.styleName}" has no base unit configured — cannot validate a substitution quantity for it.`,
      { lineId: line.id }
    );
  }

  const baseQuantity = convertUomQuantity(substituteQuantity, substituteUom, line.material.baseUom);
  if (baseQuantity === null) {
    throw new BusinessRuleError(
      "UOM_CONVERSION_UNAVAILABLE",
      `"${substituteUom.name}" has no fixed conversion to "${line.material.styleName}"'s base unit — cannot validate this substitution quantity against the line's requested amount.`,
      { lineId: line.id }
    );
  }

  const others = await MaterialSubstitutionRepository.findActiveForLineQuantityCheck(line.id);
  let alreadyCommitted = Number(line.issuedQuantity);
  for (const other of others) {
    if (other.id === excludeSubstitutionId) continue;
    const otherBase = convertUomQuantity(Number(other.quantity), other.uom, line.material.baseUom);
    if (otherBase !== null) alreadyCommitted += otherBase;
  }

  const remaining = Number(line.requestedQuantity) - alreadyCommitted;
  if (baseQuantity > remaining + 1e-6) {
    throw new BusinessRuleError(
      "OVER_ISSUE_NOT_ALLOWED",
      `Substituting ${substituteQuantity} ${substituteUom.code} would exceed what remains on this line — ${Math.max(0, remaining)} still uncommitted (requested ${line.requestedQuantity}, already issued or committed to another substitution ${alreadyCommitted}).`,
      { lineId: line.id, remaining: Math.max(0, remaining) }
    );
  }
}

/** The full decision history for one line — PENDING/APPROVED/REJECTED alike,
 * never filtered, matching this project's "the audit trail is the point"
 * convention. */
export async function listMaterialSubstitutionsForLine(actor: ActorContext, materialRequestItemId: string) {
  await PermissionService.assert(actor.userId, "inventory", "view");
  await loadLineForSubstitution(actor, materialRequestItemId);
  return MaterialSubstitutionRepository.findManyForLine(materialRequestItemId);
}

export async function proposeMaterialSubstitution(actor: ActorContext, materialRequestItemId: string, input: ProposeMaterialSubstitutionInput) {
  await PermissionService.assert(actor.userId, "inventory", "edit");

  const line = await loadLineForSubstitution(actor, materialRequestItemId);

  const substitute = await ProductRepository.findMaterialById(actor.companyId, input.substituteMaterialId);
  if (!substitute) {
    throw new BusinessRuleError("NOT_FOUND", "The substitute material was not found.", { materialId: input.substituteMaterialId });
  }
  if (substitute.id === line.materialId) {
    throw new BusinessRuleError("VALIDATION_ERROR", "The substitute material must be different from the material this line already requests.", {
      materialId: input.substituteMaterialId,
    });
  }

  const uom = await LookupRepository.unit.findUnique({ where: { id: input.uomId } });
  if (!uom) throw new BusinessRuleError("NOT_FOUND", "Unit of measure not found.", { uomId: input.uomId });

  await assertSubstitutionQuantityWithinRemaining(line, input.quantity, uom);

  let approvalFields: { status: "PENDING" | "APPROVED"; approvedByUserId: string | null; approvedAt: Date | null; approvalRemark: string | null } = {
    status: "PENDING",
    approvedByUserId: null,
    approvedAt: null,
    approvalRemark: null,
  };

  if (input.autoApprove) {
    // The authorized fast path — checked explicitly rather than silently
    // downgrading to PENDING, so a direct API call can't quietly bypass its
    // own authorization gate by just setting autoApprove without the real
    // permission.
    await PermissionService.assert(actor.userId, "production", "approve");
    approvalFields = { status: "APPROVED", approvedByUserId: actor.userId, approvedAt: new Date(), approvalRemark: "Approved at proposal (authorized fast path)." };
  }

  const substitution = await MaterialSubstitutionRepository.create({
    companyId: actor.companyId,
    materialRequestItemId,
    originalMaterialId: line.materialId,
    substituteMaterialId: input.substituteMaterialId,
    quantity: input.quantity,
    uomId: input.uomId,
    reason: input.reason,
    remarks: input.remarks ?? null,
    requestedByUserId: actor.userId,
    ...approvalFields,
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "material_substitutions",
    recordId: substitution.id,
    action: "CREATE",
    newValues: {
      materialRequestItemId,
      originalMaterialId: line.materialId,
      substituteMaterialId: input.substituteMaterialId,
      quantity: input.quantity,
      reason: input.reason,
      status: approvalFields.status,
      autoApproved: input.autoApprove,
    },
  });

  return substitution;
}

async function decideMaterialSubstitution(
  actor: ActorContext,
  substitutionId: string,
  decision: "APPROVED" | "REJECTED",
  input: DecideMaterialSubstitutionInput
) {
  const existing = await MaterialSubstitutionRepository.findById(actor.companyId, substitutionId);
  if (!existing) throw new BusinessRuleError("NOT_FOUND", "Material substitution not found.", { id: substitutionId });

  // Self-approval-guarded — a Store User's own PENDING proposal can never be
  // approved/rejected by that same user as this separate call, matching the
  // user's own "retain the existing self-approval restrictions" instruction.
  await PermissionService.assert(actor.userId, "production", "approve", { createdBy: existing.requestedByUserId });

  if (existing.status !== "PENDING") {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", `This substitution has already been ${existing.status.toLowerCase()}.`, {
      id: substitutionId,
    });
  }

  if (decision === "APPROVED") {
    await assertSubstitutionQuantityWithinRemaining(
      await MaterialRequestItemRepository.findWithRequestOwner(existing.materialRequestItemId),
      Number(existing.quantity),
      existing.uom,
      existing.id
    );
  }

  await prisma.$transaction(async (tx) => {
    const result = await MaterialSubstitutionRepository.decideInTx(tx, substitutionId, {
      status: decision,
      approvedByUserId: actor.userId,
      approvedAt: new Date(),
      approvalRemark: input.approvalRemark ?? null,
    });
    if (result.count === 0) {
      throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This substitution was already decided by someone else — reload and try again.", {
        id: substitutionId,
      });
    }
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "material_substitutions",
    recordId: substitutionId,
    action: "UPDATE",
    oldValues: { status: "PENDING" },
    newValues: { status: decision, approvalRemark: input.approvalRemark ?? null },
  });

  return MaterialSubstitutionRepository.findById(actor.companyId, substitutionId);
}

export async function approveMaterialSubstitution(actor: ActorContext, substitutionId: string, input: DecideMaterialSubstitutionInput) {
  return decideMaterialSubstitution(actor, substitutionId, "APPROVED", input);
}

export async function rejectMaterialSubstitution(actor: ActorContext, substitutionId: string, input: DecideMaterialSubstitutionInput) {
  return decideMaterialSubstitution(actor, substitutionId, "REJECTED", input);
}

/**
 * The authorized Production Manager/Supervisor fast path, literally per
 * decision #3: "Substitute + Approve + Issue in one controlled action" — one
 * user-facing call that still produces the exact same complete record and
 * audit trail as the slower Store User path (propose → wait for approval →
 * issue), just without the intermediate wait. Forces `input.autoApprove`
 * true regardless of what was submitted, so this endpoint's own name is the
 * real authorization signal, not a client-supplied flag — `proposeMaterialSubstitution`
 * still independently re-asserts `production`/`approve` before honoring it.
 * Issuing is a genuinely separate call into material-request.service.ts
 * (which owns the real ledger-writing machinery this needs — guarded
 * accumulator, recordInventoryTransaction, stock-availability check) rather
 * than duplicated here.
 */
export async function proposeApproveAndIssueMaterialSubstitution(
  actor: ActorContext,
  materialRequestItemId: string,
  input: Omit<ProposeMaterialSubstitutionInput, "autoApprove">,
  issueOptions?: { warehouseLocationId?: string | null; issueWarehouseId?: string | null }
) {
  const substitution = await proposeMaterialSubstitution(actor, materialRequestItemId, { ...input, autoApprove: true });
  return issueSubstituteMaterial(actor, substitution.id, issueOptions);
}
