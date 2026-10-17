import { prisma } from "@/core/db/client";
import type { Prisma } from "@prisma/client";

const PRODUCTION_ORDER_INCLUDE = {
  product: { select: { id: true, styleName: true, styleCode: true } },
  bom: { select: { id: true } },
  salesOrderItem: {
    select: {
      id: true,
      salesOrder: { select: { id: true, orderNumber: true } },
      // For the "Sales Order data" reference block on the detail page —
      // ordered quantity and the color/size mix, never re-derived from a
      // second query.
      breakdown: {
        select: {
          orderedQuantity: true,
          productVariant: { select: { color: { select: { name: true } }, size: { select: { name: true } } } },
        },
      },
    },
  },
  requestedBy: { select: { id: true, fullName: true } },
  releasedToDispatchBy: { select: { id: true, fullName: true } },
} as const;

export const ProductionOrderRepository = {
  findMany: (where: Prisma.ProductionOrderWhereInput, args: Omit<Prisma.ProductionOrderFindManyArgs, "where">) =>
    prisma.productionOrder.findMany({ where, include: PRODUCTION_ORDER_INCLUDE, ...args }),

  count: (where: Prisma.ProductionOrderWhereInput) => prisma.productionOrder.count({ where }),

  /** Top N order-number matches for this company — backs the Topbar Global
   * Search's Production Orders group. */
  searchTop: (companyId: string, term: string, limit: number) =>
    prisma.productionOrder.findMany({
      where: { companyId, orderNumber: { contains: term, mode: "insensitive" as const } },
      select: { id: true, orderNumber: true, product: { select: { styleName: true } } },
      orderBy: { createdAt: "desc" },
      take: limit,
    }),

  findByIdWithDetails: (companyId: string, id: string) =>
    prisma.productionOrder.findFirst({
      where: { id, companyId },
      include: {
        ...PRODUCTION_ORDER_INCLUDE,
        lots: {
          orderBy: { createdAt: "asc" },
          include: { uom: { select: { id: true, code: true } }, currentStage: { select: { id: true, name: true } } },
        },
      },
    }),

  findAnyById: (companyId: string, id: string) => prisma.productionOrder.findFirst({ where: { id, companyId } }),

  create: (data: Prisma.ProductionOrderUncheckedCreateInput) => prisma.productionOrder.create({ data }),

  update: (id: string, data: Prisma.ProductionOrderUncheckedUpdateInput) =>
    prisma.productionOrder.update({ where: { id }, data }),

  /** Atomic per-order Lot-number suffix counter — a sub-sequence per order,
   * not routed through the shared document-numbering service. */
  incrementLotSequenceInTx: (tx: Prisma.TransactionClient, id: string) =>
    tx.productionOrder.update({ where: { id }, data: { nextLotSequence: { increment: 1 } }, select: { nextLotSequence: true } }),
};

const LOT_INCLUDE = {
  uom: { select: { id: true, code: true, name: true } },
  currentStage: { select: { id: true, name: true, code: true } },
} as const;

export const LotRepository = {
  findByProductionOrderId: (productionOrderId: string) =>
    prisma.lot.findMany({ where: { productionOrderId }, include: LOT_INCLUDE, orderBy: { createdAt: "asc" } }),

  findAnyById: (companyId: string, id: string) => prisma.lot.findFirst({ where: { id, companyId }, include: LOT_INCLUDE }),

  findByIdWithDetails: (companyId: string, id: string) =>
    prisma.lot.findFirst({
      where: { id, companyId },
      include: {
        ...LOT_INCLUDE,
        variantBreakdown: {
          include: { productVariant: { select: { id: true, skuCode: true, color: { select: { name: true } }, size: { select: { name: true } } } } },
        },
        productionOrder: { select: { id: true, orderNumber: true, productId: true, product: { select: { styleName: true } } } },
        jobOrders: {
          orderBy: { createdAt: "asc" },
          include: {
            productionStage: {
              select: { id: true, name: true, code: true, sequence: true, isFinal: true, allowsExtraQuantity: true },
            },
            assignments: {
              orderBy: { assignedAt: "asc" },
              include: { employee: { select: { id: true, fullName: true, employeeCode: true } } },
            },
          },
        },
      },
    }),

  createInTx: (tx: Prisma.TransactionClient, data: Prisma.LotUncheckedCreateInput) => tx.lot.create({ data }),

  updateInTx: (tx: Prisma.TransactionClient, id: string, data: Prisma.LotUncheckedUpdateInput) =>
    tx.lot.update({ where: { id }, data }),

  /** Any JobOrder for this lot that isn't yet terminal — used to block
   * split/merge while the lot isn't "at rest" between stages. */
  countOpenJobOrders: (lotId: string) =>
    prisma.jobOrder.count({ where: { lotId, status: { notIn: ["COMPLETED", "CANCELLED"] } } }),
};

export const LotRelationRepository = {
  createManyInTx: (tx: Prisma.TransactionClient, rows: Prisma.LotRelationUncheckedCreateInput[]) =>
    tx.lotRelation.createMany({ data: rows }),

  /** Full genealogy in both directions — a plain recursive walk, no
   * materialized ancestry table. */
  findByParentOrChild: (lotId: string) =>
    prisma.lotRelation.findMany({
      where: { OR: [{ parentLotId: lotId }, { childLotId: lotId }] },
      include: {
        parentLot: { select: { id: true, lotNumber: true } },
        childLot: { select: { id: true, lotNumber: true } },
        performedBy: { select: { id: true, fullName: true } },
      },
      orderBy: { performedAt: "asc" },
    }),
};

const JOB_ORDER_INCLUDE = {
  productionStage: {
    select: { id: true, name: true, code: true, sequence: true, allowRework: true, isFinal: true, isActive: true, allowsExtraQuantity: true },
  },
  productionLine: { select: { id: true, name: true } },
  lot: { select: { id: true, lotNumber: true, productionOrderId: true, branchId: true } },
  assignments: {
    include: { employee: { select: { id: true, fullName: true, employeeCode: true } } },
  },
  progressEntries: {
    orderBy: { createdAt: "desc" as const },
    include: {
      employee: { select: { id: true, fullName: true, employeeCode: true } },
      recordedBy: { select: { id: true, fullName: true } },
    },
  },
} as const;

export const JobOrderRepository = {
  findByLotId: (lotId: string) => prisma.jobOrder.findMany({ where: { lotId }, include: JOB_ORDER_INCLUDE, orderBy: { createdAt: "asc" } }),

  findAnyById: (companyId: string, id: string) => prisma.jobOrder.findFirst({ where: { id, companyId }, include: JOB_ORDER_INCLUDE }),

  /**
   * `SELECT ... FOR UPDATE` before the read — every caller of this function
   * (applyJobOrderQuantityDelta, guardedDecrementUnprocessedQuantity,
   * applyQcDispositionInTx) reads completed/rejected/damaged, computes new
   * values in application code, then writes literal new values via
   * updateInTx below — unlike every other accumulator in this codebase
   * (PO received/invoiced, Material Request issued, Dispatch dispatched,
   * StockBalance), which cap the write itself in an atomic `updateMany`
   * WHERE clause. A 3-column sum invariant can't be expressed that way, so
   * without a lock, two concurrent calls for the same jobOrderId could both
   * read the same pre-write snapshot, and the second writer's update would
   * silently discard the first's increment (a real lost-update race — the
   * job_orders_quantity_consistency_check CHECK constraint doesn't catch
   * this, since the final row can still satisfy the invariant after one
   * write is dropped). The row lock closes it: a second concurrent
   * transaction for the same id blocks here until the first commits, then
   * reads that transaction's final, already-updated values — never a stale
   * pre-lock snapshot. The `FOR UPDATE` result itself is discarded; the
   * typed `findUniqueOrThrow` immediately after gets the actual data.
   */
  findForGuardedUpdateInTx: async (tx: Prisma.TransactionClient, id: string) => {
    await tx.$queryRaw`SELECT id FROM job_orders WHERE id = ${id}::uuid FOR UPDATE`;
    return tx.jobOrder.findUniqueOrThrow({ where: { id } });
  },

  updateInTx: (tx: Prisma.TransactionClient, id: string, data: Prisma.JobOrderUncheckedUpdateInput) =>
    tx.jobOrder.update({ where: { id }, data }),

  createInTx: (tx: Prisma.TransactionClient, data: Prisma.JobOrderUncheckedCreateInput) => tx.jobOrder.create({ data }),

  /** Active (non-cancelled) JobOrders for a lot with no onward stage
   * transaction yet — the real "current position(s)" of a lot, always
   * derivable from the ledger rather than trusting Lot.currentStageId. */
  findOpenByLotId: (lotId: string) =>
    prisma.jobOrder.findMany({ where: { lotId, status: { notIn: ["CANCELLED"] } }, include: JOB_ORDER_INCLUDE }),

  listForWorklist: (where: Prisma.JobOrderWhereInput, args: Omit<Prisma.JobOrderFindManyArgs, "where">) =>
    prisma.jobOrder.findMany({
      where,
      include: {
        lot: { select: { id: true, lotNumber: true, productionOrder: { select: { id: true, orderNumber: true } } } },
        productionStage: { select: { id: true, name: true, code: true } },
        assignments: { select: { id: true, employee: { select: { fullName: true } } } },
      },
      ...args,
    }),

  countForWorklist: (where: Prisma.JobOrderWhereInput) => prisma.jobOrder.count({ where }),
};

export const JobOrderAssignmentRepository = {
  createInTx: (tx: Prisma.TransactionClient, data: Prisma.JobOrderAssignmentUncheckedCreateInput) =>
    tx.jobOrderAssignment.create({ data }),

  sumAssignedByJobOrderId: async (jobOrderId: string) => {
    const result = await prisma.jobOrderAssignment.aggregate({
      where: { jobOrderId, status: { not: "CANCELLED" } },
      _sum: { assignedQuantity: true },
    });
    return Number(result._sum.assignedQuantity ?? 0);
  },

  findAnyById: (id: string) => prisma.jobOrderAssignment.findUnique({ where: { id }, include: { jobOrder: true } }),

  updateInTx: (tx: Prisma.TransactionClient, id: string, data: Prisma.JobOrderAssignmentUncheckedUpdateInput) =>
    tx.jobOrderAssignment.update({ where: { id }, data }),

  /** Used by submitSelfProgressEntry to confirm the caller is actually
   * assigned to this job order — a worker can't log progress against work
   * nobody gave them. */
  findByJobOrderAndEmployee: (jobOrderId: string, employeeId: string) =>
    prisma.jobOrderAssignment.findFirst({ where: { jobOrderId, employeeId, status: { not: "CANCELLED" } } }),

  /** Every job order this employee is currently, actively assigned to —
   * backs the worker-facing "My Work" list. Stage-access filtering happens
   * in the service layer (getAllowedProductionStageIds), not here. */
  listActiveForEmployee: (companyId: string, employeeId: string) =>
    prisma.jobOrderAssignment.findMany({
      where: { employeeId, status: { not: "CANCELLED" }, jobOrder: { companyId, status: { notIn: ["CANCELLED"] } } },
      include: {
        jobOrder: {
          include: {
            productionStage: { select: { id: true, name: true, code: true } },
            lot: { select: { id: true, lotNumber: true } },
          },
        },
      },
      orderBy: { assignedAt: "desc" },
    }),
};

export const JobOrderProgressEntryRepository = {
  createInTx: (tx: Prisma.TransactionClient, data: Prisma.JobOrderProgressEntryUncheckedCreateInput) =>
    tx.jobOrderProgressEntry.create({ data }),

  /** No companyId column on this table — every caller must check
   * `entry.jobOrder.companyId === actor.companyId` itself before acting,
   * same manual tenant-scoping-via-joined-parent discipline used elsewhere
   * in this project (e.g. SampleVersionRepository.findWithRequestOwner). */
  findAnyById: (id: string) =>
    prisma.jobOrderProgressEntry.findUnique({
      where: { id },
      include: {
        jobOrder: {
          select: {
            id: true,
            companyId: true,
            productionStageId: true,
            productionStage: { select: { name: true, allowsExtraQuantity: true } },
          },
        },
      },
    }),

  findPendingForCompany: (companyId: string) =>
    prisma.jobOrderProgressEntry.findMany({
      where: { approvalStatus: "PENDING", jobOrder: { companyId } },
      include: {
        employee: { select: { id: true, fullName: true, employeeCode: true } },
        jobOrder: {
          select: {
            id: true,
            jobNumber: true,
            productionStage: { select: { name: true } },
            lot: { select: { lotNumber: true } },
          },
        },
      },
      orderBy: { createdAt: "asc" },
    }),

  /** Own submissions for the worker-facing "My Submitted Entries" list. */
  findByEmployeeAndSource: (employeeId: string, enteredBy: "SELF") =>
    prisma.jobOrderProgressEntry.findMany({
      where: { employeeId, enteredBy },
      include: {
        jobOrder: { select: { jobNumber: true, productionStage: { select: { name: true } } } },
      },
      orderBy: { createdAt: "desc" },
    }),

  update: (id: string, data: Prisma.JobOrderProgressEntryUncheckedUpdateInput) =>
    prisma.jobOrderProgressEntry.update({ where: { id }, data }),

  updateStatusConditional: (
    id: string,
    expectedStatus: "PENDING",
    data: Prisma.JobOrderProgressEntryUncheckedUpdateInput
  ) => prisma.jobOrderProgressEntry.updateMany({ where: { id, approvalStatus: expectedStatus }, data }),

  updateStatusConditionalInTx: (
    tx: Prisma.TransactionClient,
    id: string,
    expectedStatus: "PENDING",
    data: Prisma.JobOrderProgressEntryUncheckedUpdateInput
  ) => tx.jobOrderProgressEntry.updateMany({ where: { id, approvalStatus: expectedStatus }, data }),
};

export const ProductionStageTransactionRepository = {
  createInTx: (tx: Prisma.TransactionClient, data: Prisma.ProductionStageTransactionUncheckedCreateInput) =>
    tx.productionStageTransaction.create({ data }),

  findByLotId: (lotId: string) =>
    prisma.productionStageTransaction.findMany({
      where: { lotId },
      include: {
        fromProductionStage: { select: { id: true, name: true } },
        toProductionStage: { select: { id: true, name: true } },
        performedBy: { select: { id: true, fullName: true } },
      },
      orderBy: { performedAt: "asc" },
    }),

  /** The Stage Transfer Slip PDF's own data source — the most recent
   * transaction that actually created/fed this JobOrder (a downstream stage
   * can receive more than one transaction over time via repeated partial
   * forwards, so "most recent" is the slip a floor worker would want right
   * now, not an arbitrary historical one). */
  findLatestByToJobOrderId: (companyId: string, lotId: string, toJobOrderId: string) =>
    prisma.productionStageTransaction.findFirst({
      where: { companyId, lotId, toJobOrderId },
      include: {
        lot: {
          select: {
            id: true,
            lotNumber: true,
            variantBreakdown: {
              include: { productVariant: { select: { color: { select: { name: true } }, size: { select: { name: true } } } } },
            },
          },
        },
        productionOrder: {
          select: {
            id: true,
            orderNumber: true,
            product: { select: { styleName: true, styleCode: true } },
            // Nullable — a Make-to-Stock order has no Sales Order at all; the
            // slip renders an explicit "Make-to-Stock" note rather than a
            // blank field in that case.
            salesOrderItem: { select: { salesOrder: { select: { orderNumber: true } } } },
          },
        },
        fromProductionStage: { select: { id: true, name: true } },
        toProductionStage: { select: { id: true, name: true } },
        performedBy: { select: { id: true, fullName: true } },
        // Who this quantity was actually forwarded TO — the destination job
        // order's currently assigned worker(s), if any exist yet. A stage
        // transfer can happen before anyone is assigned to the receiving
        // stage, so this is honestly reported as unassigned rather than
        // guessed at.
        toJobOrder: {
          select: {
            assignments: {
              where: { status: { not: "CANCELLED" } },
              select: { employee: { select: { fullName: true } } },
            },
          },
        },
      },
      orderBy: { performedAt: "desc" },
    }),
};

export const QcInspectionRepository = {
  createWithDefectsInTx: (
    tx: Prisma.TransactionClient,
    data: Prisma.QcInspectionUncheckedCreateInput,
    defects: Array<{ defectTypeId: string; quantity: number; severity: string | null; remarks: string | null }>
  ) =>
    tx.qcInspection.create({
      data: { ...data, defects: { create: defects } },
      include: { defects: true },
    }),

  findByJobOrderId: (jobOrderId: string) =>
    prisma.qcInspection.findMany({
      where: { jobOrderId },
      include: { defects: { include: { defectType: true } }, inspector: { select: { id: true, fullName: true } } },
      orderBy: { inspectedAt: "asc" },
    }),

  sumAcceptedByJobOrderId: async (jobOrderId: string) => {
    const result = await prisma.qcInspection.aggregate({ where: { jobOrderId }, _sum: { acceptedQuantity: true } });
    return Number(result._sum.acceptedQuantity ?? 0);
  },

  // Must be used (never the plain-`prisma` variant above) by any caller running
  // inside an open transaction that may itself have just inserted the very
  // QcInspection row being summed — a separate `prisma.*` call runs on a
  // different connection and cannot see that not-yet-committed row.
  sumAcceptedByJobOrderIdInTx: async (tx: Prisma.TransactionClient, jobOrderId: string) => {
    const result = await tx.qcInspection.aggregate({ where: { jobOrderId }, _sum: { acceptedQuantity: true } });
    return Number(result._sum.acceptedQuantity ?? 0);
  },
};

export const DefectTypeRepository = {
  findMany: (companyId: string) => prisma.defectType.findMany({ where: { companyId }, orderBy: { name: "asc" } }),
  findFirst: (companyId: string, id: string) => prisma.defectType.findFirst({ where: { id, companyId } }),
  create: (data: Prisma.DefectTypeUncheckedCreateInput) => prisma.defectType.create({ data }),
  update: (id: string, data: Prisma.DefectTypeUncheckedUpdateInput) => prisma.defectType.update({ where: { id }, data }),
};

// ─────────────────────────────────────────────────────────────
// Piece-Rate / Worker-Pricing engine (2026-09-18)
// ─────────────────────────────────────────────────────────────

export const ProductionOperationRepository = {
  findMany: (companyId: string) =>
    prisma.productionOperation.findMany({
      where: { companyId },
      include: { productionStage: { select: { id: true, name: true, code: true } } },
      orderBy: { name: "asc" },
    }),
  findAnyById: (companyId: string, id: string) => prisma.productionOperation.findFirst({ where: { id, companyId } }),
  findByCode: (companyId: string, code: string) => prisma.productionOperation.findFirst({ where: { companyId, code } }),
  create: (data: Prisma.ProductionOperationUncheckedCreateInput) => prisma.productionOperation.create({ data }),
  update: (id: string, data: Prisma.ProductionOperationUncheckedUpdateInput) =>
    prisma.productionOperation.update({ where: { id }, data }),
};

const PIECE_RATE_CARD_INCLUDE = {
  productionOperation: { select: { id: true, name: true, code: true } },
  product: { select: { id: true, styleName: true, styleCode: true } },
  employee: { select: { id: true, fullName: true, employeeCode: true } },
  employeeCategory: { select: { id: true, name: true } },
  contractor: { select: { id: true, name: true, code: true } },
} as const;

export const PieceRateCardRepository = {
  findMany: (where: Prisma.PieceRateCardWhereInput) =>
    prisma.pieceRateCard.findMany({ where, include: PIECE_RATE_CARD_INCLUDE, orderBy: { effectiveFrom: "desc" } }),

  findAnyById: (companyId: string, id: string) =>
    prisma.pieceRateCard.findFirst({ where: { id, companyId }, include: PIECE_RATE_CARD_INCLUDE }),

  /** Every active row sharing the exact same dimension tuple — the overlap-
   * check candidate set (mirrors TaxRateRepository.findActiveByTaxType). */
  findMatchingDimension: (
    companyId: string,
    dims: {
      productionOperationId: string;
      productId: string | null;
      employeeId: string | null;
      employeeCategoryId: string | null;
      contractorId: string | null;
    },
    excludeId?: string
  ) =>
    prisma.pieceRateCard.findMany({
      where: {
        companyId,
        isActive: true,
        productionOperationId: dims.productionOperationId,
        productId: dims.productId,
        employeeId: dims.employeeId,
        employeeCategoryId: dims.employeeCategoryId,
        contractorId: dims.contractorId,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    }),

  /** Every active row a given resolution tier might match, narrowed further
   * in application code by asOfDate — used by resolvePieceRate(). */
  findActiveForResolution: (
    companyId: string,
    where: Prisma.PieceRateCardWhereInput
  ) => prisma.pieceRateCard.findMany({ where: { companyId, isActive: true, ...where } }),

  create: (data: Prisma.PieceRateCardUncheckedCreateInput) => prisma.pieceRateCard.create({ data }),
  update: (id: string, data: Prisma.PieceRateCardUncheckedUpdateInput) => prisma.pieceRateCard.update({ where: { id }, data }),
};

export const PieceRateEarningRepository = {
  createInTx: (tx: Prisma.TransactionClient, data: Prisma.PieceRateEarningUncheckedCreateInput) =>
    tx.pieceRateEarning.create({ data }),

  /** Every prior, non-cancelled earning sharing the exact key a new earning
   * would be generated under — the sum of `payableQuantity` across these
   * rows is what generateEarningForJobOrderProgress() subtracts from the
   * JobOrder's live eligible quantity, so a physical piece is never paid for
   * twice. */
  sumPriorPayable: async (
    tx: Prisma.TransactionClient,
    key: { jobOrderId: string; jobOrderAssignmentId?: string | null; jobWorkOrderId?: string | null }
  ) => {
    const result = await tx.pieceRateEarning.aggregate({
      where: {
        jobOrderId: key.jobOrderId,
        status: { not: "CANCELLED" },
        ...(key.jobOrderAssignmentId !== undefined ? { jobOrderAssignmentId: key.jobOrderAssignmentId } : {}),
        ...(key.jobWorkOrderId !== undefined ? { jobWorkOrderId: key.jobWorkOrderId } : {}),
      },
      _sum: { payableQuantity: true },
    });
    return Number(result._sum.payableQuantity ?? 0);
  },

  findMany: (where: Prisma.PieceRateEarningWhereInput) =>
    prisma.pieceRateEarning.findMany({
      where,
      include: {
        employee: { select: { id: true, fullName: true, employeeCode: true } },
        contractor: { select: { id: true, name: true, code: true } },
        productionOperation: { select: { id: true, name: true } },
        jobOrder: {
          select: {
            id: true,
            jobNumber: true,
            productionStage: { select: { name: true } },
            lot: { select: { lotNumber: true, productionOrder: { select: { orderNumber: true } } } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    }),

  findAnyById: (companyId: string, id: string) => prisma.pieceRateEarning.findFirst({ where: { id, companyId } }),

  update: (id: string, data: Prisma.PieceRateEarningUncheckedUpdateInput) =>
    prisma.pieceRateEarning.update({ where: { id }, data }),
};
