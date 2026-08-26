import { prisma } from "@/core/db/client";
import type { Prisma, PaymentStatus } from "@prisma/client";

const detailInclude = {
  customer: { select: { id: true, name: true } },
  supplier: { select: { id: true, name: true } },
  paymentType: { select: { id: true, name: true, type: true } },
  bankAccount: { select: { id: true, name: true, bankName: true } },
  journal: { select: { id: true, journalNumber: true, status: true } },
  createdBy: { select: { id: true, fullName: true } },
  postedBy: { select: { id: true, fullName: true } },
  allocations: {
    include: {
      salesInvoice: { select: { id: true, invoiceNumber: true, totalAmount: true, paidAmount: true } },
      purchaseInvoice: { select: { id: true, invoiceNumber: true, totalAmount: true, paidAmount: true } },
    },
  },
} satisfies Prisma.PaymentInclude;

export const PaymentRepository = {
  findMany: (where: Prisma.PaymentWhereInput, args: Omit<Prisma.PaymentFindManyArgs, "where">) =>
    prisma.payment.findMany({
      where,
      include: {
        customer: { select: { id: true, name: true } },
        supplier: { select: { id: true, name: true } },
      },
      ...args,
    }),

  count: (where: Prisma.PaymentWhereInput) => prisma.payment.count({ where }),

  findAnyById: (companyId: string, id: string) => prisma.payment.findFirst({ where: { id, companyId } }),

  /** CF-5 idempotent-replay lookup — same include shape as createWithAllocations's own return value. */
  findByIdempotencyKey: (companyId: string, idempotencyKey: string) =>
    prisma.payment.findUnique({
      where: { companyId_idempotencyKey: { companyId, idempotencyKey } },
      include: detailInclude,
    }),

  findByIdWithDetails: (companyId: string, id: string) =>
    prisma.payment.findFirst({ where: { id, companyId }, include: detailInclude }),

  createWithAllocations: (
    data: Omit<Prisma.PaymentUncheckedCreateInput, "allocations">,
    allocations: Array<{ salesInvoiceId: string | null; purchaseInvoiceId: string | null; allocatedAmount: number }>
  ) =>
    prisma.payment.create({
      data: { ...data, allocations: { create: allocations } },
      include: detailInclude,
    }),

  /** Conditional status write — same race-closing shape used throughout this project. */
  updateStatusConditional: (id: string, expectedStatus: PaymentStatus, data: Prisma.PaymentUncheckedUpdateInput) =>
    prisma.payment.updateMany({ where: { id, status: expectedStatus }, data }),
};

/** Colocated here rather than a dedicated Company module — same pattern as
 * sales-order.repository.ts/purchase-order.repository.ts's own copy. */
export const CompanyRepository = {
  findBaseCurrencyCode: (companyId: string) =>
    prisma.company.findUnique({ where: { id: companyId }, select: { baseCurrencyCode: true } }),
};
