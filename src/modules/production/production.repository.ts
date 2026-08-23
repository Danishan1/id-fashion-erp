import { prisma } from "@/core/db/client";
import type { Prisma } from "@prisma/client";

const PRODUCTION_ORDER_INCLUDE = {
  product: { select: { id: true, styleName: true, styleCode: true } },
  bom: { select: { id: true } },
  salesOrderItem: {
    select: { id: true, salesOrder: { select: { id: true, orderNumber: true } } },
  },
  requestedBy: { select: { id: true, fullName: true } },
} as const;

export const ProductionOrderRepository = {
  findMany: (where: Prisma.ProductionOrderWhereInput, args: Omit<Prisma.ProductionOrderFindManyArgs, "where">) =>
    prisma.productionOrder.findMany({ where, include: PRODUCTION_ORDER_INCLUDE, ...args }),

  count: (where: Prisma.ProductionOrderWhereInput) => prisma.productionOrder.count({ where }),

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
        productionOrder: { select: { id: true, orderNumber: true, productId: true, product: { select: { styleName: true } } } },
        jobOrders: {
          orderBy: { createdAt: "asc" },
          include: {
            productionStage: { select: { id: true, name: true, code: true, sequence: true } },
            assignments: { include: { employee: { select: { id: true, fullName: true, employeeCode: true } } } },
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
  productionStage: { select: { id: true, name: true, code: true, sequence: true, allowRework: true, isFinal: true, isActive: true } },
  productionLine: { select: { id: true, name: true } },
  lot: { select: { id: true, lotNumber: true, productionOrderId: true } },
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

  /** Row-locked read inside a transaction, immediately before a guarded
   * quantity update — the 3-column cap (completed+rejected+damaged<=planned)
   * can't be expressed as a single-column Prisma updateMany guard, so this
   * function backs a read-verify-write instead (see job-order.service.ts). */
  findForGuardedUpdateInTx: (tx: Prisma.TransactionClient, id: string) => tx.jobOrder.findUniqueOrThrow({ where: { id } }),

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
};

export const JobOrderProgressEntryRepository = {
  createInTx: (tx: Prisma.TransactionClient, data: Prisma.JobOrderProgressEntryUncheckedCreateInput) =>
    tx.jobOrderProgressEntry.create({ data }),
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
};

export const DefectTypeRepository = {
  findMany: (companyId: string) => prisma.defectType.findMany({ where: { companyId }, orderBy: { name: "asc" } }),
  findFirst: (companyId: string, id: string) => prisma.defectType.findFirst({ where: { id, companyId } }),
  create: (data: Prisma.DefectTypeUncheckedCreateInput) => prisma.defectType.create({ data }),
  update: (id: string, data: Prisma.DefectTypeUncheckedUpdateInput) => prisma.defectType.update({ where: { id }, data }),
};
