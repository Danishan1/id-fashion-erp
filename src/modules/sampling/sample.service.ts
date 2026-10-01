import { prisma } from "@/core/db/client";
import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { generateDocumentNumber } from "@/core/numbering/DocumentNumberingService";
import { getAttachmentMetadata } from "@/core/attachments/AttachmentService";
import { PermissionService } from "@/core/rbac/PermissionService";
import type { ListQuery } from "@/lib/list-query";
import type {
  ConvertSampleToStyleInput,
  FastTrackApprovalInput,
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
import { CustomerRepository } from "@/modules/customers/customer.repository";
import { LookupRepository } from "@/modules/lookups/lookup.repository";
import { BomRepository } from "@/modules/bom-mrp/bom.repository";
import { advanceMasterCodeSequence } from "@/core/numbering/DocumentNumberingService";
import { SampleStatus, SampleType, type Prisma, type SampleVersionStatus } from "@prisma/client";
import type { SampleBomUpdateInput } from "./sample.schema";

// The header's own status is the real state — this mirrors it onto the
// current (latest, still-live) version's display-only status field for the
// three in-flight stages this generic transition covers. Previously
// completely unwired: SampleVersion.status stayed frozen at "IN_DEVELOPMENT"
// from creation all the way through Internal QC and Submitted-to-Customer,
// so the UI's "Version N — {status}" badge silently lied about where the
// request actually stood. TECH_PACK_READY/REVISION_REQUESTED and the
// terminal decision outcomes (APPROVED/REJECTED/SUPERSEDED) are deliberately
// excluded here — they're only ever reachable through addSampleVersion()/
// recordSampleApproval(), which already set the correct version status
// themselves.
const VERSION_STATUS_BY_HEADER_STATUS: Partial<Record<SampleStatus, SampleVersionStatus>> = {
  IN_DEVELOPMENT: "IN_DEVELOPMENT",
  INTERNAL_QC: "INTERNAL_QC",
  SUBMITTED_TO_CUSTOMER: "SUBMITTED",
};

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
  // IN_DEVELOPMENT here (2026-09-24, explicit request) is a direct "Send
  // Back to Development" retraction — for when a sample was submitted to
  // the customer by mistake and needs pulling back BEFORE any real customer
  // feedback exists. Deliberately distinct from the REVISION_REQUESTED path
  // below (only reachable via recordSampleApproval()): that one represents
  // genuine customer feedback and always starts a brand-new version; this
  // one keeps working on the exact same current version, no new version
  // number, since nothing about the sample itself has actually changed yet.
  SUBMITTED_TO_CUSTOMER: ["CUSTOMER_FEEDBACK_RECEIVED", "IN_DEVELOPMENT", "ON_HOLD", "CANCELLED"],
  CUSTOMER_FEEDBACK_RECEIVED: [],
  REVISION_REQUESTED: ["ON_HOLD", "CANCELLED"],
  ON_HOLD: ["CANCELLED"],
  APPROVED: [],
  REJECTED: [],
  CANCELLED: [],
};

/**
 * Internal QC gate (2026-09-24) — the three transitions that move a sample
 * into, out of (pass), or out of (send back) the INTERNAL_QC stage require a
 * real QC sign-off (`qc.edit`), not the same generic `sampling.edit` every
 * other non-terminal transition uses. Before this, a Merchandiser (who only
 * ever holds `sampling.edit`, never `sampling.approve`/`reject`) could
 * single-handedly walk a sample from Requested all the way to Submitted to
 * Customer, including moving it into and out of "Internal QC" — nobody else
 * ever had to sign off on that stage, and QC_MANAGER's own real `qc.*`
 * grants had zero wiring into Sampling at all. This is the first time the
 * `qc` module is actually consulted by the Sampling workflow. Scoped
 * narrowly to exactly these three transitions — Hold/Cancel from INTERNAL_QC
 * stay on the plain `sampling.edit` gate, since those are administrative
 * actions, not a QC pass/fail decision.
 */
const INTERNAL_QC_GATED_TRANSITIONS: [SampleStatus, SampleStatus][] = [
  ["IN_DEVELOPMENT", "INTERNAL_QC"],
  ["INTERNAL_QC", "SUBMITTED_TO_CUSTOMER"],
  ["INTERNAL_QC", "IN_DEVELOPMENT"],
];

function isInternalQcGatedTransition(from: SampleStatus, to: SampleStatus): boolean {
  return INTERNAL_QC_GATED_TRANSITIONS.some(([f, t]) => f === from && t === to);
}

export interface SampleRequestListFilters {
  customerId?: string;
  buyerId?: string;
  productId?: string;
  styleSearch?: string;
  /** Raw comma-separated status list from the querystring — see listSampleRequests. */
  status?: string;
  sampleType?: SampleType;
  requestedByUserId?: string;
  dateFrom?: string;
  dateTo?: string;
  colorId?: string;
}

/** Tenant-scope check on a Color/Size master id before it's ever written to
 * a SampleRequest — same discipline as customer/product's own checks just
 * below in createSampleRequest. */
async function assertColorBelongsToCompany(companyId: string, colorId: string) {
  const color = await LookupRepository.color.findFirst({ where: { id: colorId, companyId } });
  if (!color) throw new BusinessRuleError("NOT_FOUND", "Color not found.", { id: colorId });
}

async function assertSizeBelongsToCompany(companyId: string, sizeId: string) {
  const size = await LookupRepository.size.findFirst({ where: { id: sizeId, companyId } });
  if (!size) throw new BusinessRuleError("NOT_FOUND", "Size not found.", { id: sizeId });
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
    ...(filters.productId ? { productId: filters.productId } : {}),
    ...(filters.requestedByUserId ? { requestedByUserId: filters.requestedByUserId } : {}),
    ...(filters.sampleType ? { sampleType: filters.sampleType } : {}),
    ...(statuses.length > 0 ? { status: { in: statuses } } : {}),
    ...(filters.colorId ? { colorId: filters.colorId } : {}),
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

export async function createSampleRequest(
  actor: ActorContext,
  input: SampleRequestInput,
  // Set only by duplicateSampleRequest() ("Copy Design") — every other
  // caller (the create route, Buyer Enquiry conversion, AI Garment Flow's
  // own sample creation) omits this and gets exactly the same behavior as
  // before this option existed.
  options?: { copiedFromRequestId?: string }
) {
  // Tenant-scoped, matching the discipline every other create* function in
  // this codebase follows (Sales/Purchase Order) — without this, a
  // customerId/buyerId/productId from another company would pass straight
  // through, and findByIdWithDetails's unrestricted `include` would then
  // return that tenant's full Customer/Buyer/Product record on every
  // subsequent read of this sample request (confirmed cross-tenant
  // disclosure, fixed here).
  const customer = await CustomerRepository.findByIdWithBuyers(actor.companyId, input.customerId);
  if (!customer) throw new BusinessRuleError("NOT_FOUND", "Customer not found.", { id: input.customerId });

  if (input.buyerId && !customer.buyers.some((b) => b.id === input.buyerId)) {
    throw new BusinessRuleError("NOT_FOUND", "Buyer not found for this customer.", { id: input.buyerId });
  }

  if (input.productId) {
    const product = await ProductRepository.findAnyById(actor.companyId, input.productId);
    if (!product) throw new BusinessRuleError("NOT_FOUND", "Style not found.", { id: input.productId });
  }

  if (input.colorId) await assertColorBelongsToCompany(actor.companyId, input.colorId);
  if (input.sizeId) await assertSizeBelongsToCompany(actor.companyId, input.sizeId);

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
    colorId: input.colorId || null,
    sizeId: input.sizeId || null,
    requestedByUserId: actor.userId,
    requestDate: new Date(input.requestDate),
    targetSubmissionDate: input.targetSubmissionDate ? new Date(input.targetSubmissionDate) : null,
    status: "REQUESTED",
    currentVersionNumber: 0,
    copiedFromRequestId: options?.copiedFromRequestId ?? null,
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

/**
 * "Copy Design" — clones an existing Sample Request's header plus its
 * current version's Tech Pack notes and materials into a brand-new Sample
 * Request, which starts its own workflow fresh from REQUESTED (never
 * inherits the source's status — a copy is a new development attempt and
 * needs its own approval cycle, even if the source was already Approved).
 * Deliberately orchestrates the existing, unchanged createSampleRequest() /
 * addSampleVersion() / addSampleMaterial() rather than re-implementing their
 * validation — the same pattern already used by
 * convertEnquiryLineToSampleRequest() and AI Garment Flow's own
 * createSampleRequestFromProject().
 *
 * Deliberately NOT copied (per explicit user scope): images/attachments —
 * each Attachment's storageKey points at one physical file on disk, and
 * pointing two Attachment rows at the same file would leave the copy's
 * image silently broken the day someone deletes the original's; rate/GST
 * pricing, damaged quantity/reason, costing lock, approvals, and comments —
 * none of that describes a sample that hasn't been made yet. Style, Sample
 * Type, and Color/Size ARE copied (this action is scoped to one style's own
 * Designs list); Customer/Buyer are copied too, but — per explicit request —
 * only as a starting default: `input.customerId`/`buyerId` are exactly what
 * the "Copy Design" popup lets the user change before creating the clone.
 */
export async function duplicateSampleRequest(
  actor: ActorContext,
  sourceId: string,
  input: { styleName: string; customerId: string; buyerId: string | null }
) {
  const source = await SampleRequestRepository.findAnyById(actor.companyId, sourceId);
  if (!source) throw new BusinessRuleError("NOT_FOUND", "Sample request not found.", { id: sourceId });

  const created = await createSampleRequest(
    actor,
    {
      customerId: input.customerId,
      buyerId: input.buyerId ?? "",
      productId: source.productId ?? "",
      styleName: input.styleName,
      // Nullable at the DB level for legacy rows predating this field
      // (see the schema.prisma comment) — "OTHER" is a real, valid
      // SAMPLE_TYPES value, never a fabricated one.
      sampleType: source.sampleType ?? "OTHER",
      colorId: source.colorId ?? "",
      sizeId: source.sizeId ?? "",
      requestDate: new Date().toISOString().slice(0, 10),
      targetSubmissionDate: "",
    },
    { copiedFromRequestId: source.id }
  );

  const sourceVersion = await SampleVersionRepository.findLatest(sourceId);
  if (sourceVersion) {
    const { version } = await addSampleVersion(
      actor,
      created.id,
      { techPackNotes: sourceVersion.techPackNotes ?? "" },
      { seedFromStyleBom: false }
    );

    const sourceMaterials = await SampleMaterialRepository.findByVersionId(sourceVersion.id);
    for (const m of sourceMaterials) {
      await addSampleMaterial(actor, version.id, {
        materialId: m.materialId,
        plannedQuantity: Number(m.plannedQuantity),
        uomId: m.uomId ?? "",
        colorId: m.colorId ?? "",
        dyeId: m.dyeId ?? "",
        notes: m.notes ?? "",
      });
    }
  }

  return created;
}

// Color/Size are deliberately editable at any status, not just non-terminal
// ones — a client that only sent a photo often confirms/changes the color+
// size well after the sample is physically made, sometimes even after
// approval. Both are real Color/Size master FKs (2026-09-15) — re-verified
// tenant-scoped here rather than trusted from the caller.
export async function updateSampleRequestColor(
  actor: ActorContext,
  id: string,
  input: { colorId: string | null; sizeId: string | null }
) {
  const existing = await SampleRequestRepository.findAnyById(actor.companyId, id);
  if (!existing) throw new BusinessRuleError("NOT_FOUND", "Sample request not found.", { id });

  if (input.colorId) await assertColorBelongsToCompany(actor.companyId, input.colorId);
  if (input.sizeId) await assertSizeBelongsToCompany(actor.companyId, input.sizeId);

  const updated = await SampleRequestRepository.update(id, { colorId: input.colorId, sizeId: input.sizeId });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "sample_requests",
    recordId: id,
    action: "UPDATE",
    oldValues: { colorId: existing.colorId, sizeId: existing.sizeId },
    newValues: { colorId: updated.colorId, sizeId: updated.sizeId },
  });

  return updated;
}

// Same "editable at any status" reasoning as color above — a Design Name
// entered early (often copied from a Buyer Enquiry line's own free-text
// placeholder, before the buyer had confirmed anything real) routinely
// needs correcting later. Never touches productId/Convert-to-Style's own
// draft — that flow re-prefills from this field fresh each time it opens.
export async function updateSampleRequestDesignName(actor: ActorContext, id: string, styleName: string) {
  const existing = await SampleRequestRepository.findAnyById(actor.companyId, id);
  if (!existing) throw new BusinessRuleError("NOT_FOUND", "Sample request not found.", { id });

  const updated = await SampleRequestRepository.update(id, { styleName });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "sample_requests",
    recordId: id,
    action: "UPDATE",
    oldValues: { styleName: existing.styleName },
    newValues: { styleName: updated.styleName },
  });

  return updated;
}

/**
 * Designates one already-uploaded image (relatedModule SAMPLE_REQUEST,
 * relatedRecordId = this request) as the cover/main image — same shape and
 * "never trust a client-supplied FK" discipline as Products'
 * setProductMainImage(). `attachmentId: null` explicitly clears it.
 */
export async function setSampleRequestMainImage(actor: ActorContext, id: string, attachmentId: string | null) {
  const existing = await SampleRequestRepository.findAnyById(actor.companyId, id);
  if (!existing) throw new BusinessRuleError("NOT_FOUND", "Sample request not found.", { id });

  if (attachmentId) {
    const attachment = await getAttachmentMetadata(actor.companyId, attachmentId);
    if (attachment.relatedModule !== "SAMPLE_REQUEST" || attachment.relatedRecordId !== id) {
      throw new BusinessRuleError("NOT_FOUND", "Attachment not found.", { id: attachmentId });
    }
  }

  const updated = await SampleRequestRepository.update(id, { mainImageAttachmentId: attachmentId });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "sample_requests",
    recordId: id,
    action: "UPDATE",
    oldValues: { mainImageAttachmentId: existing.mainImageAttachmentId },
    newValues: { mainImageAttachmentId: updated.mainImageAttachmentId },
  });

  return updated;
}

export async function transitionSampleStatus(actor: ActorContext, id: string, targetStatus: SampleStatus) {
  const before = await SampleRequestRepository.findAnyById(actor.companyId, id);
  if (!before) throw new BusinessRuleError("NOT_FOUND", "Sample request not found.", { id });

  // The real, authoritative check — deliberately here (not just the route),
  // same reasoning as recordSampleApproval()'s own self-approval-guarded
  // check: it can't be bypassed by any future second caller, and it needs
  // `before.status` (the CURRENT stage), which only exists after this fetch.
  await PermissionService.assert(
    actor.userId,
    isInternalQcGatedTransition(before.status, targetStatus) ? "qc" : "sampling",
    "edit"
  );

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

  const versionStatus = VERSION_STATUS_BY_HEADER_STATUS[targetStatus];
  if (versionStatus) {
    const currentVersion = await SampleVersionRepository.findLatest(id);
    // Only touch a still-live version — never overwrite a terminal one
    // (APPROVED/REJECTED/SUPERSEDED), which this generic transition has no
    // business changing.
    if (currentVersion && !["APPROVED", "REJECTED", "SUPERSEDED"].includes(currentVersion.status)) {
      await SampleVersionRepository.update(currentVersion.id, { status: versionStatus });
    }
  }

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
export async function addSampleVersion(
  actor: ActorContext,
  sampleRequestId: string,
  input: SampleVersionInput,
  // Set to false only by duplicateSampleRequest() ("Copy Design"), which is
  // about to populate this brand-new version's materials itself (copied
  // from the source design) — without this, the auto-seed-from-Style-BOM
  // step below would run first and leave stray "Copied from Style BOM"
  // lines mixed in alongside the copied design's own materials. The route
  // handler and every other existing caller omit this and get the original,
  // unchanged auto-seed behavior.
  options?: { seedFromStyleBom?: boolean }
) {
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

  // Version 1 of a sample raised against an EXISTING Style starts pre-filled
  // from that Style's own real, approved BOM — a starting point only, never
  // a live link: from here on the sample's own material list is edited
  // freely (actual sampling usage routinely differs from the plan) and the
  // Style's real Bom/BomItem rows are never written back to by anything in
  // this module (see updateSampleBomMaterials below). A brand-new style
  // (productId null) or a style with no approved BOM yet simply starts empty,
  // exactly as before this feature existed.
  if (isFirstVersion && request.productId && (options?.seedFromStyleBom ?? true)) {
    await copyStyleBomIntoSampleVersion(actor, version.id, request.productId);
  }

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
 * One-time starting point, not a live sync: copies every line of the Style's
 * currently APPROVED BOM version into fresh SampleMaterial rows on the given
 * (brand-new, empty) sample version. Silently does nothing if the style has
 * no BOM yet, or no version of it has ever been approved — the sample simply
 * starts empty, matching this function's behavior before this feature
 * existed. `plannedQuantity` is seeded from the BOM's own `quantityPerUnit`
 * (a sample is normally made 1 piece at a time; wastage% isn't copied since
 * SampleMaterial has no such column) — every value is freely editable
 * afterward via the ordinary Add/Edit Material actions or the "Update BOM"
 * bulk-confirm action below.
 */
async function copyStyleBomIntoSampleVersion(actor: ActorContext, sampleVersionId: string, productId: string) {
  const bom = await BomRepository.findByProductId(actor.companyId, productId);
  const approvedItems = bom?.approvedVersion?.items ?? [];
  if (approvedItems.length === 0) return;

  await SampleMaterialRepository.createMany(
    approvedItems.map((item) => ({
      sampleVersionId,
      materialId: item.materialId,
      plannedQuantity: item.quantityPerUnit,
      uomId: item.uomId,
      colorId: item.colorId,
      notes: item.notes ? `From Style BOM: ${item.notes}` : "Copied from Style BOM",
    }))
  );

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "sample_materials",
    recordId: sampleVersionId,
    action: "CREATE",
    newValues: { copiedFromBomId: bom!.id, materialCount: approvedItems.length },
  });
}

/**
 * "Update BOM" — bulk-confirms the actual raw-material quantities used
 * during sampling, once sampling is complete (APPROVED). Edits only the
 * quantity of already-existing SampleMaterial lines on the current version
 * (never adds/removes a line, and never touches material/color/unit
 * identity — that stays the ordinary Add/Edit Material actions' job).
 * Deliberately does NOT write anything back to the Style's real Bom/BomItem
 * — per the user's own explicit instruction, only the sample's own material
 * list ("the sample's BOM") is updated; the Style master is untouched.
 */
export async function updateSampleBomMaterials(actor: ActorContext, sampleRequestId: string, input: SampleBomUpdateInput) {
  const request = await SampleRequestRepository.findAnyById(actor.companyId, sampleRequestId);
  if (!request) throw new BusinessRuleError("NOT_FOUND", "Sample request not found.", { id: sampleRequestId });

  if (request.status !== "APPROVED") {
    throw new BusinessRuleError(
      "INVALID_STATE_TRANSITION",
      `The BOM can only be updated once sampling is complete (Approved), not while "${request.status}".`,
      { currentStatus: request.status }
    );
  }

  const latest = await SampleVersionRepository.findLatest(sampleRequestId);
  if (!latest) throw new BusinessRuleError("NOT_FOUND", "This sample has no version to update.", { id: sampleRequestId });

  const existingMaterials = await SampleMaterialRepository.findByVersionId(latest.id);
  const existingById = new Map(existingMaterials.map((m) => [m.id, m]));

  for (const update of input.updates) {
    if (!existingById.has(update.sampleMaterialId)) {
      throw new BusinessRuleError("NOT_FOUND", "One of these materials doesn't belong to this sample's current version.", {
        sampleMaterialId: update.sampleMaterialId,
      });
    }
  }

  await prisma.$transaction(async (tx) => {
    for (const update of input.updates) {
      await SampleMaterialRepository.updatePlannedQuantityInTx(tx, update.sampleMaterialId, update.plannedQuantity);
    }
    // Never blocked by a costing lock — an approved sample's costing is very
    // often already locked, and this action is about correcting raw-material
    // usage, not re-opening costing; the rollup simply doesn't apply if locked.
    await recalculateSampleVersionCosting(tx, latest.id, { throwIfBlocked: false });
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "sample_materials",
    recordId: latest.id,
    action: "UPDATE",
    oldValues: { quantities: input.updates.map((u) => ({ id: u.sampleMaterialId, before: existingById.get(u.sampleMaterialId)?.plannedQuantity })) },
    newValues: { quantities: input.updates },
  });

  return SampleMaterialRepository.findByVersionId(latest.id);
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

/**
 * Edits an already-added material line's own core fields — the one gap
 * addSampleMaterial()'s merge-on-add design didn't cover: correcting a
 * mis-picked material/color/shade/unit, or setting an absolute quantity
 * (re-adding only ever adds to the existing quantity, it can't set a lower
 * one or clear notes to empty). Deliberately a plain absolute set, not a
 * second merge check against MATERIAL_MERGE_KEY_FIELDS — editing one line to
 * accidentally collide with a second, already-distinct line is a rare enough
 * edge case that it isn't worth this action's own merge logic; the two rows
 * would simply coexist as before.
 */
export async function updateSampleMaterial(actor: ActorContext, sampleMaterialId: string, input: SampleMaterialInput) {
  const material = await SampleMaterialRepository.findWithRequestOwner(sampleMaterialId);
  if (!material || material.sampleVersion.sampleRequest.companyId !== actor.companyId) {
    throw new BusinessRuleError("NOT_FOUND", "Sample material not found.", { id: sampleMaterialId });
  }

  const updated = await SampleMaterialRepository.update(sampleMaterialId, {
    materialId: input.materialId,
    plannedQuantity: input.plannedQuantity,
    uomId: input.uomId || null,
    colorId: input.colorId || null,
    dyeId: input.dyeId || null,
    notes: input.notes || null,
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "sample_materials",
    recordId: sampleMaterialId,
    action: "UPDATE",
    oldValues: {
      materialId: material.materialId,
      plannedQuantity: material.plannedQuantity,
      uomId: material.uomId,
      colorId: material.colorId,
      dyeId: material.dyeId,
    },
    newValues: {
      materialId: updated.materialId,
      plannedQuantity: updated.plannedQuantity,
      uomId: updated.uomId,
      colorId: updated.colorId,
      dyeId: updated.dyeId,
    },
  });

  // Same non-blocking reasoning as addSampleMaterial() — editing quantity
  // must keep a since-priced line's rollup in sync, but must never itself be
  // blocked by a costing lock (rate isn't part of this payload at all).
  await recalculateSampleVersionCosting(prisma, material.sampleVersionId, { throwIfBlocked: false });

  return SampleMaterialRepository.findByVersionId(material.sampleVersionId);
}

/**
 * Permanently drops one line from a version's material list — e.g. a
 * material auto-copied in from the Style's BOM (see addSampleVersion) that
 * this particular sample doesn't actually need. Unlike add/edit (which never
 * block on a costing lock, since a lock only ever protects the *priced*
 * numbers), removing a line is a structural change to what's being costed at
 * all — same "blocked while locked" reasoning as deleteSampleOtherCharge.
 */
export async function removeSampleMaterial(actor: ActorContext, sampleMaterialId: string) {
  const material = await SampleMaterialRepository.findWithRequestOwner(sampleMaterialId);
  if (!material || material.sampleVersion.sampleRequest.companyId !== actor.companyId) {
    throw new BusinessRuleError("NOT_FOUND", "Sample material not found.", { id: sampleMaterialId });
  }

  await prisma.$transaction(async (tx) => {
    await SampleMaterialRepository.delete(tx, sampleMaterialId);
    await recalculateSampleVersionCosting(tx, material.sampleVersionId, { throwIfBlocked: true });
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "sample_materials",
    recordId: sampleMaterialId,
    action: "DELETE",
    oldValues: { materialId: material.materialId, plannedQuantity: material.plannedQuantity },
  });

  return SampleMaterialRepository.findByVersionId(material.sampleVersionId);
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

  // The real, self-approval-guarded check — moved here from the route so it
  // can never be bypassed by a future second caller that invokes this
  // function directly (the route still does a coarse permission check
  // before this, purely for early rejection). APPROVED needs "approve"
  // (self-approval guarded); REJECTED/REVISION_REQUESTED needs "reject",
  // deliberately not self-approval-guarded — matches the pre-existing route
  // logic exactly, just relocated.
  const approvalAction = input.decision === "APPROVED" ? "approve" : "reject";
  await PermissionService.assert(actor.userId, "sampling", approvalAction, {
    createdBy: request.requestedByUserId,
  });

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
    customerContactPhone: input.customerContactPhone || null,
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

/**
 * "Mark as Approved (Skip Development)" — a deliberate shortcut for a copied
 * design that only needed a materials/costing tweak, not a real physical
 * re-sample/re-QC/re-submission-to-customer cycle (2026-09-25, explicit
 * request). Only reachable from TECH_PACK_READY, right where the ordinary
 * "Start Development" action lives — this is NOT wired into
 * ALLOWED_TRANSITIONS, same precedent as recordSampleApproval()'s own
 * outcomes, since it's a distinct, dedicated action rather than a generic
 * status change. Gated on `sampling.approve` (self-approval-guarded, same
 * as the real Customer Decision "Approved" outcome) — deliberately NOT
 * `sampling.edit`, since this bypasses Development/Internal QC/Customer
 * Submission entirely and needs the same Management-level sign-off a real
 * approval would.
 */
export async function fastTrackApproveSample(actor: ActorContext, sampleRequestId: string, input: FastTrackApprovalInput) {
  const request = await SampleRequestRepository.findAnyById(actor.companyId, sampleRequestId);
  if (!request) throw new BusinessRuleError("NOT_FOUND", "Sample request not found.", { id: sampleRequestId });

  await PermissionService.assert(actor.userId, "sampling", "approve", {
    createdBy: request.requestedByUserId,
  });

  if (request.status !== "TECH_PACK_READY") {
    throw new BusinessRuleError(
      "INVALID_STATE_TRANSITION",
      `This sample can only be fast-tracked to Approved directly from Tech Pack Ready (skipping Development, Internal QC, and Customer Submission), not from ${request.status}.`,
      { from: request.status }
    );
  }

  const version = await SampleVersionRepository.findLatest(sampleRequestId);
  if (!version) {
    throw new BusinessRuleError(
      "NOT_FOUND",
      "This request has no version to approve — that shouldn't be possible at Tech Pack Ready.",
      { id: sampleRequestId }
    );
  }

  const decisionNotes = input.notes
    ? `Fast-tracked directly from Tech Pack Ready (Development, Internal QC, and Customer Submission skipped) — ${input.notes}`
    : "Fast-tracked directly from Tech Pack Ready (Development, Internal QC, and Customer Submission skipped).";

  const approval = await SampleApprovalRepository.create({
    sampleVersionId: version.id,
    decision: "APPROVED",
    decidedByUserId: actor.userId,
    customerContactName: null,
    customerContactPhone: null,
    decisionNotes,
  });

  await SampleVersionRepository.update(version.id, { status: "APPROVED", customerDecisionAt: new Date() });
  const updatedRequest = await SampleRequestRepository.update(sampleRequestId, { status: "APPROVED" });

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
