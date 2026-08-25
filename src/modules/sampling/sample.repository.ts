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
        requestedBy: { select: { id: true, fullName: true } },
      },
      ...args,
    }),

  count: (where: Prisma.SampleRequestWhereInput) => prisma.sampleRequest.count({ where }),

  findByIdWithDetails: (companyId: string, id: string) =>
    prisma.sampleRequest.findFirst({
      where: { id, companyId },
      include: {
        // A narrow `select`, not `customer: true` — see the identical fix
        // and rationale in sales-order.repository.ts.
        customer: { select: { id: true, name: true, code: true, country: true, defaultCurrencyCode: true } },
        buyer: true,
        product: true,
        requestedBy: { select: { id: true, fullName: true } },
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
      },
    }),

  findAnyById: (companyId: string, id: string) => prisma.sampleRequest.findFirst({ where: { id, companyId } }),

  create: (data: Prisma.SampleRequestUncheckedCreateInput) => prisma.sampleRequest.create({ data }),

  update: (id: string, data: Prisma.SampleRequestUncheckedUpdateInput) =>
    prisma.sampleRequest.update({ where: { id }, data }),
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
};

export const SampleCommentRepository = {
  create: (data: Prisma.SampleCommentUncheckedCreateInput) => prisma.sampleComment.create({ data }),
};
