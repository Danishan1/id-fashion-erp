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

  countByGroupAndStatus: (where: Prisma.PaymentRequestWhereInput) =>
    prisma.paymentRequest.groupBy({ by: ["requestGroup", "status"], where, _count: { _all: true } }),

  findBaseCurrencyCode: (companyId: string) =>
    prisma.company.findUnique({ where: { id: companyId }, select: { baseCurrencyCode: true } }),

  findActiveSupplier: (companyId: string, id: string) =>
    prisma.supplier.findFirst({ where: { id, companyId, deletedAt: null, isActive: true }, select: { id: true, name: true } }),

  findActiveEmployee: (companyId: string, id: string) =>
    prisma.employee.findFirst({ where: { id, companyId, isActive: true, deletedAt: null }, select: { id: true, fullName: true } }),
};
