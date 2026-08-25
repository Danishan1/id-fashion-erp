import { prisma } from "@/core/db/client";
import type { JobWorkOrderStatus, Prisma } from "@prisma/client";

const JOB_WORK_ORDER_INCLUDE = {
  supplier: { select: { id: true, name: true, code: true } },
  uom: { select: { id: true, code: true } },
  requestedBy: { select: { id: true, fullName: true } },
  jobOrder: {
    select: {
      id: true,
      jobNumber: true,
      plannedQuantity: true,
      completedQuantity: true,
      rejectedQuantity: true,
      damagedQuantity: true,
      productionStage: { select: { id: true, name: true } },
      lot: { select: { id: true, lotNumber: true, productionOrder: { select: { id: true, orderNumber: true } } } },
    },
  },
  materials: {
    include: { product: { select: { id: true, styleName: true, styleCode: true } }, uom: { select: { id: true, code: true } } },
  },
  receipts: { orderBy: { createdAt: "asc" as const }, include: { receivedBy: { select: { id: true, fullName: true } } } },
} as const;

export const JobWorkOrderRepository = {
  findMany: (where: Prisma.JobWorkOrderWhereInput, args: Omit<Prisma.JobWorkOrderFindManyArgs, "where">) =>
    prisma.jobWorkOrder.findMany({ where, include: JOB_WORK_ORDER_INCLUDE, ...args }),

  count: (where: Prisma.JobWorkOrderWhereInput) => prisma.jobWorkOrder.count({ where }),

  findAnyById: (companyId: string, id: string) =>
    prisma.jobWorkOrder.findFirst({ where: { id, companyId }, include: JOB_WORK_ORDER_INCLUDE }),

  createWithMaterialsInTx: (
    tx: Prisma.TransactionClient,
    data: Prisma.JobWorkOrderUncheckedCreateInput,
    materials: Prisma.JobWorkOrderMaterialUncheckedCreateWithoutJobWorkOrderInput[]
  ) =>
    tx.jobWorkOrder.create({
      data: { ...data, materials: { create: materials } },
      include: JOB_WORK_ORDER_INCLUDE,
    }),

  update: (id: string, data: Prisma.JobWorkOrderUncheckedUpdateInput) =>
    prisma.jobWorkOrder.update({ where: { id }, data, include: JOB_WORK_ORDER_INCLUDE }),

  updateInTx: (tx: Prisma.TransactionClient, id: string, data: Prisma.JobWorkOrderUncheckedUpdateInput) =>
    tx.jobWorkOrder.update({ where: { id }, data }),

  /** Row-locked read inside a transaction (a real `SELECT ... FOR UPDATE`,
   * not just a plain read — a prior version of this comment claimed the
   * lock without the code actually taking it), immediately before a guarded
   * 3-column quantity update — received+rejected+damaged <= issuedQuantity
   * can't be expressed as a single-column Prisma `updateMany` guard (same
   * limitation `job-order.service.ts`'s own `applyJobOrderQuantityDelta`
   * documents), so this backs a read-verify-write in the service instead.
   * Without the lock, two concurrent receipts/reversals against the same
   * jobWorkOrderId could both read the same pre-write snapshot and the
   * second writer would silently discard the first's increment. */
  findForGuardedUpdateInTx: async (tx: Prisma.TransactionClient, id: string) => {
    await tx.$queryRaw`SELECT id FROM job_work_orders WHERE id = ${id}::uuid FOR UPDATE`;
    return tx.jobWorkOrder.findUniqueOrThrow({ where: { id } });
  },

  /** Sum of `issuedQuantity - received - rejected - damaged` across every
   * still-active JobWorkOrder for a given JobOrder, excluding one order
   * (used when computing how much of the JobOrder's remaining/unprocessed
   * pool is already committed elsewhere before issuing a new one). */
  sumPendingByJobOrderId: async (jobOrderId: string, excludeId?: string) => {
    const rows = await prisma.jobWorkOrder.findMany({
      where: { jobOrderId, status: { notIn: ["CANCELLED"] }, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { issuedQuantity: true, receivedQuantity: true, rejectedQuantity: true, damagedQuantity: true },
    });
    return rows.reduce((sum, r) => sum + Number(r.issuedQuantity) - Number(r.receivedQuantity) - Number(r.rejectedQuantity) - Number(r.damagedQuantity), 0);
  },

  countActiveReceipts: (jobWorkOrderId: string) =>
    prisma.jobWorkReceipt.count({ where: { jobWorkOrderId, status: { not: "CANCELLED" } } }),
};

export const JobWorkReceiptRepository = {
  createInTx: (tx: Prisma.TransactionClient, data: Prisma.JobWorkReceiptUncheckedCreateInput) => tx.jobWorkReceipt.create({ data }),

  countByJobWorkOrderId: (jobWorkOrderId: string) => prisma.jobWorkReceipt.count({ where: { jobWorkOrderId } }),

  findAnyById: (companyId: string, id: string) =>
    prisma.jobWorkReceipt.findFirst({ where: { id, companyId }, include: { jobWorkOrder: true } }),

  updateInTx: (tx: Prisma.TransactionClient, id: string, data: Prisma.JobWorkReceiptUncheckedUpdateInput) =>
    tx.jobWorkReceipt.update({ where: { id }, data }),
};

export type { JobWorkOrderStatus };
