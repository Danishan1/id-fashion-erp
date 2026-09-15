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
import { getAvailableQuantity, getAvailableQuantityByDye, recordInventoryTransaction } from "./inventory.service";
import { MaterialRequestItemRepository, MaterialRequestRepository } from "./material-request.repository";
import type { MaterialRequestInput, MaterialRequestItemInput, UpdateMaterialRequestInput } from "./material-request.schema";
import { Prisma, type MaterialRequestStatus } from "@prisma/client";

export interface ActorContext {
  companyId: string;
  userId: string;
  branchId?: string | null;
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

export async function listMaterialRequests(actor: { companyId: string; userId: string }, query: ListQuery) {
  const allowedBranchIds = await PermissionService.getAllowedBranchIds(actor.userId);
  const where: Prisma.MaterialRequestWhereInput = {
    companyId: actor.companyId,
    ...branchScopeWhere(allowedBranchIds),
    ...(query.search ? { requestNumber: { contains: query.search, mode: "insensitive" as const } } : {}),
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

/** Open (not CANCELLED/CLOSED) requests already carrying a real remaining
 * requirement for the same Sales Order + any of the given materials —
 * proactive advisory data for the BOM/MRP page, and the same check
 * createMaterialRequestFromShortfall enforces (with an override) before
 * actually creating a request. */
export async function findDuplicateMaterialRequests(companyId: string, salesOrderId: string, materialIds: string[]) {
  const result: Record<string, Array<{ requestId: string; requestNumber: string; remainingQuantity: number }>> = {};

  for (const materialId of materialIds) {
    const lines = await MaterialRequestRepository.findOpenDuplicateLines(companyId, salesOrderId, materialId);
    const real = lines
      .map((l) => ({
        requestId: l.materialRequest.id,
        requestNumber: l.materialRequest.requestNumber,
        remainingQuantity: Number(l.requestedQuantity) - Number(l.issuedQuantity),
      }))
      .filter((l) => l.remainingQuantity > 0);
    if (real.length > 0) result[materialId] = real;
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
  const selected = requirements.materials.filter((m) => input.materialIds.includes(m.materialId) && m.shortfallQuantity > 0);
  if (selected.length === 0) {
    throw new BusinessRuleError("VALIDATION_ERROR", "None of the selected materials have a shortfall to request.", {
      materialIds: input.materialIds,
    });
  }

  if (!input.overrideDuplicateCheck) {
    const duplicates = await findDuplicateMaterialRequests(
      actor.companyId,
      input.salesOrderId,
      selected.map((m) => m.materialId)
    );
    if (Object.keys(duplicates).length > 0) {
      throw new BusinessRuleError(
        "DUPLICATE_MATERIAL_REQUEST_EXISTS",
        "An open Material Request already exists for one or more of these materials on this Sales Order.",
        { duplicates }
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
  // Manual "issue extra" override (2026-09-15, explicit user request) — real
  // sample-making routinely uses slightly more material than the BOM's own
  // planned figure (e.g. 2m planned, 2.2m actually needed for wastage). Only
  // meaningful, and only ever honored, for SAMPLING_REQUIREMENT lines — a
  // reason is required whenever the requested amount genuinely exceeds what
  // remains, so it's visible later via the audit log (no new schema column,
  // matching the "reason lives in the audit trail" precedent already used
  // elsewhere, e.g. Material Request's own "Purchase Quantity Changed" entry).
  extraReason?: string
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

  const remaining = Number(line.requestedQuantity) - Number(line.issuedQuantity);
  const overRequested = Math.max(0, issueQuantity - remaining);
  if (overRequested > 0) {
    if (line.materialRequest.requestType !== "SAMPLING_REQUIREMENT") {
      throw new BusinessRuleError(
        "OVER_ISSUE_NOT_ALLOWED",
        `Cannot issue ${issueQuantity} — only ${remaining} remains on this line.`,
        { remaining, issueQuantity }
      );
    }
    if (!extraReason?.trim()) {
      throw new BusinessRuleError(
        "VALIDATION_ERROR",
        `Issuing ${issueQuantity} is ${overRequested} more than the ${remaining} remaining on this line — a reason is required to issue extra.`,
        { remaining, issueQuantity }
      );
    }
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
      roll.goodsReceiptItem.warehouseId !== line.materialRequest.warehouseId
    ) {
      throw new BusinessRuleError("NOT_FOUND", "The selected fabric roll is not available for this material at this warehouse.", {
        fabricRollId,
      });
    }
    const rollAvailable = Number(roll.remainingQuantity);
    if (baseQuantity > rollAvailable) {
      throw new BusinessRuleError(
        "INSUFFICIENT_RAW_MATERIAL_STOCK",
        `Unable to issue ${issueQuantity} from this roll — only ${rollAvailable} remains on it. Available: ${rollAvailable}, Requested: ${baseQuantity}.`,
        { available: rollAvailable, requested: baseQuantity }
      );
    }
  } else {
    const available = await getLineAvailableStock(actor.companyId, line.materialRequest.warehouseId, line);
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
      warehouseId: line.materialRequest.warehouseId,
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

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "material_request_items",
    recordId: lineId,
    action: "UPDATE",
    newValues: {
      issuedQuantity: issueQuantity,
      ...(overRequested > 0 ? { extraQuantity: overRequested, extraReason } : {}),
    },
  });

  return MaterialRequestItemRepository.findById(lineId);
}

/**
 * The color/shade-wise breakdown for a line's own material at its request's
 * warehouse — one row per physically in-stock FabricRoll, each carrying its
 * own real remaining quantity. Feeds the Issue modal's "which color am I
 * actually handing out" picker; empty for a non-FABRIC material (nothing
 * tracks shade at that granularity for it) or a FABRIC material with no
 * roll-level stock at all, in which case the UI simply falls back to the
 * existing flat-total Issue flow.
 */
export async function getAvailableRollsForLine(actor: ActorContext, lineId: string) {
  const line = await MaterialRequestItemRepository.findWithRequestOwner(lineId);
  if (!line || line.materialRequest.companyId !== actor.companyId) {
    throw new BusinessRuleError("NOT_FOUND", "Material request line not found.", { id: lineId });
  }

  const rolls = await FabricRollRepository.findAvailableForMaterial(
    actor.companyId,
    line.materialId,
    line.materialRequest.warehouseId
  );

  return rolls.map((roll) => ({
    id: roll.id,
    rollNumber: roll.rollNumber,
    remainingQuantity: roll.remainingQuantity,
    dye: roll.dye,
  }));
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

  // Functionally creates real PurchaseOrders — the same permission a direct
  // PO create needs, asserted explicitly rather than assumed from "edit".
  await PermissionService.assert(actor.userId, "purchasing", "create");

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
