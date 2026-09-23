import { prisma } from "@/core/db/client";
import type { Prisma } from "@prisma/client";

export const SampleRequestRepository = {
  findMany: (where: Prisma.SampleRequestWhereInput, args: Omit<Prisma.SampleRequestFindManyArgs, "where">) =>
    prisma.sampleRequest.findMany({
      where,
      include: {
        customer: { select: { id: true, name: true } },
        buyer: { select: { id: true, name: true } },
        product: { select: { id: true, styleName: true, styleCode: true } },
        color: { select: { id: true, name: true, hexValue: true } },
        size: { select: { id: true, name: true } },
        requestedBy: { select: { id: true, fullName: true } },
        // The current (highest version number) version's own costing +
        // decision-date only — callers like the Sales Order form's "Linked
        // Sample" picker need a quick price reference (not the full costing/
        // materials/approvals detail already served by findByIdWithDetails),
        // and the Styles → Designs list needs customerDecisionAt as this
        // record's real "Approved Date" (SampleRequest itself has no such
        // column — the decision date lives per-version).
        versions: {
          orderBy: { versionNumber: "desc" },
          take: 1,
          select: { estimatedCostPerUnit: true, customerDecisionAt: true },
        },
      },
      ...args,
    }),

  count: (where: Prisma.SampleRequestWhereInput) => prisma.sampleRequest.count({ where }),

  /** Top N request-number matches for this company — backs the Topbar Global
   * Search's Sample Requests group. */
  searchTop: (companyId: string, term: string, limit: number) =>
    prisma.sampleRequest.findMany({
      where: { companyId, requestNumber: { contains: term, mode: "insensitive" as const } },
      select: { id: true, requestNumber: true, customer: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: limit,
    }),

  findByIdWithDetails: (companyId: string, id: string) =>
    prisma.sampleRequest.findFirst({
      where: { id, companyId },
      include: {
        // A narrow `select`, not `customer: true` — see the identical fix
        // and rationale in sales-order.repository.ts.
        customer: { select: { id: true, name: true, code: true, country: true, defaultCurrencyCode: true } },
        buyer: true,
        product: true,
        color: { select: { id: true, name: true, hexValue: true } },
        size: { select: { id: true, name: true } },
        requestedBy: { select: { id: true, fullName: true } },
        // Set once by duplicateSampleRequest() ("Copy Design") — purely for
        // traceability, shown as a read-only "Copied from" link on the
        // detail page. Null for every ordinarily-created request.
        copiedFrom: { select: { id: true, requestNumber: true, styleName: true } },
        versions: {
          orderBy: { versionNumber: "desc" },
          include: {
            createdBy: { select: { id: true, fullName: true } },
            costingLockedBy: { select: { id: true, fullName: true } },
            materials: {
              include: { material: { select: { id: true, styleName: true, styleCode: true } }, uom: true, color: true, dye: true },
            },
            otherCharges: { orderBy: { createdAt: "asc" } },
            approvals: {
              orderBy: { decidedAt: "desc" },
              include: { decidedBy: { select: { id: true, fullName: true } } },
            },
          },
        },
        comments: {
          orderBy: { createdAt: "asc" },
          include: { author: { select: { id: true, fullName: true } } },
        },
        // Read-only — the buyer's own Target Price, captured once at Buyer
        // Enquiry intake and never re-entered in Sampling itself. Only ever
        // set for a sample that actually originated from a converted
        // enquiry line (see BuyerEnquiryLine.sampleRequestId's own schema
        // comment) — null for every directly-created sample, same as every
        // other optional traceability relation on this model.
        buyerEnquiryLine: {
          select: { targetUnitPrice: true, buyerEnquiry: { select: { id: true, enquiryNumber: true } } },
        },
      },
    }),

  findAnyById: (companyId: string, id: string) => prisma.sampleRequest.findFirst({ where: { id, companyId } }),

  create: (data: Prisma.SampleRequestUncheckedCreateInput) => prisma.sampleRequest.create({ data }),

  update: (id: string, data: Prisma.SampleRequestUncheckedUpdateInput) =>
    prisma.sampleRequest.update({ where: { id }, data }),

  /** Called just before deleting an attachment — if it's currently a
   * request's designated main image, clears the pointer first so it never
   * dangles. */
  clearMainImageIfMatches: (companyId: string, attachmentId: string) =>
    prisma.sampleRequest.updateMany({ where: { companyId, mainImageAttachmentId: attachmentId }, data: { mainImageAttachmentId: null } }),
};

export const SampleVersionRepository = {
  findLatest: (sampleRequestId: string) =>
    prisma.sampleVersion.findFirst({ where: { sampleRequestId }, orderBy: { versionNumber: "desc" } }),

  findById: (id: string) => prisma.sampleVersion.findUnique({ where: { id } }),

  /** Used by route handlers to resolve the requester before a permission check that needs self-approval context. */
  findWithRequestOwner: (id: string) =>
    prisma.sampleVersion.findUnique({
      where: { id },
      include: { sampleRequest: { select: { companyId: true, requestedByUserId: true } } },
    }),

  create: (data: Prisma.SampleVersionUncheckedCreateInput) => prisma.sampleVersion.create({ data }),

  update: (id: string, data: Prisma.SampleVersionUncheckedUpdateInput) =>
    prisma.sampleVersion.update({ where: { id }, data }),

  /** Reads inside the caller's transaction — used by recalculateSampleVersionCosting so its read of the current row is consistent with the guarded write that follows. */
  findByIdTx: (tx: Prisma.TransactionClient, id: string) => tx.sampleVersion.findUnique({ where: { id } }),

  /**
   * Guards the write so a locked or superseded version's costing can never be
   * silently overwritten — both the costing-rollup write and the lock action
   * itself share this exact precondition (currently unlocked, not
   * superseded), so one function covers both. `count === 0` means the guard
   * failed; the caller decides whether that's fatal (dedicated costing
   * endpoints) or tolerable (addSampleMaterial, which must never be blocked
   * by a costing lock — see sample.service.ts).
   */
  updateCostingIfUnlocked: (tx: Prisma.TransactionClient, id: string, data: Prisma.SampleVersionUncheckedUpdateInput) =>
    tx.sampleVersion.updateMany({
      where: { id, isCostingLocked: false, status: { not: "SUPERSEDED" } },
      data,
    }),

  /** Unlocking requires the opposite precondition — currently locked, not superseded. */
  updateCostingIfLocked: (tx: Prisma.TransactionClient, id: string, data: Prisma.SampleVersionUncheckedUpdateInput) =>
    tx.sampleVersion.updateMany({
      where: { id, isCostingLocked: true, status: { not: "SUPERSEDED" } },
      data,
    }),
};

export const SampleMaterialRepository = {
  createMany: (data: Prisma.SampleMaterialCreateManyInput[]) => prisma.sampleMaterial.createMany({ data }),

  findByVersionId: (sampleVersionId: string) =>
    prisma.sampleMaterial.findMany({
      where: { sampleVersionId },
      include: { material: true, uom: true, color: true, dye: true },
    }),

  /**
   * Used to decide whether a repeat "add material" is the same line (merge
   * quantities) or a genuinely distinct one (e.g. same material, different
   * color/spec/usage — create a separate row). `mergeKey` is built by
   * `buildMaterialMergeKey()` in sample.service.ts — this function just
   * applies whatever attributes that key contains, so it never needs to
   * change as more distinguishing attributes are added.
   */
  findByVersionAndMergeKey: (sampleVersionId: string, mergeKey: Prisma.SampleMaterialWhereInput) =>
    prisma.sampleMaterial.findFirst({ where: { sampleVersionId, ...mergeKey } }),

  /** Used to verify tenant ownership before a scoped update (e.g. damage recording) — same pattern as SampleVersionRepository.findWithRequestOwner. */
  findWithRequestOwner: (id: string) =>
    prisma.sampleMaterial.findUnique({
      where: { id },
      include: { sampleVersion: { include: { sampleRequest: { select: { companyId: true } } } } },
    }),

  update: (id: string, data: Prisma.SampleMaterialUncheckedUpdateInput) =>
    prisma.sampleMaterial.update({ where: { id }, data }),

  /** Permanently removes one line, inside the caller's transaction — see
   * removeSampleMaterial() in sample.service.ts, which recomputes costing in
   * the same transaction so a removed priced line's cost drops out too. */
  delete: (tx: Prisma.TransactionClient, id: string) => tx.sampleMaterial.delete({ where: { id } }),

  /**
   * Sets/clears rate+GST on one line, inside the caller's transaction.
   * Deliberately unconditional (not guarded directly) — the lock/supersede
   * guard lives entirely on the SampleVersion recompute write that follows
   * it in the same transaction, which rolls this update back too if the
   * guard fails. Two guards on two tables would be redundant and harder to
   * reason about than one guard + a transaction boundary.
   */
  updateCosting: (tx: Prisma.TransactionClient, id: string, data: Prisma.SampleMaterialUncheckedUpdateInput) =>
    tx.sampleMaterial.update({ where: { id }, data }),

  /** Reads inside the caller's transaction, for use by recalculateSampleVersionCosting. */
  findByVersionIdTx: (tx: Prisma.TransactionClient, sampleVersionId: string) =>
    tx.sampleMaterial.findMany({
      where: { sampleVersionId },
      select: { plannedQuantity: true, rate: true, gstPercentage: true },
    }),

  /** Sets an absolute plannedQuantity on one line, inside the caller's
   * transaction — used by updateSampleBomMaterials ("Update BOM"), which
   * bulk-confirms actual raw-material usage together with a costing
   * recompute in one transaction. */
  updatePlannedQuantityInTx: (tx: Prisma.TransactionClient, id: string, plannedQuantity: number) =>
    tx.sampleMaterial.update({ where: { id }, data: { plannedQuantity } }),

  /**
   * The current (highest version number) version's materials, shaped like
   * bom.repository.ts's own ITEMS_INCLUDE (material.baseUom included) so
   * mrp.service.ts's UOM-conversion code can treat a sample's material list
   * as an alternate, interchangeable BOM-explosion source — used whenever a
   * Sales Order line or Production Order has a linked Sample instead of
   * relying on the Style's own real Bom/BomItem rows.
   */
  findLatestVersionMaterialsForRequirement: async (sampleRequestId: string) => {
    const latest = await prisma.sampleVersion.findFirst({
      where: { sampleRequestId },
      orderBy: { versionNumber: "desc" },
      select: { id: true },
    });
    if (!latest) return [];

    return prisma.sampleMaterial.findMany({
      where: { sampleVersionId: latest.id },
      select: {
        materialId: true,
        plannedQuantity: true,
        uomId: true,
        colorId: true,
        dyeId: true,
        uom: { select: { id: true, code: true, name: true, baseUnitId: true, conversionFactor: true } },
        material: {
          select: {
            id: true,
            styleName: true,
            styleCode: true,
            baseUomId: true,
            baseUom: { select: { id: true, name: true, code: true, baseUnitId: true, conversionFactor: true } },
            defaultSupplierId: true,
            unitCost: true,
          },
        },
      },
    });
  },

  /**
   * Effective BOM (2026-09-24) — the same shape as
   * findLatestVersionMaterialsForRequirement above, but batch-fetched for
   * several EXPLICIT SampleVersion ids (a Sales Order Line's own frozen
   * snapshot pointer, not "whatever is currently latest") and tagged with
   * each row's own sampleVersionId so the caller can group them back per
   * line. Used by the Effective BOM resolver only.
   */
  findManyByVersionIds: (sampleVersionIds: string[]) =>
    prisma.sampleMaterial.findMany({
      where: { sampleVersionId: { in: sampleVersionIds } },
      select: {
        sampleVersionId: true,
        materialId: true,
        plannedQuantity: true,
        uomId: true,
        colorId: true,
        dyeId: true,
        uom: { select: { id: true, code: true, name: true, baseUnitId: true, conversionFactor: true } },
        material: {
          select: {
            id: true,
            styleName: true,
            styleCode: true,
            baseUomId: true,
            baseUom: { select: { id: true, name: true, code: true, baseUnitId: true, conversionFactor: true } },
            defaultSupplierId: true,
            unitCost: true,
          },
        },
      },
    }),

  /**
   * Materials shaped for generating a real Inventory Material Request from
   * this version — id (to attribute a validation error to the right line),
   * plannedQuantity/uomId/colorId/dyeId as actually entered, plus the
   * material's own baseUomId as a fallback source when a line's own uomId is
   * null (rare in practice — the Add Material UI already defaults it from
   * the material's base UOM — but the DB column stays nullable, so
   * createMaterialRequestFromSampleVersion stays defensive about it). See
   * material-request.service.ts.
   */
  findByVersionIdForMaterialRequest: (sampleVersionId: string) =>
    prisma.sampleMaterial.findMany({
      where: { sampleVersionId },
      select: {
        id: true,
        materialId: true,
        plannedQuantity: true,
        uomId: true,
        colorId: true,
        dyeId: true,
        material: { select: { styleName: true, baseUomId: true } },
      },
    }),
};

export const SampleOtherChargeRepository = {
  findByVersionId: (sampleVersionId: string) =>
    prisma.sampleOtherCharge.findMany({ where: { sampleVersionId }, orderBy: { createdAt: "asc" } }),

  /** Reads inside the caller's transaction, for use by recalculateSampleVersionCosting. */
  findByVersionIdTx: (tx: Prisma.TransactionClient, sampleVersionId: string) =>
    tx.sampleOtherCharge.findMany({ where: { sampleVersionId }, select: { amount: true } }),

  /** Used to verify tenant ownership before any scoped charge action — same join-through-version pattern as SampleMaterialRepository.findWithRequestOwner. */
  findWithVersionOwner: (id: string) =>
    prisma.sampleOtherCharge.findUnique({
      where: { id },
      include: { sampleVersion: { include: { sampleRequest: { select: { companyId: true } } } } },
    }),

  /** Unconditional, same reasoning as SampleMaterialRepository.updateCosting — the guard lives on the recompute write that follows in the same transaction. */
  create: (tx: Prisma.TransactionClient, data: Prisma.SampleOtherChargeUncheckedCreateInput) => tx.sampleOtherCharge.create({ data }),

  update: (tx: Prisma.TransactionClient, id: string, data: Prisma.SampleOtherChargeUncheckedUpdateInput) =>
    tx.sampleOtherCharge.update({ where: { id }, data }),

  delete: (tx: Prisma.TransactionClient, id: string) => tx.sampleOtherCharge.delete({ where: { id } }),
};

export const SampleApprovalRepository = {
  create: (data: Prisma.SampleApprovalUncheckedCreateInput) => prisma.sampleApproval.create({ data }),

  /** Every decision recorded across every version of a sample request, newest first — a minimal additive read, used by AI Garment Flow's own Buyer Comments summary (read-only, never mutating). */
  findAllForRequest: (sampleRequestId: string) =>
    prisma.sampleApproval.findMany({
      where: { sampleVersion: { sampleRequestId } },
      orderBy: { decidedAt: "desc" },
    }),
};

export const SampleCommentRepository = {
  create: (data: Prisma.SampleCommentUncheckedCreateInput) => prisma.sampleComment.create({ data }),

  /** Every comment across the whole sample request (any version), oldest first — a minimal additive read, used by AI Garment Flow's own Buyer Comments summary (read-only, never mutating). */
  findAllForRequest: (sampleRequestId: string) =>
    prisma.sampleComment.findMany({
      where: { sampleRequestId },
      orderBy: { createdAt: "asc" },
      include: { author: { select: { id: true, fullName: true } } },
    }),
};
