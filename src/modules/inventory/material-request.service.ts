import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { generateDocumentNumber } from "@/core/numbering/DocumentNumberingService";
import { PermissionService } from "@/core/rbac/PermissionService";
import { prisma } from "@/core/db/client";
import type { ListQuery } from "@/lib/list-query";
import { branchScopeWhere } from "@/lib/branch-access";
import { convertUomQuantity } from "@/lib/uom-conversion";
import { todayIsoDate } from "@/lib/date";
import { BomRepository } from "@/modules/bom-mrp/bom.repository";
import { getMaterialRequirements } from "@/modules/bom-mrp/mrp.service";
import { LookupRepository } from "@/modules/lookups/lookup.repository";
import { ProductRepository } from "@/modules/products/product.repository";
import { SalesOrderRepository } from "@/modules/sales-orders/sales-order.repository";
import { SampleMaterialRepository, SampleVersionRepository } from "@/modules/sampling/sample.repository";
import { createPurchaseOrder } from "@/modules/purchasing/purchase-order.service";
import { FabricRollRepository } from "@/modules/purchasing/fabric-roll.repository";
import { WarehouseRepository } from "@/modules/warehouses/warehouse.repository";
import { StockBalanceRepository } from "./inventory.repository";
import { getAvailableQuantity, getAvailableQuantityByDye, recordInventoryTransaction } from "./inventory.service";
import { MaterialRequestItemRepository, MaterialRequestRepository } from "./material-request.repository";
import { MaterialSubstitutionRepository } from "./material-substitution.repository";
import type {
  DecideMaterialRequestApprovalInput,
  MaterialRequestInput,
  MaterialRequestItemInput,
  UpdateMaterialRequestInput,
} from "./material-request.schema";
import { Prisma, MaterialRequestStatus } from "@prisma/client";

export interface ActorContext {
  companyId: string;
  userId: string;
  branchId?: string | null;
}

/**
 * Additional/Damage Material Request approval (2026-09-24, Phase 7) —
 * blocks issuing against a DAMAGE_REPLACEMENT request until it's actually
 * APPROVED. A PRODUCTION_REQUIREMENT request (approvalStatus always null)
 * is never affected — this check is a pure no-op for the ordinary flow.
 */
function assertNotPendingApproval(materialRequest: { requestType: string; approvalStatus: string | null }, id: string) {
  if (materialRequest.requestType === "DAMAGE_REPLACEMENT" && materialRequest.approvalStatus !== "APPROVED") {
    throw new BusinessRuleError(
      "INVALID_STATE_TRANSITION",
      materialRequest.approvalStatus === "REJECTED"
        ? "This additional/damage material request was rejected — nothing can be issued against it."
        : "This additional/damage material request is still pending approval — it must be approved before anything can be issued.",
      { id }
    );
  }
}

function mapLineInput(line: MaterialRequestItemInput) {
  return {
    materialId: line.materialId,
    colorId: line.colorId || null,
    dyeId: line.dyeId || null,
    uomId: line.uomId,
    requestedQuantity: line.requestedQuantity,
    damageReason: line.damageReason || null,
    remarks: line.remarks || null,
  };
}

/**
 * "Available Stock" for a request line — scoped to the line's own dye/shade
 * when possible, since a line pinned to one shade can't actually use stock
 * of a different shade even though the flat material-level total includes
 * it. Only FABRIC materials get FabricRoll rows at all (the only place a
 * shade is tracked per physical unit of stock), so this only narrows for
 * that case; anything else falls back to the flat, material-wide total —
 * the same number as before, not a regression for materials this can't help.
 */
async function getLineAvailableStock(
  companyId: string,
  warehouseId: string,
  line: { materialId: string; dyeId: string | null; material: { materialCategory: string | null } }
): Promise<number> {
  if (line.dyeId && line.material.materialCategory === "FABRIC") {
    return getAvailableQuantityByDye(companyId, line.materialId, warehouseId, line.dyeId);
  }
  return getAvailableQuantity(companyId, line.materialId, warehouseId);
}

/**
 * Rejects at create/edit time if a line's chosen `uomId` has no fixed
 * conversion path to its material's own base UOM — same discipline as
 * Purchase Order's assertItemsHaveConvertibleUom(), catching the mistake
 * immediately instead of failing later at issue time.
 */
async function assertLinesHaveConvertibleUom(companyId: string, lines: MaterialRequestItemInput[]) {
  for (const line of lines) {
    const material = await ProductRepository.findMaterialById(companyId, line.materialId);
    if (!material) throw new BusinessRuleError("NOT_FOUND", "Material not found.", { id: line.materialId });

    if (!material.baseUom) {
      throw new BusinessRuleError(
        "VALIDATION_ERROR",
        `"${material.styleName}" has no base unit configured — set one in Masters → Materials before requesting it.`,
        { materialId: line.materialId }
      );
    }
    if (line.uomId === material.baseUom.id) continue;

    const chosenUom = await LookupRepository.unit.findUnique({ where: { id: line.uomId } });
    if (!chosenUom) throw new BusinessRuleError("NOT_FOUND", "Unit not found.", { id: line.uomId });

    const converted = convertUomQuantity(1, chosenUom, material.baseUom);
    if (converted === null) {
      throw new BusinessRuleError(
        "VALIDATION_ERROR",
        `"${chosenUom.name}" has no fixed conversion to "${material.styleName}"'s base unit ("${material.baseUom.name}") — pick a convertible unit.`,
        { materialId: line.materialId, uomId: line.uomId }
      );
    }
  }
}

interface StatusLine {
  requestedQuantity: Prisma.Decimal | number | string;
  issuedQuantity: Prisma.Decimal | number | string;
  purchaseOrderItems: Array<{
    orderedQuantity: Prisma.Decimal | number | string;
    purchaseOrder: { status: string };
  }>;
}

/** Sum of ordered quantity across a line's PO items, excluding any that
 * belong to a CANCELLED purchase order — a cancelled PO's quantity was
 * never actually going to arrive, so it can't count as "covering" anything. */
function sumActiveOrdered(purchaseOrderItems: StatusLine["purchaseOrderItems"]): number {
  return purchaseOrderItems
    .filter((p) => p.purchaseOrder.status !== "CANCELLED")
    .reduce((sum, p) => sum + Number(p.orderedQuantity), 0);
}

/**
 * A line counts as "fulfilled" only once it has actually been issued from
 * real, physically-received stock — an active Purchase Order covering the
 * shortfall is a commitment, not material in hand, so it deliberately does
 * NOT fulfill a line by itself (direct user feedback, 2026-09-05; an
 * earlier version of this function did count PO coverage as fulfillment —
 * see git history — but that let a request show FULFILLED while the goods
 * were still in transit, before Approve/Send to Supplier/Goods Receipt had
 * even happened). computeRequiresPurchaseAction below is what tells the UI
 * "nothing further to purchase" for exactly this in-transit case, without
 * conflating it with "fulfilled."
 */
function isLineFulfilled(l: StatusLine): boolean {
  return Number(l.issuedQuantity) >= Number(l.requestedQuantity);
}

/**
 * Pure derivation, exported for direct unit testing. The empty-lines guard
 * mirrors the exact lesson already learned twice this project (Purchase
 * Requisition, Buyer Enquiry): without it, an all-cancelled or
 * all-still-pending request would vacuously satisfy "every line is
 * fulfilled" over an empty set and wrongly report FULFILLED.
 */
export function computeMaterialRequestStatus(lines: StatusLine[]): MaterialRequestStatus {
  if (lines.length === 0) return "OPEN";

  const fulfilledCount = lines.filter(isLineFulfilled).length;
  if (fulfilledCount === lines.length) return "FULFILLED";
  if (fulfilledCount > 0) return "PARTIALLY_FULFILLED";
  return "OPEN";
}

/**
 * A separate, freestanding indicator — deliberately NOT folded into
 * MaterialRequestStatus, since a request can simultaneously be e.g.
 * PARTIALLY_FULFILLED (some lines done) AND "requires purchase action" (a
 * different line has a real, un-ordered shortfall) — a mutually-exclusive
 * status enum can't express both facts at once. Surfaced in the UI as a
 * badge, not a status value.
 */
export function computeRequiresPurchaseAction(lines: StatusLine[]): boolean {
  return lines.some((l) => {
    const remaining = Number(l.requestedQuantity) - Number(l.issuedQuantity);
    return remaining - sumActiveOrdered(l.purchaseOrderItems) > 0;
  });
}

interface LineQuantityProjection {
  remainingQuantity: number;
  purchaseOrderedQuantity: number;
  availableToOrderQuantity: number;
}

/** Computed, never stored — see the schema comment on why
 * purchaseReceivedQuantity is the only accumulator actually persisted.
 * `remainingQuantity` deliberately does NOT subtract purchaseOrderedQuantity
 * (that's what distinguishes it from availableToOrderQuantity, and is what
 * makes repeat/partial escalation safe: without the split, a second
 * "Generate PO" pass would re-suggest the full remaining shortfall and
 * double-order the part already on an earlier PO). */
function projectLineQuantities(line: StatusLine): LineQuantityProjection {
  const requested = Number(line.requestedQuantity);
  const issued = Number(line.issuedQuantity);
  const remainingQuantity = Math.max(0, requested - issued);
  const purchaseOrderedQuantity = sumActiveOrdered(line.purchaseOrderItems);
  const availableToOrderQuantity = Math.max(0, remainingQuantity - purchaseOrderedQuantity);
  return { remainingQuantity, purchaseOrderedQuantity, availableToOrderQuantity };
}

/** Never clobbers a manually-set ON_HOLD/CANCELLED/CLOSED status — only
 * recomputes across the OPEN/PARTIALLY_FULFILLED/FULFILLED derived states.
 * Takes the full actor (not just companyId) so a transition landing on
 * FULFILLED can be attributed to someone in its audit entry. */
async function recomputeAndPersistStatus(actor: ActorContext, id: string) {
  const current = await MaterialRequestRepository.findAnyById(actor.companyId, id);
  if (!current) return;
  if (current.status === "ON_HOLD" || current.status === "CANCELLED" || current.status === "CLOSED") return;

  const lines = await MaterialRequestItemRepository.findManyForStatusRecompute(id);
  const nextStatus = computeMaterialRequestStatus(lines);
  if (nextStatus !== current.status) {
    await MaterialRequestRepository.update(id, { status: nextStatus });
    if (nextStatus === "FULFILLED") {
      await writeAuditLog({
        companyId: actor.companyId,
        userId: actor.userId,
        tableName: "material_requests",
        recordId: id,
        action: "UPDATE",
        oldValues: { status: current.status },
        newValues: { status: "FULFILLED" },
      });
    }
  }
}

const CANCEL_TARGETS_BY_STATUS: Record<MaterialRequestStatus, MaterialRequestStatus[]> = {
  OPEN: ["ON_HOLD", "CANCELLED"],
  PARTIALLY_FULFILLED: ["ON_HOLD", "CANCELLED"],
  FULFILLED: ["ON_HOLD"],
  CLOSED: [],
  ON_HOLD: ["CANCELLED"],
  CANCELLED: [],
};

/** Real, not just label-based: blocks cancelling the WHOLE request once any
 * line has actually had stock issued or a shortfall escalated to a Purchase
 * Order — the same "check the real state, not the status label" lesson this
 * project has already learned twice (Sampling's Hold/Resume bug,
 * Purchasing's cancel-from-ON_HOLD bug). Cancel is a request-wide action, so
 * this stays request-level; editing is gated per line instead (see
 * updateMaterialRequestLines/MaterialRequestRepository.countLockedLines). */
async function assertNothingIssuedOrEscalated(materialRequestId: string, action: string) {
  const [issuedCount, linkedCount] = await Promise.all([
    MaterialRequestRepository.countIssuedLines(materialRequestId),
    MaterialRequestRepository.countLinkedPurchaseOrderItems(materialRequestId),
  ]);
  if (issuedCount > 0 || linkedCount > 0) {
    throw new BusinessRuleError(
      "INVALID_STATE_TRANSITION",
      `Cannot ${action} — material has already been issued or a shortfall already escalated to a purchase order.`,
      { issuedCount, linkedCount }
    );
  }
}

const VALID_MATERIAL_REQUEST_STATUSES = new Set<string>(Object.values(MaterialRequestStatus));

export async function listMaterialRequests(actor: { companyId: string; userId: string }, query: ListQuery) {
  const allowedBranchIds = await PermissionService.getAllowedBranchIds(actor.userId);
  const where: Prisma.MaterialRequestWhereInput = {
    companyId: actor.companyId,
    ...branchScopeWhere(allowedBranchIds),
    ...(query.search ? { requestNumber: { contains: query.search, mode: "insensitive" as const } } : {}),
    ...(query.status && VALID_MATERIAL_REQUEST_STATUSES.has(query.status)
      ? { status: query.status as MaterialRequestStatus }
      : {}),
  };

  const [data, totalCount] = await Promise.all([
    MaterialRequestRepository.findMany(where, {
      orderBy: { [query.sortBy]: query.sortOrder },
      skip: query.skip,
      take: query.take,
    }),
    MaterialRequestRepository.count(where),
  ]);

  return { data, totalCount };
}

/** A branch-restricted user gets NOT_FOUND for a request outside their allowed branches — same "deny as not-found" convention used across this app. */
export async function getMaterialRequestById(actor: { companyId: string; userId: string }, id: string) {
  const request = await MaterialRequestRepository.findByIdWithDetails(actor.companyId, id);
  if (!request) throw new BusinessRuleError("NOT_FOUND", "Material request not found.", { id });

  const allowedBranchIds = await PermissionService.getAllowedBranchIds(actor.userId);
  if (allowedBranchIds !== null && (!request.branchId || !allowedBranchIds.has(request.branchId))) {
    throw new BusinessRuleError("NOT_FOUND", "Material request not found.", { id });
  }

  const lines = await Promise.all(
    request.lines.map(async (line) => ({
      ...line,
      ...projectLineQuantities(line),
      availableStockQuantity: await getLineAvailableStock(actor.companyId, request.warehouseId, line),
    }))
  );

  return {
    ...request,
    lines,
    requiresPurchaseAction: computeRequiresPurchaseAction(request.lines),
  };
}

export async function createMaterialRequest(actor: ActorContext, input: MaterialRequestInput) {
  await assertLinesHaveConvertibleUom(actor.companyId, input.lines);

  // A direct, user-chosen link now (the manual create form's own optional
  // Sales Order dropdown, 2026-09-05) — previously this field was only ever
  // set internally by createMaterialRequestFromShortfall(), which already
  // derives it from a company-scoped query, so this check was never
  // reachable before. Same tenant-scope discipline as every other
  // cross-reference in this codebase (see CLAUDE.md's 2026-08-19 sweep).
  if (input.salesOrderId) {
    const order = await SalesOrderRepository.findAnyById(actor.companyId, input.salesOrderId);
    if (!order) throw new BusinessRuleError("NOT_FOUND", "Sales order not found.", { id: input.salesOrderId });
  }

  // Structural guard, not just a validation check: this function never
  // writes to originalMaterialRequestId's own row, so a DAMAGE_REPLACEMENT
  // request can never mutate the original it references — there's simply
  // no code path here that touches it beyond confirming it exists.
  if (input.requestType === "DAMAGE_REPLACEMENT") {
    if (!input.originalMaterialRequestId) {
      throw new BusinessRuleError("VALIDATION_ERROR", "The original request is required for a damage replacement.", {});
    }
    const original = await MaterialRequestRepository.findAnyById(actor.companyId, input.originalMaterialRequestId);
    if (!original) {
      throw new BusinessRuleError("NOT_FOUND", "Original material request not found.", { id: input.originalMaterialRequestId });
    }
  }

  const requestNumber = await generateDocumentNumber({
    companyId: actor.companyId,
    branchId: actor.branchId ?? null,
    documentType: "MATERIAL_REQUEST",
  });

  const request = await MaterialRequestRepository.createWithLines({
    companyId: actor.companyId,
    branchId: actor.branchId || null,
    requestNumber,
    requestType: input.requestType,
    departmentId: input.departmentId || null,
    warehouseId: input.warehouseId,
    requiredDate: input.requiredDate ? new Date(input.requiredDate) : null,
    purpose: input.purpose || null,
    salesOrderId: input.salesOrderId || null,
    productionOrderId: input.productionOrderId || null,
    bomId: input.bomId || null,
    originalMaterialRequestId: input.originalMaterialRequestId || null,
    sampleVersionId: input.sampleVersionId || null,
    remarks: input.remarks || null,
    status: "OPEN",
    requestedByUserId: actor.userId,
    // Additional/Damage Material Request approval (2026-09-24, Phase 7) —
    // only a DAMAGE_REPLACEMENT request ever gets a real approval gate;
    // PRODUCTION_REQUIREMENT keeps approvalStatus permanently null, its
    // ordinary no-approval-needed flow completely unchanged. See
    // approveMaterialRequest/rejectMaterialRequest and the issue-time gate
    // below.
    approvalStatus: input.requestType === "DAMAGE_REPLACEMENT" ? "PENDING" : null,
    lines: { create: input.lines.map(mapLineInput) },
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "material_requests",
    recordId: request.id,
    action: "CREATE",
    newValues: { requestNumber: request.requestNumber, requestType: input.requestType, salesOrderId: input.salesOrderId || null },
  });

  return request;
}

/**
 * Additional/Damage Material Request approval (2026-09-24, Phase 7) — per
 * decision #5, reuses the existing `production`/`approve` permission (no new
 * RBAC action), self-approval-guarded via PermissionService's own
 * `resourceContext.createdBy` mechanism — the same requester can never
 * approve their own damage/additional request, matching every other
 * approval checkpoint in this codebase. Only ever reachable for a request
 * genuinely awaiting one (approvalStatus === "PENDING", which only a
 * DAMAGE_REPLACEMENT request is ever created with) — a PRODUCTION_REQUIREMENT
 * request has no approvalStatus at all and this function correctly refuses
 * it as "nothing to decide."
 */
async function decideMaterialRequestApproval(
  actor: ActorContext,
  id: string,
  decision: "APPROVED" | "REJECTED",
  input: DecideMaterialRequestApprovalInput
) {
  const existing = await MaterialRequestRepository.findAnyById(actor.companyId, id);
  if (!existing) throw new BusinessRuleError("NOT_FOUND", "Material request not found.", { id });

  await PermissionService.assert(actor.userId, "production", "approve", { createdBy: existing.requestedByUserId });

  if (existing.approvalStatus === null) {
    throw new BusinessRuleError("VALIDATION_ERROR", "This request has no approval gate — only an additional/damage material request needs one.", {
      id,
    });
  }
  if (existing.approvalStatus !== "PENDING") {
    throw new BusinessRuleError(
      "INVALID_STATE_TRANSITION",
      `This request has already been ${existing.approvalStatus.toLowerCase()}.`,
      { id }
    );
  }

  const result = await MaterialRequestRepository.decideApproval(id, {
    approvalStatus: decision,
    approvedByUserId: actor.userId,
    approvedAt: new Date(),
    approvalRemark: input.approvalRemark ?? null,
  });
  if (result.count === 0) {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This request was already decided by someone else — reload and try again.", { id });
  }

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "material_requests",
    recordId: id,
    action: "UPDATE",
    oldValues: { approvalStatus: "PENDING" },
    newValues: { approvalStatus: decision, approvalRemark: input.approvalRemark ?? null },
  });

  return MaterialRequestRepository.findAnyById(actor.companyId, id);
}

export async function approveMaterialRequest(actor: ActorContext, id: string, input: DecideMaterialRequestApprovalInput) {
  return decideMaterialRequestApproval(actor, id, "APPROVED", input);
}

export async function rejectMaterialRequest(actor: ActorContext, id: string, input: DecideMaterialRequestApprovalInput) {
  return decideMaterialRequestApproval(actor, id, "REJECTED", input);
}

/** Open (not CANCELLED/CLOSED) requests already carrying a real remaining
 * requirement for the same Sales Order + any of the given materials —
 * proactive advisory data for the BOM/MRP page, and the same check
 * createMaterialRequestFromShortfall enforces (with an override) before
 * actually creating a request. */
export async function findDuplicateMaterialRequests(companyId: string, salesOrderId: string, materialIds: string[]) {
  const result: Record<
    string,
    Array<{
      requestId: string;
      requestNumber: string;
      remainingQuantity: number;
      warehouseName: string;
      // Real stock for this material at the *existing* request's own
      // warehouse — MRP's own "Available" column is a company-wide sum
      // across every warehouse, which can read as plenty of stock while the
      // material genuinely isn't anywhere near this specific open request
      // (e.g. it arrived at a different warehouse). Surfaced here so the
      // duplicate warning doesn't imply "already covered" when it isn't.
      availableAtWarehouse: number;
    }>
  > = {};

  for (const materialId of materialIds) {
    const lines = await MaterialRequestRepository.findOpenDuplicateLines(companyId, salesOrderId, materialId);
    const real = lines
      .map((l) => ({
        requestId: l.materialRequest.id,
        requestNumber: l.materialRequest.requestNumber,
        remainingQuantity: Number(l.requestedQuantity) - Number(l.issuedQuantity),
        warehouseId: l.materialRequest.warehouseId,
        warehouseName: l.materialRequest.warehouse.name,
      }))
      .filter((l) => l.remainingQuantity > 0);
    if (real.length === 0) continue;

    result[materialId] = await Promise.all(
      real.map(async ({ warehouseId, ...entry }) => ({
        ...entry,
        availableAtWarehouse: await getAvailableQuantity(companyId, materialId, warehouseId),
      }))
    );
  }

  return result;
}

/**
 * Powers the "Generate Material Request" button on BOM/MRP's requirements
 * page — recomputes getMaterialRequirements() server-side rather than
 * trusting client-sent needed/available/shortfall numbers. bomId is
 * populated only when every selected shortfall row traces to exactly one
 * style (a request aggregated across several styles has no single correct
 * BOM to point at — salesOrderId remains the primary traceability field).
 */
export async function createMaterialRequestFromShortfall(
  actor: ActorContext,
  input: { salesOrderId: string; warehouseId: string; materialIds: string[]; overrideDuplicateCheck?: boolean }
) {
  const requirements = await getMaterialRequirements(actor.companyId, input.salesOrderId);
  let selected = requirements.materials.filter((m) => input.materialIds.includes(m.materialId) && m.shortfallQuantity > 0);
  if (selected.length === 0) {
    throw new BusinessRuleError("VALIDATION_ERROR", "None of the selected materials have a shortfall to request.", {
      materialIds: input.materialIds,
    });
  }

  const duplicates = await findDuplicateMaterialRequests(
    actor.companyId,
    input.salesOrderId,
    selected.map((m) => m.materialId)
  );

  if (Object.keys(duplicates).length > 0) {
    if (!input.overrideDuplicateCheck) {
      throw new BusinessRuleError(
        "DUPLICATE_MATERIAL_REQUEST_EXISTS",
        "An open Material Request already exists for one or more of these materials on this Sales Order.",
        { duplicates }
      );
    }

    // Overriding must never let the combined requested quantity across every
    // open Material Request for this material+order exceed the real MRP
    // shortfall — two duplicate MRs each requesting the FULL shortfall (e.g.
    // one at a warehouse with no stock, a second raised later at a warehouse
    // that does have it) could otherwise both be issued in full, pulling
    // double the material the order actually needs off the shelf. Net the
    // new request down to whatever's genuinely still unrequested instead.
    selected = selected
      .map((m) => {
        const alreadyOpenQuantity = (duplicates[m.materialId] ?? []).reduce((sum, d) => sum + d.remainingQuantity, 0);
        return { ...m, shortfallQuantity: Math.max(0, m.shortfallQuantity - alreadyOpenQuantity) };
      })
      .filter((m) => m.shortfallQuantity > 0);

    if (selected.length === 0) {
      throw new BusinessRuleError(
        "VALIDATION_ERROR",
        "The full shortfall for the selected materials is already covered by existing open Material Requests — nothing further to raise.",
        { materialIds: input.materialIds }
      );
    }
  }

  const contributingProductIds = new Set(selected.flatMap((m) => m.contributingStyles.map((s) => s.productId)));
  let bomId: string | undefined;
  if (contributingProductIds.size === 1) {
    const bom = await BomRepository.findByProductId(actor.companyId, [...contributingProductIds][0]);
    bomId = bom?.id;
  }

  return createMaterialRequest(actor, {
    requestType: "PRODUCTION_REQUIREMENT",
    warehouseId: input.warehouseId,
    salesOrderId: input.salesOrderId,
    bomId,
    lines: selected.map((m) => ({
      materialId: m.materialId,
      uomId: m.uomId,
      requestedQuantity: m.shortfallQuantity,
    })),
  });
}

/** Not-CANCELLED/CLOSED requests already generated from this exact Sample
 * Version — proactive advisory data for Sampling's own "Generate Material
 * Request" button, and the same check createMaterialRequestFromSampleVersion
 * enforces (with an override) before actually creating a request. */
export async function findMaterialRequestsBySampleVersion(companyId: string, sampleVersionId: string) {
  return MaterialRequestRepository.findOpenBySampleVersion(companyId, sampleVersionId);
}

/**
 * Powers the "Generate Material Request" action on a Sample Version's own
 * materials list in Sampling — the raw material selected during
 * development genuinely gets used/consumed for the physical sample, so it
 * goes through the exact same real Material Request -> Inventory-checks-
 * stock -> Issue flow as every other requirement in this app, not a
 * separate mechanism. Every SampleMaterial line on the version becomes one
 * request line (never a selected subset — a version's material list is
 * already a small, deliberately-curated set, unlike BOM/MRP's shortfall
 * rows); a line with no uomId of its own falls back to its material's real
 * base unit, matching what the Add Material UI already defaults new lines
 * to.
 */
export async function createMaterialRequestFromSampleVersion(
  actor: ActorContext,
  input: { sampleVersionId: string; warehouseId: string; overrideDuplicateCheck?: boolean }
) {
  const version = await SampleVersionRepository.findWithRequestOwner(input.sampleVersionId);
  if (!version || version.sampleRequest.companyId !== actor.companyId) {
    throw new BusinessRuleError("NOT_FOUND", "Sample version not found.", { id: input.sampleVersionId });
  }

  const materials = await SampleMaterialRepository.findByVersionIdForMaterialRequest(input.sampleVersionId);
  if (materials.length === 0) {
    throw new BusinessRuleError("VALIDATION_ERROR", "This sample version has no materials to request.", {
      sampleVersionId: input.sampleVersionId,
    });
  }

  if (!input.overrideDuplicateCheck) {
    const existing = await findMaterialRequestsBySampleVersion(actor.companyId, input.sampleVersionId);
    if (existing.length > 0) {
      throw new BusinessRuleError(
        "DUPLICATE_MATERIAL_REQUEST_EXISTS",
        `A Material Request already exists for this sample version (${existing.map((r) => r.requestNumber).join(", ")}).`,
        { existing }
      );
    }
  }

  const lines = materials.map((m) => {
    const uomId = m.uomId ?? m.material.baseUomId;
    if (!uomId) {
      throw new BusinessRuleError(
        "VALIDATION_ERROR",
        `"${m.material.styleName}" has no unit set on this material line and no base unit configured for it — set one before generating a Material Request.`,
        { sampleMaterialId: m.id }
      );
    }
    return {
      materialId: m.materialId,
      colorId: m.colorId ?? undefined,
      dyeId: m.dyeId ?? undefined,
      uomId,
      requestedQuantity: Number(m.plannedQuantity),
    };
  });

  return createMaterialRequest(actor, {
    requestType: "SAMPLING_REQUIREMENT",
    warehouseId: input.warehouseId,
    sampleVersionId: input.sampleVersionId,
    lines,
  });
}

/**
 * Line-level replace, not request-level: a line that's already had real
 * stock issued or a shortfall escalated to a Purchase Order is locked and
 * preserved untouched (see replaceLines/UNLOCKED_LINE_WHERE); every other
 * line on the request stays freely editable — material, color, dye, unit,
 * quantity, remarks — regardless of what's happened on a sibling line.
 * `input.lines` represents the desired FINAL state of just the unlocked
 * portion (the client never sends locked lines back at all), so this is
 * still a full replace, just scoped to a subset instead of the whole
 * request. No new "who can do this" concept either — the existing
 * `inventory`/`edit` permission already covers the requester, whoever
 * issues stock, and an admin uniformly (see the route).
 */
export async function updateMaterialRequestLines(actor: ActorContext, id: string, input: UpdateMaterialRequestInput) {
  const existing = await MaterialRequestRepository.findAnyById(actor.companyId, id);
  if (!existing) throw new BusinessRuleError("NOT_FOUND", "Material request not found.", { id });

  if (existing.status === "CANCELLED" || existing.status === "CLOSED") {
    throw new BusinessRuleError(
      "INVALID_STATE_TRANSITION",
      `Cannot edit a material request in "${existing.status}" status.`,
      { currentStatus: existing.status }
    );
  }

  // The only request-level check left: don't let an edit leave the request
  // with zero lines total once its locked lines (never part of `input.lines`
  // at all) are counted back in.
  const lockedLineCount = await MaterialRequestRepository.countLockedLines(id);
  if (lockedLineCount + input.lines.length === 0) {
    throw new BusinessRuleError("VALIDATION_ERROR", "A material request must have at least one line item.", {});
  }

  await assertLinesHaveConvertibleUom(actor.companyId, input.lines);

  const updated = await MaterialRequestRepository.replaceLines(
    id,
    {
      requestType: input.requestType,
      departmentId: input.departmentId || null,
      warehouseId: input.warehouseId,
      requiredDate: input.requiredDate ? new Date(input.requiredDate) : null,
      purpose: input.purpose || null,
      salesOrderId: input.salesOrderId || null,
      productionOrderId: input.productionOrderId || null,
      bomId: input.bomId || null,
      originalMaterialRequestId: input.originalMaterialRequestId || null,
      sampleVersionId: input.sampleVersionId || null,
      remarks: input.remarks || null,
    },
    input.lines.map(mapLineInput)
  );

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "material_requests",
    recordId: id,
    action: "UPDATE",
    newValues: { lineCount: updated.lines.length },
  });

  return updated;
}

/**
 * The "Inventory checks stock" step from the business flow — no approval
 * gate, an inventory/warehouse user directly issues whatever is available.
 * Two independent caps apply: cannot issue more than was requested (guarded
 * accumulator, atomic against concurrent issues) and cannot issue more than
 * is actually on hand at the request's warehouse (checked before the guard,
 * in the material's base UOM since StockBalance is always base-UOM).
 */
export async function issueMaterialRequestLine(
  actor: ActorContext,
  lineId: string,
  issueQuantity: number,
  warehouseLocationId?: string | null,
  fabricRollId?: string | null,
  // Manual "issue extra" override (2026-09-15, explicit user request;
  // widened to every request type 2026-09-22, also explicit — real
  // production floors, not just sample-making, routinely need slightly more
  // material than the planned/BOM figure, e.g. for wastage). A reason is
  // required whenever the requested amount genuinely exceeds what remains,
  // so it's visible later via the audit log (no new schema column, matching
  // the "reason lives in the audit trail" precedent already used elsewhere,
  // e.g. Material Request's own "Purchase Quantity Changed" entry). Physical
  // stock is never overridable by this — see the guarded increment below.
  extraReason?: string,
  // An explicit alternate warehouse to physically issue from (2026-09-16,
  // explicit user request) — the Issue modal's own "Change Warehouse"
  // picker, offered only when the request's own warehouse has nothing and
  // populated only from warehouses getOtherWarehouseStockForLine already
  // confirmed have real stock. Defaults to the request's own warehouse when
  // omitted, matching every existing caller unchanged. Never separately
  // re-validated as belonging to this company here — recordInventoryTransaction's
  // own chokepoint check already does that before ever writing to it.
  issueWarehouseId?: string | null
) {
  const line = await MaterialRequestItemRepository.findWithRequestOwner(lineId);
  if (!line || line.materialRequest.companyId !== actor.companyId) {
    throw new BusinessRuleError("NOT_FOUND", "Material request line not found.", { id: lineId });
  }
  if (line.materialRequest.status === "CANCELLED" || line.materialRequest.status === "CLOSED" || line.materialRequest.status === "ON_HOLD") {
    throw new BusinessRuleError(
      "INVALID_STATE_TRANSITION",
      `Cannot issue material for a request in "${line.materialRequest.status}" status.`,
      { id: lineId }
    );
  }
  assertNotPendingApproval(line.materialRequest, lineId);

  const remaining = Number(line.requestedQuantity) - Number(line.issuedQuantity);
  const overRequested = Math.max(0, issueQuantity - remaining);
  if (overRequested > 0 && !extraReason?.trim()) {
    throw new BusinessRuleError(
      "VALIDATION_ERROR",
      `Issuing ${issueQuantity} is ${overRequested} more than the ${remaining} remaining on this line — a reason is required to issue extra.`,
      { remaining, issueQuantity }
    );
  }
  // The guarded increment's own cap widens by exactly the approved extra
  // amount (0 for every non-override issue, unchanged from before) — never a
  // blanket unlimited allowance, and still race-safe under concurrent issues
  // against the same line.
  const issueCap = Number(line.requestedQuantity) + overRequested;

  if (!line.material.baseUom) {
    throw new BusinessRuleError(
      "UOM_CONVERSION_UNAVAILABLE",
      `"${line.material.styleName}" has no base unit configured — cannot record stock for it.`,
      { lineId }
    );
  }
  const baseQuantity = convertUomQuantity(issueQuantity, line.uom, line.material.baseUom);
  if (baseQuantity === null) {
    throw new BusinessRuleError(
      "UOM_CONVERSION_UNAVAILABLE",
      `"${line.uom.name}" has no fixed conversion to "${line.material.styleName}"'s base unit.`,
      { lineId }
    );
  }

  const effectiveWarehouseId = issueWarehouseId || line.materialRequest.warehouseId;

  // Issuing against one specific physical roll — the color/shade actually
  // being handed out — is a genuinely different, more precise check than
  // the material-wide fallback below: the roll's own remainingQuantity is
  // both the availability ceiling AND, unlike the flat StockBalance path,
  // the thing this issue must actually decrement (see guardedDecrementRemaining
  // below), since nothing else in this function ever touches FabricRoll.
  let roll: Awaited<ReturnType<typeof FabricRollRepository.findByIdWithContext>> = null;
  if (fabricRollId) {
    roll = await FabricRollRepository.findByIdWithContext(actor.companyId, fabricRollId);
    if (
      !roll ||
      roll.status !== "IN_STOCK" ||
      roll.goodsReceiptItem.productId !== line.materialId ||
      roll.goodsReceiptItem.warehouseId !== effectiveWarehouseId
    ) {
      throw new BusinessRuleError("NOT_FOUND", "The selected fabric roll is not available for this material at this warehouse.", {
        fabricRollId,
      });
    }
    // The roll's own remainingQuantity and the real StockBalance ledger can
    // drift out of sync (confirmed live on real data — a roll left over
    // from before every issue kept rolls in sync can still show more
    // "remaining" than the warehouse's actual balance). Cap against
    // whichever is smaller so this friendly pre-check can never wave
    // through a quantity the ledger's own floor guard would reject anyway —
    // that guard is the real backstop, this is just a cleaner error. Uses
    // the plain flat StockBalance total (getAvailableQuantity), never the
    // dye-scoped getLineAvailableStock — that sums FabricRoll too, so it
    // carries the exact same drift risk as the roll itself and wouldn't
    // actually reflect what the ledger guard checks against.
    const flatAvailable = await getAvailableQuantity(actor.companyId, line.materialId, effectiveWarehouseId);
    const rollAvailable = Math.min(Number(roll.remainingQuantity), flatAvailable);
    if (baseQuantity > rollAvailable) {
      throw new BusinessRuleError(
        "INSUFFICIENT_RAW_MATERIAL_STOCK",
        `Unable to issue ${issueQuantity} from this roll — only ${rollAvailable} remains available. Available: ${rollAvailable}, Requested: ${baseQuantity}.`,
        { available: rollAvailable, requested: baseQuantity }
      );
    }
  } else {
    const available = await getLineAvailableStock(actor.companyId, effectiveWarehouseId, line);
    if (baseQuantity > available) {
      throw new BusinessRuleError(
        "INSUFFICIENT_RAW_MATERIAL_STOCK",
        `Unable to issue ${issueQuantity} of "${line.material.styleName}" — only ${available} available at this warehouse. Available: ${available}, Requested: ${baseQuantity}.`,
        { available, requested: baseQuantity }
      );
    }
  }

  await prisma.$transaction(async (tx) => {
    const result = await MaterialRequestItemRepository.guardedIncrementIssued(
      tx,
      lineId,
      issueCap,
      issueQuantity,
      warehouseLocationId || null
    );
    if (result.count === 0) {
      throw new BusinessRuleError(
        "OVER_ISSUE_NOT_ALLOWED",
        "This line was issued by someone else at the same time — reload and try again.",
        { lineId }
      );
    }

    await recordInventoryTransaction(tx, actor, {
      productId: line.materialId,
      warehouseId: effectiveWarehouseId,
      transactionType: "MATERIAL_ISSUE",
      quantity: -baseQuantity,
      referenceModule: "MATERIAL_REQUEST",
      referenceRecordId: lineId,
      warehouseLocationId: warehouseLocationId || null,
      fabricRollId: roll?.id || null,
    });

    if (roll) {
      const guard = await FabricRollRepository.guardedDecrementRemaining(tx, roll.id, baseQuantity);
      if (guard.count === 0) {
        throw new BusinessRuleError(
          "INSUFFICIENT_RAW_MATERIAL_STOCK",
          "This roll was issued from by someone else at the same time — reload and try again.",
          { fabricRollId: roll.id }
        );
      }
    }
  });

  await recomputeAndPersistStatus(actor, line.materialRequest.id);

  // Only resolved/recorded when it actually deviates from the request's own
  // stated warehouse — matches this project's "Purchase Quantity Changed"
  // audit precedent for a deliberate deviation from the plan. Stores the
  // real name (not just the id) so the Timeline can show "from X" without a
  // second lookup — the same "store a readable snapshot" convention every
  // other audit entry on this timeline already follows.
  let issuedFromWarehouseName: string | null = null;
  if (effectiveWarehouseId !== line.materialRequest.warehouseId) {
    const [altWarehouse] = await WarehouseRepository.findMany({ id: effectiveWarehouseId }, {});
    issuedFromWarehouseName = altWarehouse?.name ?? null;
  }

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "material_request_items",
    recordId: lineId,
    action: "UPDATE",
    newValues: {
      issuedQuantity: issueQuantity,
      // The line's own chosen unit (e.g. "KG") — stored alongside the bare
      // number so the Timeline can show "3.5 KG", not just "3.5".
      uomCode: line.uom.code,
      ...(overRequested > 0 ? { extraQuantity: overRequested, extraReason } : {}),
      ...(issuedFromWarehouseName
        ? { issuedFromWarehouseId: effectiveWarehouseId, issuedFromWarehouseName }
        : {}),
    },
  });

  return MaterialRequestItemRepository.findById(lineId);
}

/**
 * Material Substitution — inventory issue integration (2026-09-24, Phase 6).
 * Physically issues an already-APPROVED MaterialSubstitution's own quantity
 * of the SUBSTITUTE material — never the original — the direct fix for the
 * spec's own worked example ("If Light Blue was physically issued:
 * InventoryTransaction.productId = Light Blue. Never deduct Green stock just
 * because the Effective BOM originally required Green."). Mirrors
 * issueMaterialRequestLine's own shape (guarded accumulator + ledger write
 * inside one transaction, status recompute + audit log after) but posts
 * against `substitution.substituteMaterialId`, converted to THAT material's
 * own base UOM — while the line's `issuedQuantity` accumulator (still
 * expressed in the ORIGINAL material's own dimension, matching
 * `requestedQuantity`) increments by the substitution's own quantity
 * converted to the ORIGINAL material's base UOM instead, so "how much of
 * this line's real requirement has been fulfilled" stays one honest number
 * regardless of which material(s) actually fulfilled it.
 *
 * Deliberately one atomic issue per APPROVED substitution row (not
 * incremental/partial like the plain original-material issue path) —
 * `MaterialSubstitution.inventoryTransactionId` is a single nullable
 * pointer, not a list, by design: a further substitution need against the
 * same line is a SEPARATE MaterialSubstitution proposal (the "partial and
 * multiple substitution" case — several distinct rows, each its own single
 * issue), never a second issue against one row.
 */
export async function issueSubstituteMaterial(
  actor: ActorContext,
  substitutionId: string,
  options?: { warehouseLocationId?: string | null; issueWarehouseId?: string | null }
) {
  await PermissionService.assert(actor.userId, "material_request", "edit");

  const substitution = await MaterialSubstitutionRepository.findById(actor.companyId, substitutionId);
  if (!substitution) throw new BusinessRuleError("NOT_FOUND", "Material substitution not found.", { id: substitutionId });
  if (substitution.status !== "APPROVED") {
    throw new BusinessRuleError(
      "INVALID_STATE_TRANSITION",
      `Only an APPROVED substitution can be issued — this one is "${substitution.status}".`,
      { id: substitutionId }
    );
  }
  if (substitution.inventoryTransactionId) {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This substitution has already been issued.", { id: substitutionId });
  }

  const line = await MaterialRequestItemRepository.findWithRequestOwner(substitution.materialRequestItemId);
  if (!line || line.materialRequest.companyId !== actor.companyId) {
    throw new BusinessRuleError("NOT_FOUND", "Material request line not found.", { id: substitution.materialRequestItemId });
  }
  if (["CANCELLED", "CLOSED", "ON_HOLD"].includes(line.materialRequest.status)) {
    throw new BusinessRuleError(
      "INVALID_STATE_TRANSITION",
      `Cannot issue material for a request in "${line.materialRequest.status}" status.`,
      { id: substitution.materialRequestItemId }
    );
  }
  assertNotPendingApproval(line.materialRequest, substitution.materialRequestItemId);
  if (!line.material.baseUom) {
    throw new BusinessRuleError(
      "UOM_CONVERSION_UNAVAILABLE",
      `"${line.material.styleName}" has no base unit configured — cannot record stock for it.`,
      { id: substitution.materialRequestItemId }
    );
  }

  const substituteMaterial = await ProductRepository.findMaterialById(actor.companyId, substitution.substituteMaterialId);
  if (!substituteMaterial || !substituteMaterial.baseUom) {
    throw new BusinessRuleError(
      "UOM_CONVERSION_UNAVAILABLE",
      `"${substitution.substituteMaterial.styleName}" has no base unit configured — cannot record stock for it.`,
      { id: substitutionId }
    );
  }

  const substituteQuantity = Number(substitution.quantity);

  // What the LINE's own accumulator (issuedQuantity, expressed in the
  // original material's dimension) advances by.
  const originalBaseQuantity = convertUomQuantity(substituteQuantity, substitution.uom, line.material.baseUom);
  if (originalBaseQuantity === null) {
    throw new BusinessRuleError(
      "UOM_CONVERSION_UNAVAILABLE",
      `"${substitution.uom.name}" has no fixed conversion to "${line.material.styleName}"'s base unit.`,
      { id: substitutionId }
    );
  }

  // What actually gets posted to the ledger — the substitute material's own
  // real stock movement, in ITS OWN base unit.
  const substituteBaseQuantity = convertUomQuantity(substituteQuantity, substitution.uom, substituteMaterial.baseUom);
  if (substituteBaseQuantity === null) {
    throw new BusinessRuleError(
      "UOM_CONVERSION_UNAVAILABLE",
      `"${substitution.uom.name}" has no fixed conversion to "${substituteMaterial.styleName}"'s base unit.`,
      { id: substitutionId }
    );
  }

  const effectiveWarehouseId = options?.issueWarehouseId || line.materialRequest.warehouseId;

  const available = await getAvailableQuantity(actor.companyId, substitution.substituteMaterialId, effectiveWarehouseId);
  if (substituteBaseQuantity > available) {
    throw new BusinessRuleError(
      "INSUFFICIENT_RAW_MATERIAL_STOCK",
      `Unable to issue ${substituteQuantity} of "${substituteMaterial.styleName}" — only ${available} available at this warehouse. Available: ${available}, Requested: ${substituteBaseQuantity}.`,
      { available, requested: substituteBaseQuantity }
    );
  }

  await prisma.$transaction(async (tx) => {
    const result = await MaterialRequestItemRepository.guardedIncrementIssued(
      tx,
      line.id,
      Number(line.requestedQuantity),
      originalBaseQuantity,
      options?.warehouseLocationId
    );
    if (result.count === 0) {
      throw new BusinessRuleError(
        "OVER_ISSUE_NOT_ALLOWED",
        "This line was issued by someone else at the same time — reload and try again.",
        { id: line.id }
      );
    }

    const transaction = await recordInventoryTransaction(tx, actor, {
      productId: substitution.substituteMaterialId,
      warehouseId: effectiveWarehouseId,
      transactionType: "MATERIAL_ISSUE",
      quantity: -substituteBaseQuantity,
      referenceModule: "MATERIAL_REQUEST",
      referenceRecordId: line.id,
      warehouseLocationId: options?.warehouseLocationId ?? null,
    });

    await MaterialSubstitutionRepository.setInventoryTransactionInTx(tx, substitutionId, transaction.id);
  });

  await recomputeAndPersistStatus(actor, line.materialRequest.id);

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "material_substitutions",
    recordId: substitutionId,
    action: "UPDATE",
    newValues: {
      issued: true,
      substituteMaterialId: substitution.substituteMaterialId,
      quantity: substituteQuantity,
      uomCode: substitution.uom.code,
    },
  });

  return MaterialSubstitutionRepository.findById(actor.companyId, substitutionId);
}

/**
 * The color/shade/GSM/composition-wise breakdown for a line's own material
 * at a given warehouse — one row per physically in-stock FabricRoll, each
 * carrying its own real remaining quantity. Feeds the Issue modal's "which
 * color am I actually handing out" picker; empty for a non-FABRIC material
 * (nothing tracks shade at that granularity for it) or a FABRIC material
 * with no roll-level stock at all, in which case the UI simply falls back to
 * the existing flat-total Issue flow. `warehouseId` defaults to the
 * request's own warehouse — the Issue modal's own "Change Warehouse" picker
 * (2026-09-16) re-calls this with an alternate warehouse once one is chosen,
 * so the roll list always reflects wherever is actually about to be
 * decremented, not just the request's stated intent.
 */
export async function getAvailableRollsForLine(actor: ActorContext, lineId: string, warehouseId?: string) {
  const line = await MaterialRequestItemRepository.findWithRequestOwner(lineId);
  if (!line || line.materialRequest.companyId !== actor.companyId) {
    throw new BusinessRuleError("NOT_FOUND", "Material request line not found.", { id: lineId });
  }

  const rolls = await FabricRollRepository.findAvailableForMaterial(
    actor.companyId,
    line.materialId,
    warehouseId || line.materialRequest.warehouseId
  );

  return rolls.map((roll) => ({
    id: roll.id,
    rollNumber: roll.rollNumber,
    remainingQuantity: roll.remainingQuantity,
    dye: roll.dye,
    gsm: roll.gsm,
    composition: roll.composition,
  }));
}

/**
 * Where this line's material genuinely has real stock, at every warehouse
 * OTHER than the request's own — a flat total per warehouse, plus a
 * color/shade-wise roll breakdown for a FABRIC material. Surfaced on a line
 * whose own "Available Stock" reads 0, so a merchandiser isn't left
 * guessing whether the material simply doesn't exist anywhere, or is
 * genuinely sitting at a different warehouse (the same warehouse-mismatch
 * story a received-into-the-wrong-warehouse Goods Receipt has produced more
 * than once) — from here a user can jump straight into a Stock Transfer to
 * correct it, rather than hunting through Inventory reports by hand.
 */
export async function getOtherWarehouseStockForLine(actor: ActorContext, lineId: string) {
  const line = await MaterialRequestItemRepository.findWithRequestOwner(lineId);
  if (!line || line.materialRequest.companyId !== actor.companyId) {
    throw new BusinessRuleError("NOT_FOUND", "Material request line not found.", { id: lineId });
  }

  const requestWarehouseId = line.materialRequest.warehouseId;
  const isFabric = line.material.materialCategory === "FABRIC";

  const balances = await StockBalanceRepository.findMany(
    { companyId: actor.companyId, productId: line.materialId, warehouseId: { not: requestWarehouseId }, quantityOnHand: { gt: 0 } },
    {}
  );
  // findMany's own generic `args` spread makes Prisma's return-type
  // inference fall back to StockBalance's bare scalar columns (no include),
  // so the warehouse name is resolved via a small separate lookup instead of
  // fighting that inference — same low-risk workaround already used
  // elsewhere in this codebase for a generic repository wrapper.
  const warehouses = await WarehouseRepository.findMany({ id: { in: balances.map((b) => b.warehouseId) } }, {});
  const warehouseNameById = new Map(warehouses.map((w) => [w.id, w.name]));

  const rollsByWarehouse = new Map<
    string,
    Array<{
      id: string;
      rollNumber: string;
      remainingQuantity: number;
      dye: { name: string; pantone: string | null } | null;
      gsm: { name: string } | null;
      composition: { name: string } | null;
    }>
  >();
  if (isFabric) {
    const rolls = await FabricRollRepository.findAvailableAcrossWarehousesForMaterial(actor.companyId, line.materialId);
    for (const roll of rolls) {
      const warehouseId = roll.goodsReceiptItem.warehouseId;
      if (warehouseId === requestWarehouseId) continue;
      const bucket = rollsByWarehouse.get(warehouseId) ?? [];
      bucket.push({
        id: roll.id,
        rollNumber: roll.rollNumber,
        remainingQuantity: Number(roll.remainingQuantity),
        dye: roll.dye ? { name: roll.dye.name, pantone: roll.dye.pantone } : null,
        gsm: roll.gsm ? { name: roll.gsm.name } : null,
        composition: roll.composition ? { name: roll.composition.name } : null,
      });
      rollsByWarehouse.set(warehouseId, bucket);
    }
  }

  return balances
    .map((b) => ({
      warehouseId: b.warehouseId,
      warehouseName: warehouseNameById.get(b.warehouseId) ?? "Unknown Warehouse",
      totalQuantity: Number(b.quantityOnHand),
      rolls: rollsByWarehouse.get(b.warehouseId) ?? [],
    }))
    .sort((a, b) => a.warehouseName.localeCompare(b.warehouseName));
}

interface GeneratePurchaseOrderResult {
  supplierId: string;
  status: "success" | "failed";
  orderId?: string;
  orderNumber?: string;
  message?: string;
}

export interface GeneratePurchaseOrdersReviewLine {
  materialRequestItemId: string;
  materialId: string;
  materialName: string;
  materialCode: string;
  uomCode: string;
  requestedQuantity: number;
  availableStockQuantity: number;
  issuedQuantity: number;
  remainingQuantity: number;
  purchaseOrderedQuantity: number;
  suggestedPurchaseQty: number;
  defaultSupplierId: string | null;
  // From the Raw Material master's unitCost (Masters -> Materials) — a
  // suggested default only, so the UI can pre-fill the required Unit Price
  // field. Never applied silently: the caller must still see and can edit it
  // before generatePurchaseOrdersForShortfall() uses it (see BUG-04).
  suggestedUnitPrice: number | null;
}

/** Review payload for the "Generate Purchase Order(s)" modal — one fetch
 * covering everything the modal needs (requested/issued/remaining/already-
 * ordered/suggested-to-order/available-stock/default-supplier per line),
 * instead of the client stitching together several. Only lines with a real
 * availableToOrderQuantity are included. */
export async function getGeneratePurchaseOrdersReview(actor: ActorContext, id: string): Promise<GeneratePurchaseOrdersReviewLine[]> {
  const request = await MaterialRequestRepository.findAnyById(actor.companyId, id);
  if (!request) throw new BusinessRuleError("NOT_FOUND", "Material request not found.", { id });

  const lines = await MaterialRequestItemRepository.findLinesForShortfallGeneration(id);
  const review: GeneratePurchaseOrdersReviewLine[] = [];

  for (const line of lines) {
    const projection = projectLineQuantities(line);
    if (projection.availableToOrderQuantity <= 0) continue;

    const availableStockQuantity = await getLineAvailableStock(actor.companyId, request.warehouseId, line);
    review.push({
      materialRequestItemId: line.id,
      materialId: line.materialId,
      materialName: line.material.styleName,
      materialCode: line.material.styleCode,
      uomCode: line.uom.code,
      requestedQuantity: Number(line.requestedQuantity),
      availableStockQuantity,
      issuedQuantity: Number(line.issuedQuantity),
      remainingQuantity: projection.remainingQuantity,
      purchaseOrderedQuantity: projection.purchaseOrderedQuantity,
      suggestedPurchaseQty: projection.availableToOrderQuantity,
      defaultSupplierId: line.material.defaultSupplierId,
      suggestedUnitPrice: line.material.unitCost === null ? null : Number(line.material.unitCost),
    });
  }

  return review;
}

/**
 * Handles the "Stock unavailable → Purchasing → Purchase Order" branch of
 * the flow — entirely optional, never automatic. Groups the caller-submitted
 * lines by the caller-submitted `supplierId` (resolved client-side from
 * default-or-manual — this function just groups by what it's given), and
 * places whatever `purchaseQuantity` the user reviewed/edited, NEVER forced
 * to equal the recomputed shortfall. Creates one real PurchaseOrder per
 * supplier group via the existing, unchanged createPurchaseOrder() — each
 * resulting PurchaseOrderItem carries materialRequestItemId back to its
 * origin line. Every submitted line is re-validated against the live
 * candidate set immediately before use (the mitigation for the concurrency
 * protection lost when materialRequestItemId's @unique constraint was
 * removed to allow multi-PO-per-line escalation) — a line that's since been
 * fully covered or doesn't belong to this request is skipped and reported,
 * never silently included.
 */
export async function generatePurchaseOrdersForShortfall(
  actor: ActorContext,
  id: string,
  input: {
    lines: Array<{ materialRequestItemId: string; purchaseQuantity: number; supplierId: string; unitPrice: number }>;
    expectedDeliveryDate?: string;
  }
) {
  const request = await MaterialRequestRepository.findAnyById(actor.companyId, id);
  if (!request) throw new BusinessRuleError("NOT_FOUND", "Material request not found.", { id });

  // RBAC audit (2026-09-24): deliberately gated on material_request.edit,
  // NOT purchase_order.create — this is the sanctioned "generate PO(s) from
  // my own Material Request's shortfall" action, distinct from creating an
  // arbitrary direct commercial Purchase Order. A role like MERCHANDISER
  // that owns Material Requests but must never create a direct PO (see
  // RBAC_AUDIT_REPORT.md) keeps this capability through material_request.edit
  // alone, without needing purchase_order.create at all.
  await PermissionService.assert(actor.userId, "material_request", "edit");

  const candidateLines = await MaterialRequestItemRepository.findLinesForShortfallGeneration(id);
  const candidatesById = new Map(candidateLines.map((c) => [c.id, c] as const));

  type Candidate = (typeof candidateLines)[number];
  const bySupplier = new Map<
    string,
    Array<{ line: Candidate; purchaseQuantity: number; suggestedQty: number; unitPrice: number }>
  >();
  const skipped: Array<{ materialRequestItemId: string; reason: string }> = [];

  for (const submitted of input.lines) {
    const candidate = candidatesById.get(submitted.materialRequestItemId);
    if (!candidate) {
      skipped.push({ materialRequestItemId: submitted.materialRequestItemId, reason: "Not a valid line on this request." });
      continue;
    }
    const projection = projectLineQuantities(candidate);
    if (projection.availableToOrderQuantity <= 0) {
      skipped.push({
        materialRequestItemId: submitted.materialRequestItemId,
        reason: "Already fully covered by an existing purchase order.",
      });
      continue;
    }
    const list = bySupplier.get(submitted.supplierId) ?? [];
    list.push({
      line: candidate,
      purchaseQuantity: submitted.purchaseQuantity,
      suggestedQty: projection.availableToOrderQuantity,
      unitPrice: submitted.unitPrice,
    });
    bySupplier.set(submitted.supplierId, list);
  }

  const results: GeneratePurchaseOrderResult[] = [];

  for (const [supplierId, lines] of bySupplier) {
    try {
      const order = await createPurchaseOrder(actor, {
        supplierId,
        orderDate: todayIsoDate(),
        expectedDeliveryDate: input.expectedDeliveryDate || "",
        items: lines.map(({ line, purchaseQuantity, unitPrice }) => ({
          productId: line.materialId,
          uomId: line.uomId,
          orderedQuantity: purchaseQuantity,
          unitPrice,
          notes: `Shortfall for Material Request ${request.requestNumber}`,
          materialRequestItemId: line.id,
          colorId: line.colorId ?? undefined,
          dyeId: line.dyeId ?? undefined,
        })),
      });
      results.push({ supplierId, status: "success", orderId: order.id, orderNumber: order.orderNumber });

      for (const { line, purchaseQuantity, suggestedQty } of lines) {
        if (Math.abs(purchaseQuantity - suggestedQty) > 0.0001) {
          await writeAuditLog({
            companyId: actor.companyId,
            userId: actor.userId,
            tableName: "material_request_items",
            recordId: line.id,
            action: "UPDATE",
            oldValues: { suggestedQuantity: suggestedQty },
            newValues: { purchaseOrderedQuantity: purchaseQuantity },
          });
        }
      }
    } catch (err) {
      const message = err instanceof BusinessRuleError ? err.message : "Failed to create a purchase order for this supplier group.";
      results.push({ supplierId, status: "failed", message });
    }
  }

  await recomputeAndPersistStatus(actor, id);

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "material_requests",
    recordId: id,
    action: "UPDATE",
    newValues: {
      generatedGroups: results.length,
      succeeded: results.filter((r) => r.status === "success").length,
      skippedCount: skipped.length,
    },
  });

  return { results, skipped, materialRequest: await getMaterialRequestById(actor, id) };
}

export async function closeMaterialRequest(actor: ActorContext, id: string) {
  const request = await MaterialRequestRepository.findAnyById(actor.companyId, id);
  if (!request) throw new BusinessRuleError("NOT_FOUND", "Material request not found.", { id });

  if (request.status !== "OPEN" && request.status !== "PARTIALLY_FULFILLED") {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", `Cannot close a material request in "${request.status}" status.`, {
      currentStatus: request.status,
    });
  }

  const updated = await MaterialRequestRepository.update(id, { status: "CLOSED" });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "material_requests",
    recordId: id,
    action: "UPDATE",
    oldValues: { status: request.status },
    newValues: { status: "CLOSED" },
  });

  return updated;
}

/**
 * CANCELLED is listed as reachable from several status labels, but the real
 * enforcement is the unconditional issued/escalated check below — never
 * inferred from the status label alone (the exact bug class already found
 * in Sampling's Hold/Resume flow and Purchasing's own cancel guard).
 */
export async function transitionMaterialRequestStatus(actor: ActorContext, id: string, targetStatus: MaterialRequestStatus) {
  const before = await MaterialRequestRepository.findAnyById(actor.companyId, id);
  if (!before) throw new BusinessRuleError("NOT_FOUND", "Material request not found.", { id });

  const allowed = CANCEL_TARGETS_BY_STATUS[before.status] ?? [];
  if (!allowed.includes(targetStatus)) {
    throw new BusinessRuleError(
      "INVALID_STATE_TRANSITION",
      `Cannot move a material request from "${before.status}" to "${targetStatus}".`,
      { from: before.status, to: targetStatus }
    );
  }

  if (targetStatus === "CANCELLED") {
    await assertNothingIssuedOrEscalated(id, "cancel this material request");
  }

  const data: Prisma.MaterialRequestUncheckedUpdateInput = { status: targetStatus };
  if (targetStatus === "ON_HOLD") data.statusBeforeHold = before.status;

  const updated = await MaterialRequestRepository.update(id, data);

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "material_requests",
    recordId: id,
    action: targetStatus === "CANCELLED" ? "CANCEL" : "UPDATE",
    oldValues: { status: before.status },
    newValues: { status: targetStatus },
  });

  return updated;
}

/** Restores the exact status the request was held from — no caller-chosen
 * target, same reasoning as every other module's resume function. */
export async function resumeMaterialRequestFromHold(actor: ActorContext, id: string) {
  const before = await MaterialRequestRepository.findAnyById(actor.companyId, id);
  if (!before) throw new BusinessRuleError("NOT_FOUND", "Material request not found.", { id });

  if (before.status !== "ON_HOLD" || !before.statusBeforeHold) {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This material request isn't on hold.", {
      currentStatus: before.status,
    });
  }

  const updated = await MaterialRequestRepository.update(id, {
    status: before.statusBeforeHold,
    statusBeforeHold: null,
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "material_requests",
    recordId: id,
    action: "UPDATE",
    oldValues: { status: "ON_HOLD" },
    newValues: { status: before.statusBeforeHold },
  });

  return updated;
}
