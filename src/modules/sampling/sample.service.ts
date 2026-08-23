import { prisma } from "@/core/db/client";
import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { generateDocumentNumber } from "@/core/numbering/DocumentNumberingService";
import type { ListQuery } from "@/lib/list-query";
import type {
  ConvertSampleToStyleInput,
  SampleApprovalInput,
  SampleCommentInput,
  SampleCostingInput,
  SampleMaterialCostingInput,
  SampleMaterialDamageInput,
  SampleMaterialInput,
  SampleOtherChargeInput,
  SampleRequestInput,
  SampleVersionInput,
} from "./sample.schema";
import {
  SampleApprovalRepository,
  SampleCommentRepository,
  SampleMaterialRepository,
  SampleOtherChargeRepository,
  SampleRequestRepository,
  SampleVersionRepository,
} from "./sample.repository";
import { ProductRepository } from "@/modules/products/product.repository";
import { advanceMasterCodeSequence } from "@/core/numbering/DocumentNumberingService";
import { SampleStatus, SampleType, type Prisma } from "@prisma/client";

interface ActorContext {
  companyId: string;
  userId: string;
  branchId?: string | null;
}

/**
 * Explicit state machine — kept data-driven so a transition's legality is a
 * single map lookup, not scattered if/else chains. CUSTOMER_FEEDBACK_RECEIVED's
 * outcomes (APPROVED/REJECTED/REVISION_REQUESTED) only happen via
 * recordSampleApproval, and REVISION_REQUESTED -> IN_DEVELOPMENT only via
 * addSampleVersion — neither is reachable through the generic status-change
 * endpoint, so they're intentionally left out of this map.
 *
 * TECH_PACK_READY is deliberately absent from REQUESTED's list too — it's only
 * ever reached via addSampleVersion (which actually creates version 1). Letting
 * the generic status endpoint set it directly used to let a request land on
 * TECH_PACK_READY/IN_DEVELOPMENT/SUBMITTED_TO_CUSTOMER with zero versions,
 * which broke the customer-decision UI (it has nothing to attach a decision
 * to). ON_HOLD's only generic exit is CANCELLED for the same reason — resuming
 * back to work happens through resumeSampleFromHold(), which restores the
 * exact status it was held from (statusBeforeHold) instead of letting the
 * caller pick an arbitrary target.
 */
const ALLOWED_TRANSITIONS: Record<SampleStatus, SampleStatus[]> = {
  DRAFT: ["REQUESTED", "CANCELLED"],
  REQUESTED: ["ON_HOLD", "CANCELLED"],
  TECH_PACK_READY: ["IN_DEVELOPMENT", "ON_HOLD", "CANCELLED"],
  IN_DEVELOPMENT: ["INTERNAL_QC", "ON_HOLD", "CANCELLED"],
  INTERNAL_QC: ["SUBMITTED_TO_CUSTOMER", "IN_DEVELOPMENT", "ON_HOLD", "CANCELLED"],
  SUBMITTED_TO_CUSTOMER: ["CUSTOMER_FEEDBACK_RECEIVED", "ON_HOLD", "CANCELLED"],
  CUSTOMER_FEEDBACK_RECEIVED: [],
  REVISION_REQUESTED: ["ON_HOLD", "CANCELLED"],
  ON_HOLD: ["CANCELLED"],
  APPROVED: [],
  REJECTED: [],
  CANCELLED: [],
};

export interface SampleRequestListFilters {
  customerId?: string;
  buyerId?: string;
  styleSearch?: string;
  /** Raw comma-separated status list from the querystring — see listSampleRequests. */
  status?: string;
  sampleType?: SampleType;
  requestedByUserId?: string;
  dateFrom?: string;
  dateTo?: string;
  color?: string;
}

const VALID_SAMPLE_STATUSES = new Set<string>(Object.values(SampleStatus));

/**
 * Sampling's worklist needs sorting by columns that live on a related table
 * (Customer/Buyer name), which the generic `{ [sortBy]: sortOrder }` used by
 * every other list endpoint can't express — Prisma needs a nested object for
 * relation sorts. Kept local to this module since no other list currently
 * needs it; promote to a shared helper if a second module does.
 */
function buildSampleRequestOrderBy(sortBy: string, sortOrder: "asc" | "desc"): Prisma.SampleRequestOrderByWithRelationInput {
  switch (sortBy) {
    case "customer":
      return { customer: { name: sortOrder } };
    case "buyer":
      return { buyer: { name: sortOrder } };
    case "status":
      return { status: sortOrder };
    case "styleName":
      return { styleName: sortOrder };
    case "requestDate":
      return { requestDate: sortOrder };
    default:
      return { requestDate: sortOrder };
  }
}

export async function listSampleRequests(companyId: string, query: ListQuery, filters: SampleRequestListFilters = {}) {
  // Invalid/unknown status values are dropped rather than passed to Prisma —
  // SampleStatus (the Prisma-generated runtime enum object) is the single
  // existing source of truth for valid values, not a second hardcoded list.
  const statuses = (filters.status?.split(",").filter(Boolean) ?? []).filter((s) =>
    VALID_SAMPLE_STATUSES.has(s)
  ) as SampleStatus[];

  const where: Prisma.SampleRequestWhereInput = {
    companyId,
    ...(query.search ? { requestNumber: { contains: query.search, mode: "insensitive" as const } } : {}),
    ...(filters.customerId ? { customerId: filters.customerId } : {}),
    ...(filters.buyerId ? { buyerId: filters.buyerId } : {}),
    ...(filters.requestedByUserId ? { requestedByUserId: filters.requestedByUserId } : {}),
    ...(filters.sampleType ? { sampleType: filters.sampleType } : {}),
    ...(statuses.length > 0 ? { status: { in: statuses } } : {}),
    ...(filters.color ? { color: { contains: filters.color, mode: "insensitive" as const } } : {}),
    // Style has no single source column — a request may only have the
    // free-text styleName, only a linked Product, or (usually) both kept in
    // sync — so a style search matches either rather than picking one.
    ...(filters.styleSearch
      ? {
          OR: [
            { styleName: { contains: filters.styleSearch, mode: "insensitive" as const } },
            { product: { styleName: { contains: filters.styleSearch, mode: "insensitive" as const } } },
          ],
        }
      : {}),
    ...(filters.dateFrom || filters.dateTo
      ? {
          requestDate: {
            ...(filters.dateFrom ? { gte: new Date(filters.dateFrom) } : {}),
            ...(filters.dateTo ? { lte: new Date(filters.dateTo) } : {}),
          },
        }
      : {}),
  };

  const [data, totalCount] = await Promise.all([
    SampleRequestRepository.findMany(where, {
      orderBy: buildSampleRequestOrderBy(query.sortBy, query.sortOrder),
      skip: query.skip,
      take: query.take,
    }),
    SampleRequestRepository.count(where),
  ]);

  return { data, totalCount };
}

export async function getSampleRequestById(companyId: string, id: string) {
  const request = await SampleRequestRepository.findByIdWithDetails(companyId, id);
  if (!request) throw new BusinessRuleError("NOT_FOUND", "Sample request not found.", { id });
  return request;
}

export async function createSampleRequest(actor: ActorContext, input: SampleRequestInput) {
  const requestNumber = await generateDocumentNumber({
    companyId: actor.companyId,
    branchId: actor.branchId ?? null,
    documentType: "SAMPLE_REQUEST",
  });

  const request = await SampleRequestRepository.create({
    companyId: actor.companyId,
    branchId: actor.branchId || null,
    requestNumber,
    customerId: input.customerId,
    buyerId: input.buyerId || null,
    productId: input.productId || null,
    styleName: input.styleName,
    sampleType: input.sampleType,
    color: input.color || null,
    requestedByUserId: actor.userId,
    requestDate: new Date(input.requestDate),
    targetSubmissionDate: input.targetSubmissionDate ? new Date(input.targetSubmissionDate) : null,
    status: "REQUESTED",
    currentVersionNumber: 0,
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "sample_requests",
    recordId: request.id,
    action: "CREATE",
    newValues: request,
  });

  return request;
}

// Color is deliberately editable at any status, not just non-terminal ones —
// a client that only sent a photo often confirms/changes the color well
// after the sample is physically made, sometimes even after approval.
export async function updateSampleRequestColor(actor: ActorContext, id: string, color: string | null) {
  const existing = await SampleRequestRepository.findAnyById(actor.companyId, id);
  if (!existing) throw new BusinessRuleError("NOT_FOUND", "Sample request not found.", { id });

  const updated = await SampleRequestRepository.update(id, { color });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "sample_requests",
    recordId: id,
    action: "UPDATE",
    oldValues: { color: existing.color },
    newValues: { color: updated.color },
  });

  return updated;
}

export async function transitionSampleStatus(actor: ActorContext, id: string, targetStatus: SampleStatus) {
  const before = await SampleRequestRepository.findAnyById(actor.companyId, id);
  if (!before) throw new BusinessRuleError("NOT_FOUND", "Sample request not found.", { id });

  const allowed = ALLOWED_TRANSITIONS[before.status] ?? [];
  if (!allowed.includes(targetStatus)) {
    throw new BusinessRuleError(
      "INVALID_STATE_TRANSITION",
      `Cannot move a sample request from ${before.status} to ${targetStatus}.`,
      { from: before.status, to: targetStatus }
    );
  }

  const updated = await SampleRequestRepository.update(id, {
    status: targetStatus,
    // Remember exactly where we were so resumeSampleFromHold() can restore
    // it without the caller having to (mis)pick a target status.
    statusBeforeHold: targetStatus === "ON_HOLD" ? before.status : null,
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "sample_requests",
    recordId: id,
    action: "UPDATE",
    oldValues: before,
    newValues: updated,
  });

  return updated;
}

/** Restores a request to exactly the status it was on hold from — never an arbitrary caller-picked target. */
export async function resumeSampleFromHold(actor: ActorContext, id: string) {
  const before = await SampleRequestRepository.findAnyById(actor.companyId, id);
  if (!before) throw new BusinessRuleError("NOT_FOUND", "Sample request not found.", { id });

  if (before.status !== "ON_HOLD" || !before.statusBeforeHold) {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This sample request is not on hold.", {
      from: before.status,
    });
  }

  const updated = await SampleRequestRepository.update(id, {
    status: before.statusBeforeHold,
    statusBeforeHold: null,
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "sample_requests",
    recordId: id,
    action: "UPDATE",
    oldValues: before,
    newValues: updated,
  });

  return updated;
}

/**
 * Creates version 1 (from REQUESTED) or a revision (from REVISION_REQUESTED).
 * The prior current version, if any, is marked SUPERSEDED — versions are
 * append-only and never edited past this point.
 */
export async function addSampleVersion(actor: ActorContext, sampleRequestId: string, input: SampleVersionInput) {
  const request = await SampleRequestRepository.findAnyById(actor.companyId, sampleRequestId);
  if (!request) throw new BusinessRuleError("NOT_FOUND", "Sample request not found.", { id: sampleRequestId });

  const isFirstVersion = request.currentVersionNumber === 0;
  const requiredStatus: SampleStatus = isFirstVersion ? "REQUESTED" : "REVISION_REQUESTED";
  if (request.status !== requiredStatus) {
    throw new BusinessRuleError(
      "INVALID_STATE_TRANSITION",
      `A ${isFirstVersion ? "first version" : "revision"} can only be added from ${requiredStatus}, not ${request.status}.`,
      { from: request.status, expected: requiredStatus }
    );
  }

  const latest = await SampleVersionRepository.findLatest(sampleRequestId);
  const nextVersionNumber = (latest?.versionNumber ?? 0) + 1;

  if (latest) {
    await SampleVersionRepository.update(latest.id, { status: "SUPERSEDED" });
  }

  const version = await SampleVersionRepository.create({
    sampleRequestId,
    versionNumber: nextVersionNumber,
    status: "IN_DEVELOPMENT",
    techPackNotes: input.techPackNotes || null,
    estimatedCostPerUnit: input.estimatedCostPerUnit ?? null,
    createdByUserId: actor.userId,
  });

  const updatedRequest = await SampleRequestRepository.update(sampleRequestId, {
    currentVersionNumber: nextVersionNumber,
    status: isFirstVersion ? "TECH_PACK_READY" : "IN_DEVELOPMENT",
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "sample_versions",
    recordId: version.id,
    action: "CREATE",
    newValues: version,
  });

  return { version, request: updatedRequest };
}

/**
 * Attributes that make two "add material" calls on the same version the
 * *same* material line (safe to merge quantities) rather than two distinct
 * lines that both happen to reference the same material — real garment
 * sampling legitimately needs the same material twice for different colors,
 * specs/variants, or usage/purpose (e.g. "for main body" vs "for collar").
 *
 * `materialId`, `uomId`, and `colorId` are real columns on SampleMaterial;
 * specification/usage-purpose aren't modeled yet, so they can't participate.
 * When one of them IS added (a new column + a new SampleMaterialInput
 * field), extend this array and `buildMaterialMergeKey()` below to read it —
 * the merge algorithm in addSampleMaterial() itself never needs to change.
 */
const MATERIAL_MERGE_KEY_FIELDS = ["materialId", "uomId", "colorId", "dyeId"] as const;

function buildMaterialMergeKey(input: SampleMaterialInput): Prisma.SampleMaterialWhereInput {
  // Built from a plain field-name list rather than a hand-typed object, so a
  // future field only needs adding to MATERIAL_MERGE_KEY_FIELDS above — that
  // genericness is exactly why this can't be typed as SampleMaterialWhereInput
  // until the final cast (Prisma's per-field types differ, e.g. materialId is
  // non-nullable and uomId isn't, which a loop over a field list can't know).
  const key: Record<string, string | null> = {};
  for (const field of MATERIAL_MERGE_KEY_FIELDS) {
    key[field] = input[field] || null;
  }
  return key as Prisma.SampleMaterialWhereInput;
}

interface RecalculateCostingOverrides {
  marginPercent?: number;
  commissionPercent?: number;
  freightAmount?: number;
  /** Only ever applied while the version has no priced material/charge yet — see the mode check below. */
  manualEstimatedCostPerUnit?: number;
  /**
   * Dedicated costing endpoints must reject a call against a locked/superseded
   * version (throwIfBlocked: true, the default). addSampleMaterial() must
   * never be blocked by a costing lock at all — adding a material is a
   * general workflow action, not a costing edit — so it passes false and
   * tolerates the rollup silently failing to persist.
   */
  throwIfBlocked?: boolean;
}

/**
 * Recomputes and persists costSubtotal/finalTotal (and, while in "manual"
 * mode, estimatedCostPerUnit) for one SampleVersion from its current
 * SampleMaterial rates and SampleOtherCharge rows. Hardcoded formula, base
 * currency only — no configurable templates, no multi-currency:
 *   materialCost = Σ plannedQuantity × rate × (1 + gstPercentage/100)   [rows with rate = null contribute 0]
 *   costSubtotal = materialCost + Σ otherCharge.amount
 *   finalTotal   = costSubtotal × (1 + margin%) × (1 + commission%) + freight
 *
 * The write is a single guarded `updateMany` (SampleVersionRepository.
 * updateCostingIfUnlocked) whose WHERE clause re-asserts "currently unlocked,
 * not superseded" — this is what makes the lock/supersede check race-free:
 * every caller of this function (material rate edit, charge CRUD, the
 * margin/commission/freight PATCH) performs its own mutation and this
 * recompute inside one `prisma.$transaction`, so if the guard fails the
 * whole transaction — including the mutation that triggered it — rolls back
 * together. There is deliberately no separate "read isCostingLocked, then
 * decide" step anywhere in this flow.
 */
export async function recalculateSampleVersionCosting(
  tx: Prisma.TransactionClient,
  sampleVersionId: string,
  overrides: RecalculateCostingOverrides = {}
): Promise<{ applied: boolean; finalTotal: number }> {
  const current = await SampleVersionRepository.findByIdTx(tx, sampleVersionId);
  if (!current) throw new BusinessRuleError("NOT_FOUND", "Sample version not found.", { id: sampleVersionId });

  const materials = await SampleMaterialRepository.findByVersionIdTx(tx, sampleVersionId);
  const charges = await SampleOtherChargeRepository.findByVersionIdTx(tx, sampleVersionId);

  const materialCost = materials
    .filter((m) => m.rate !== null)
    .reduce((sum, m) => sum + Number(m.plannedQuantity) * Number(m.rate) * (1 + Number(m.gstPercentage ?? 0) / 100), 0);
  const otherChargesTotal = charges.reduce((sum, c) => sum + Number(c.amount), 0);
  const costSubtotal = materialCost + otherChargesTotal;

  const marginPercent = overrides.marginPercent ?? Number(current.marginPercent ?? 0);
  const commissionPercent = overrides.commissionPercent ?? Number(current.commissionPercent ?? 0);
  const freightAmount = overrides.freightAmount ?? Number(current.freightAmount ?? 0);

  const grossTotal = costSubtotal + costSubtotal * (marginPercent / 100);
  const finalTotal = grossTotal + grossTotal * (commissionPercent / 100) + freightAmount;

  // Implicit mode detection, no separate boolean column — "has real costing
  // data" is derived from the rows themselves, so it can never drift out of
  // sync with a flag someone forgot to flip.
  const hasPricedData = materials.some((m) => m.rate !== null) || charges.length > 0;

  const data: Prisma.SampleVersionUncheckedUpdateInput = { costSubtotal, finalTotal };
  if (overrides.marginPercent !== undefined) data.marginPercent = overrides.marginPercent;
  if (overrides.commissionPercent !== undefined) data.commissionPercent = overrides.commissionPercent;
  if (overrides.freightAmount !== undefined) data.freightAmount = overrides.freightAmount;

  if (hasPricedData) {
    // Computed mode — always overwritten, a manual value is silently ignored.
    data.estimatedCostPerUnit = finalTotal;
  } else if (overrides.manualEstimatedCostPerUnit !== undefined) {
    // Manual mode — only touched when the caller explicitly provided a value.
    data.estimatedCostPerUnit = overrides.manualEstimatedCostPerUnit;
  }

  const result = await SampleVersionRepository.updateCostingIfUnlocked(tx, sampleVersionId, data);

  if (result.count === 0) {
    if (overrides.throwIfBlocked ?? true) {
      throw new BusinessRuleError(
        "INVALID_STATE_TRANSITION",
        "This sample version's costing is locked or has been superseded, so it can no longer be changed.",
        { sampleVersionId }
      );
    }
    return { applied: false, finalTotal };
  }

  return { applied: true, finalTotal };
}

export async function addSampleMaterial(actor: ActorContext, sampleVersionId: string, input: SampleMaterialInput) {
  // findWithRequestOwner (not findById) so the parent request's companyId can be
  // checked here — without this, a version UUID from another tenant would pass
  // straight through to the insert/read below (confirmed cross-tenant bug, fixed).
  const version = await SampleVersionRepository.findWithRequestOwner(sampleVersionId);
  if (!version || version.sampleRequest.companyId !== actor.companyId) {
    throw new BusinessRuleError("NOT_FOUND", "Sample version not found.", { id: sampleVersionId });
  }

  // Adding the same material to a version twice used to insert a second,
  // confusingly duplicate row every time — now it only merges when every
  // MATERIAL_MERGE_KEY_FIELDS attribute matches exactly (today: same material
  // AND same unit); any difference creates its own line instead, since that
  // difference is exactly what makes the two lines legitimately distinct.
  const mergeKey = buildMaterialMergeKey(input);
  const existing = await SampleMaterialRepository.findByVersionAndMergeKey(sampleVersionId, mergeKey);

  if (existing) {
    const mergedQuantity = Number(existing.plannedQuantity) + input.plannedQuantity;
    await SampleMaterialRepository.update(existing.id, {
      plannedQuantity: mergedQuantity,
      notes: input.notes || existing.notes,
    });

    await writeAuditLog({
      companyId: actor.companyId,
      userId: actor.userId,
      tableName: "sample_materials",
      recordId: existing.id,
      action: "UPDATE",
      oldValues: { plannedQuantity: existing.plannedQuantity },
      newValues: { plannedQuantity: mergedQuantity },
    });
  } else {
    await SampleMaterialRepository.createMany([
      {
        sampleVersionId,
        materialId: input.materialId,
        plannedQuantity: input.plannedQuantity,
        uomId: input.uomId || null,
        colorId: input.colorId || null,
        dyeId: input.dyeId || null,
        notes: input.notes || null,
      },
    ]);

    await writeAuditLog({
      companyId: actor.companyId,
      userId: actor.userId,
      tableName: "sample_materials",
      recordId: sampleVersionId,
      action: "CREATE",
      newValues: { materialId: input.materialId, plannedQuantity: input.plannedQuantity },
    });
  }

  // Never blocked by a costing lock — adding a material is a general workflow
  // action, not a costing edit (rate is never part of this payload at all).
  // A fresh line has no rate yet, so this recompute is a harmless no-op on
  // create; on merge it keeps a since-priced line's rollup in sync with its
  // now-larger plannedQuantity.
  await recalculateSampleVersionCosting(prisma, sampleVersionId, { throwIfBlocked: false });

  return SampleMaterialRepository.findByVersionId(sampleVersionId);
}

// Damage/wastage is discovered after a material line already exists (during
// cutting/stitching, not at planning time), so this is a separate scoped
// update rather than something addSampleMaterial captures upfront.
export async function recordSampleMaterialDamage(
  actor: ActorContext,
  sampleMaterialId: string,
  input: SampleMaterialDamageInput
) {
  const material = await SampleMaterialRepository.findWithRequestOwner(sampleMaterialId);
  if (!material || material.sampleVersion.sampleRequest.companyId !== actor.companyId) {
    throw new BusinessRuleError("NOT_FOUND", "Sample material not found.", { id: sampleMaterialId });
  }

  const updated = await SampleMaterialRepository.update(sampleMaterialId, {
    damagedQuantity: input.damagedQuantity,
    damageReason: input.damageReason || null,
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "sample_materials",
    recordId: sampleMaterialId,
    action: "UPDATE",
    oldValues: { damagedQuantity: material.damagedQuantity, damageReason: material.damageReason },
    newValues: { damagedQuantity: updated.damagedQuantity, damageReason: updated.damageReason },
  });

  return SampleMaterialRepository.findByVersionId(material.sampleVersionId);
}

/**
 * Sets/clears rate + GST on one existing material line — never through
 * addSampleMaterial's create/merge payload (see MATERIAL_MERGE_KEY_FIELDS's
 * comment: rate is a cost attribute, not an identity attribute, so it never
 * participates in "does this merge into an existing line" decisions). The
 * update to the line itself is unconditional; the lock/supersede guard lives
 * entirely on the recompute write inside the same transaction, which rolls
 * this update back too if the guard fails.
 */
export async function recordSampleMaterialCosting(
  actor: ActorContext,
  sampleMaterialId: string,
  input: SampleMaterialCostingInput
) {
  const material = await SampleMaterialRepository.findWithRequestOwner(sampleMaterialId);
  if (!material || material.sampleVersion.sampleRequest.companyId !== actor.companyId) {
    throw new BusinessRuleError("NOT_FOUND", "Sample material not found.", { id: sampleMaterialId });
  }

  const { finalTotal } = await prisma.$transaction(async (tx) => {
    await SampleMaterialRepository.updateCosting(tx, sampleMaterialId, {
      rate: input.rate,
      gstPercentage: input.gstPercentage ?? null,
    });
    return recalculateSampleVersionCosting(tx, material.sampleVersionId, { throwIfBlocked: true });
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "sample_materials",
    recordId: sampleMaterialId,
    action: "UPDATE",
    oldValues: { rate: material.rate, gstPercentage: material.gstPercentage },
    newValues: { rate: input.rate, gstPercentage: input.gstPercentage ?? null, finalTotal },
  });

  return SampleMaterialRepository.findByVersionId(material.sampleVersionId);
}

/**
 * Non-material costing lines (labor/process/overhead) — plain CRUD, no
 * merge-key semantics, since a duplicate charge is just user error the
 * merchandiser edits/deletes directly. Each mutation is unconditional; the
 * lock/supersede guard lives entirely on the recompute write that follows it
 * in the same transaction.
 */
export async function addSampleOtherCharge(actor: ActorContext, sampleVersionId: string, input: SampleOtherChargeInput) {
  const version = await SampleVersionRepository.findWithRequestOwner(sampleVersionId);
  if (!version || version.sampleRequest.companyId !== actor.companyId) {
    throw new BusinessRuleError("NOT_FOUND", "Sample version not found.", { id: sampleVersionId });
  }

  const charge = await prisma.$transaction(async (tx) => {
    const created = await SampleOtherChargeRepository.create(tx, {
      sampleVersionId,
      costHead: input.costHead,
      description: input.description,
      amount: input.amount,
      notes: input.notes || null,
    });
    await recalculateSampleVersionCosting(tx, sampleVersionId, { throwIfBlocked: true });
    return created;
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "sample_other_charges",
    recordId: charge.id,
    action: "CREATE",
    newValues: charge,
  });

  return SampleOtherChargeRepository.findByVersionId(sampleVersionId);
}

export async function updateSampleOtherCharge(actor: ActorContext, sampleChargeId: string, input: SampleOtherChargeInput) {
  const charge = await SampleOtherChargeRepository.findWithVersionOwner(sampleChargeId);
  if (!charge || charge.sampleVersion.sampleRequest.companyId !== actor.companyId) {
    throw new BusinessRuleError("NOT_FOUND", "Sample charge not found.", { id: sampleChargeId });
  }

  const updated = await prisma.$transaction(async (tx) => {
    const result = await SampleOtherChargeRepository.update(tx, sampleChargeId, {
      costHead: input.costHead,
      description: input.description,
      amount: input.amount,
      notes: input.notes || null,
    });
    await recalculateSampleVersionCosting(tx, charge.sampleVersionId, { throwIfBlocked: true });
    return result;
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "sample_other_charges",
    recordId: sampleChargeId,
    action: "UPDATE",
    oldValues: { costHead: charge.costHead, description: charge.description, amount: charge.amount },
    newValues: { costHead: updated.costHead, description: updated.description, amount: updated.amount },
  });

  return SampleOtherChargeRepository.findByVersionId(charge.sampleVersionId);
}

export async function deleteSampleOtherCharge(actor: ActorContext, sampleChargeId: string) {
  const charge = await SampleOtherChargeRepository.findWithVersionOwner(sampleChargeId);
  if (!charge || charge.sampleVersion.sampleRequest.companyId !== actor.companyId) {
    throw new BusinessRuleError("NOT_FOUND", "Sample charge not found.", { id: sampleChargeId });
  }

  await prisma.$transaction(async (tx) => {
    await SampleOtherChargeRepository.delete(tx, sampleChargeId);
    await recalculateSampleVersionCosting(tx, charge.sampleVersionId, { throwIfBlocked: true });
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "sample_other_charges",
    recordId: sampleChargeId,
    action: "DELETE",
    oldValues: { costHead: charge.costHead, description: charge.description, amount: charge.amount },
  });

  return SampleOtherChargeRepository.findByVersionId(charge.sampleVersionId);
}

/**
 * Margin%/commission%/freight, and (only while the version has no priced
 * material/charge yet) a manual estimatedCostPerUnit — see
 * recalculateSampleVersionCosting's mode handling. costSubtotal/finalTotal
 * are never accepted here; they're always recomputed server-side.
 */
export async function updateSampleVersionCosting(actor: ActorContext, sampleVersionId: string, input: SampleCostingInput) {
  const version = await SampleVersionRepository.findWithRequestOwner(sampleVersionId);
  if (!version || version.sampleRequest.companyId !== actor.companyId) {
    throw new BusinessRuleError("NOT_FOUND", "Sample version not found.", { id: sampleVersionId });
  }

  const { finalTotal } = await prisma.$transaction((tx) =>
    recalculateSampleVersionCosting(tx, sampleVersionId, {
      marginPercent: input.marginPercent,
      commissionPercent: input.commissionPercent,
      freightAmount: input.freightAmount,
      manualEstimatedCostPerUnit: input.estimatedCostPerUnit,
      throwIfBlocked: true,
    })
  );

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "sample_versions",
    recordId: sampleVersionId,
    action: "UPDATE",
    newValues: {
      marginPercent: input.marginPercent,
      commissionPercent: input.commissionPercent,
      freightAmount: input.freightAmount,
      finalTotal,
    },
  });

  return SampleVersionRepository.findById(sampleVersionId);
}

/**
 * Reversible lock — the first one in this app. Gated on the "approve" RBAC
 * action, not "edit" (enforced at the route layer): MERCHANDISER has edit but
 * not approve, MANAGEMENT has approve but not edit, so a merchandiser can
 * build a costing sheet but only someone with approval authority can freeze
 * or unfreeze it. A SUPERSEDED version can never be locked or unlocked — its
 * costing is already permanently frozen by that status alone.
 */
export async function lockSampleCosting(actor: ActorContext, sampleVersionId: string) {
  const version = await SampleVersionRepository.findWithRequestOwner(sampleVersionId);
  if (!version || version.sampleRequest.companyId !== actor.companyId) {
    throw new BusinessRuleError("NOT_FOUND", "Sample version not found.", { id: sampleVersionId });
  }

  const result = await SampleVersionRepository.updateCostingIfUnlocked(prisma, sampleVersionId, {
    isCostingLocked: true,
    costingLockedAt: new Date(),
    costingLockedByUserId: actor.userId,
  });

  if (result.count === 0) {
    throw new BusinessRuleError(
      "INVALID_STATE_TRANSITION",
      "This sample version's costing is already locked, or has been superseded.",
      { sampleVersionId }
    );
  }

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "sample_versions",
    recordId: sampleVersionId,
    action: "UPDATE",
    oldValues: { isCostingLocked: false },
    newValues: { isCostingLocked: true, costingLockedByUserId: actor.userId },
  });

  return SampleVersionRepository.findById(sampleVersionId);
}

export async function unlockSampleCosting(actor: ActorContext, sampleVersionId: string) {
  const version = await SampleVersionRepository.findWithRequestOwner(sampleVersionId);
  if (!version || version.sampleRequest.companyId !== actor.companyId) {
    throw new BusinessRuleError("NOT_FOUND", "Sample version not found.", { id: sampleVersionId });
  }

  const result = await SampleVersionRepository.updateCostingIfLocked(prisma, sampleVersionId, {
    isCostingLocked: false,
    costingLockedAt: null,
    costingLockedByUserId: null,
  });

  if (result.count === 0) {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This sample version's costing isn't locked.", {
      sampleVersionId,
    });
  }

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "sample_versions",
    recordId: sampleVersionId,
    action: "UPDATE",
    oldValues: { isCostingLocked: true },
    newValues: { isCostingLocked: false },
  });

  return SampleVersionRepository.findById(sampleVersionId);
}

/**
 * Records the customer's decision on the currently-submitted version. Only
 * legal once the header is SUBMITTED_TO_CUSTOMER — this is the one place
 * CUSTOMER_FEEDBACK_RECEIVED's outcomes are ever set.
 */
export async function recordSampleApproval(actor: ActorContext, sampleVersionId: string, input: SampleApprovalInput) {
  const version = await SampleVersionRepository.findById(sampleVersionId);
  if (!version) throw new BusinessRuleError("NOT_FOUND", "Sample version not found.", { id: sampleVersionId });

  const request = await SampleRequestRepository.findAnyById(actor.companyId, version.sampleRequestId);
  if (!request) throw new BusinessRuleError("NOT_FOUND", "Sample request not found.", { id: version.sampleRequestId });

  if (request.status !== "SUBMITTED_TO_CUSTOMER") {
    throw new BusinessRuleError(
      "INVALID_STATE_TRANSITION",
      `A customer decision can only be recorded while a sample is SUBMITTED_TO_CUSTOMER, not ${request.status}.`,
      { from: request.status }
    );
  }

  const approval = await SampleApprovalRepository.create({
    sampleVersionId,
    decision: input.decision,
    decidedByUserId: actor.userId,
    customerContactName: input.customerContactName || null,
    decisionNotes: input.decisionNotes || null,
  });

  const versionStatus = input.decision === "APPROVED" ? "APPROVED" : input.decision === "REJECTED" ? "REJECTED" : "SUBMITTED";
  await SampleVersionRepository.update(sampleVersionId, { status: versionStatus, customerDecisionAt: new Date() });

  const updatedRequest = await SampleRequestRepository.update(request.id, { status: input.decision });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "sample_approvals",
    recordId: approval.id,
    action: "CREATE",
    newValues: approval,
  });

  return { approval, request: updatedRequest };
}

export async function addSampleComment(actor: ActorContext, sampleRequestId: string, input: SampleCommentInput) {
  const request = await SampleRequestRepository.findAnyById(actor.companyId, sampleRequestId);
  if (!request) throw new BusinessRuleError("NOT_FOUND", "Sample request not found.", { id: sampleRequestId });

  const comment = await SampleCommentRepository.create({
    sampleRequestId,
    sampleVersionId: input.sampleVersionId || null,
    authorUserId: actor.userId,
    body: input.body,
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "sample_comments",
    recordId: comment.id,
    action: "CREATE",
    newValues: comment,
  });

  return comment;
}

/**
 * "Graduates" an approved sample into a real Style master — only legal once
 * APPROVED and only when the sample wasn't already sampling an existing style
 * (productId null). Deliberately a one-way, explicit action rather than an
 * automatic side effect of approval: only genuinely-committed styles should
 * ever reach the Products catalog, not every experiment that got approved
 * then later shelved, and a human should get to review/edit the name and
 * category before it becomes a permanent master record. Materials planned on
 * the sample (SampleMaterial) are deliberately NOT copied into a BOM here —
 * BOM/MRP doesn't exist as a module yet (Phase 5); the sample's own detail
 * page remains the reference a merchandiser works from when that's built.
 */
export async function convertSampleToStyle(
  actor: ActorContext,
  sampleRequestId: string,
  input: ConvertSampleToStyleInput
) {
  const request = await SampleRequestRepository.findAnyById(actor.companyId, sampleRequestId);
  if (!request) throw new BusinessRuleError("NOT_FOUND", "Sample request not found.", { id: sampleRequestId });

  if (request.status !== "APPROVED") {
    throw new BusinessRuleError(
      "INVALID_STATE_TRANSITION",
      `Only an approved sample can be converted into a Style, not ${request.status}.`,
      { from: request.status }
    );
  }

  if (request.productId) {
    throw new BusinessRuleError("REFERENCED_RECORD_IN_USE", "This sample is already linked to a Style.", {
      productId: request.productId,
    });
  }

  const codeInUse = await ProductRepository.findByStyleCode(actor.companyId, input.styleCode);
  if (codeInUse) {
    throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `Style code "${input.styleCode}" is already in use.`);
  }

  const product = await ProductRepository.create({
    companyId: actor.companyId,
    itemType: "STYLE",
    styleCode: input.styleCode,
    styleName: input.styleName,
    categoryId: input.categoryId || null,
    seasonId: input.seasonId || null,
    gender: input.gender || null,
    description: input.description || null,
    hsnSacCode: input.hsnSacCode || null,
    customerId: request.customerId,
    isActive: true,
  });

  await advanceMasterCodeSequence(actor.companyId, "STYLE");

  const updatedRequest = await SampleRequestRepository.update(sampleRequestId, { productId: product.id });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "products",
    recordId: product.id,
    action: "CREATE",
    newValues: product,
  });

  return { product, request: updatedRequest };
}
