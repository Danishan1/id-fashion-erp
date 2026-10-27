import { prisma } from "@/core/db/client";
import type { PaymentRequestStatus, Prisma } from "@prisma/client";

const LIST_INCLUDE = {
  supplier: { select: { id: true, code: true, name: true } },
  employee: { select: { id: true, employeeCode: true, fullName: true } },
  createdBy: { select: { id: true, fullName: true } },
} satisfies Prisma.PaymentRequestInclude;

const DETAIL_INCLUDE = {
  ...LIST_INCLUDE,
  approvedBy: { select: { id: true, fullName: true } },
  rejectedBy: { select: { id: true, fullName: true } },
  cancelledBy: { select: { id: true, fullName: true } },
  approvals: { orderBy: { decidedAt: "asc" }, include: { user: { select: { id: true, fullName: true } } } },
  payouts: {
    orderBy: { createdAt: "asc" },
    include: {
      paymentType: { select: { name: true, type: true } },
      bankAccount: { select: { name: true, bankName: true } },
      journal: { select: { id: true, journalNumber: true } },
      payment: { select: { id: true, paymentNumber: true } },
      internalTransfer: { select: { id: true, transferNumber: true } },
      createdBy: { select: { fullName: true } },
    },
  },
} satisfies Prisma.PaymentRequestInclude;

export const PaymentRequestRepository = {
  findMany: (where: Prisma.PaymentRequestWhereInput, args: { orderBy: Prisma.PaymentRequestOrderByWithRelationInput; skip: number; take: number }) =>
    prisma.paymentRequest.findMany({ where, include: LIST_INCLUDE, ...args }),

  count: (where: Prisma.PaymentRequestWhereInput) => prisma.paymentRequest.count({ where }),

  findByIdWithDetails: (companyId: string, id: string) =>
    prisma.paymentRequest.findFirst({ where: { id, companyId }, include: DETAIL_INCLUDE }),

  findByIdempotencyKey: (companyId: string, idempotencyKey: string) =>
    prisma.paymentRequest.findFirst({ where: { companyId, idempotencyKey }, include: DETAIL_INCLUDE }),

  create: (data: Prisma.PaymentRequestUncheckedCreateInput) => prisma.paymentRequest.create({ data }),

  /** Guarded write: only succeeds while the request is still in one of `fromStatuses` and unpaid. */
  updateIfStatus: (id: string, fromStatuses: PaymentRequestStatus[], data: Prisma.PaymentRequestUncheckedUpdateManyInput) =>
    prisma.paymentRequest.updateMany({ where: { id, status: { in: fromStatuses }, paidAmount: 0 }, data }),

  /**
   * One approval decision: logs it and moves the request, only if it is still
   * pending at `level` (a concurrent decision on the same level loses and
   * nothing is written). Returns false when the guard lost.
   */
  recordDecision: (
    id: string,
    level: number,
    decision: { decision: "APPROVED" | "REJECTED"; userId: string; remark: string | null },
    data: Prisma.PaymentRequestUncheckedUpdateManyInput
  ) =>
    prisma.$transaction(async (tx) => {
      const { count } = await tx.paymentRequest.updateMany({
        where: { id, status: "PENDING_APPROVAL", currentApprovalLevel: level },
        data,
      });
      if (count === 0) return false;
      await tx.paymentRequestApproval.create({ data: { paymentRequestId: id, level, ...decision } });
      return true;
    }),

  countApprovals: (paymentRequestId: string) => prisma.paymentRequestApproval.count({ where: { paymentRequestId } }),

  /** Has this user already approved an earlier level of the request? */
  hasApproved: (paymentRequestId: string, userId: string) =>
    prisma.paymentRequestApproval.count({ where: { paymentRequestId, userId, decision: "APPROVED" } }).then((n) => n > 0),

  countByGroupAndStatus: (where: Prisma.PaymentRequestWhereInput) =>
    prisma.paymentRequest.groupBy({ by: ["requestGroup", "status"], where, _count: { _all: true } }),

  findBaseCurrencyCode: (companyId: string) =>
    prisma.company.findUnique({ where: { id: companyId }, select: { baseCurrencyCode: true } }),

  findActiveSupplier: (companyId: string, id: string) =>
    prisma.supplier.findFirst({ where: { id, companyId, deletedAt: null, isActive: true }, select: { id: true, name: true } }),

  findActiveEmployee: (companyId: string, id: string) =>
    prisma.employee.findFirst({ where: { id, companyId, isActive: true, deletedAt: null }, select: { id: true, fullName: true } }),
};
