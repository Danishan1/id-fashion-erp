import { prisma } from "@/core/db/client";
import type { Prisma, SalesInvoiceStatus } from "@prisma/client";

const detailInclude = {
  salesOrder: { select: { id: true, orderNumber: true, status: true } },
  customer: { select: { id: true, name: true, paymentTermsDays: true } },
  journal: { select: { id: true, journalNumber: true, status: true } },
  createdBy: { select: { id: true, fullName: true } },
  postedBy: { select: { id: true, fullName: true } },
  items: {
    include: {
      product: { select: { id: true, styleName: true, styleCode: true } },
      taxRate: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.SalesInvoiceInclude;

export const SalesInvoiceRepository = {
  findMany: (where: Prisma.SalesInvoiceWhereInput, args: Omit<Prisma.SalesInvoiceFindManyArgs, "where">) =>
    prisma.salesInvoice.findMany({
      where,
      include: {
        salesOrder: { select: { id: true, orderNumber: true } },
        customer: { select: { id: true, name: true } },
      },
      ...args,
    }),

  count: (where: Prisma.SalesInvoiceWhereInput) => prisma.salesInvoice.count({ where }),

  findAnyById: (companyId: string, id: string) => prisma.salesInvoice.findFirst({ where: { id, companyId } }),

  /** CF-5 idempotent-replay lookup. */
  findByIdempotencyKey: (companyId: string, idempotencyKey: string) =>
    prisma.salesInvoice.findUnique({ where: { companyId_idempotencyKey: { companyId, idempotencyKey } } }),

  findByIdWithDetails: (companyId: string, id: string) =>
    prisma.salesInvoice.findFirst({ where: { id, companyId }, include: detailInclude }),

  /** At most one of these should ever exist per order — enforced at the DB
   * level by the sales_invoices_one_active_per_order partial unique index;
   * this is the pre-check used to give a friendly error before attempting
   * the insert. */
  findActiveByOrderId: (companyId: string, salesOrderId: string) =>
    prisma.salesInvoice.findFirst({ where: { companyId, salesOrderId, status: { not: "CANCELLED" } } }),

  createWithItems: (
    data: Omit<Prisma.SalesInvoiceUncheckedCreateInput, "items">,
    items: Array<{
      salesOrderItemId: string;
      productId: string;
      quantity: number;
      unitPrice: number;
      taxRateId: string | null;
      taxPercentage: number | null;
      taxAmount: number;
      lineTotal: number;
    }>
  ) =>
    prisma.salesInvoice.create({
      data: { ...data, items: { create: items } },
      include: detailInclude,
    }),

  /** Full replace of a DRAFT invoice's items — same shape as Journal's replaceLines. */
  replaceItems: (
    invoiceId: string,
    headerData: Prisma.SalesInvoiceUncheckedUpdateInput,
    items: Array<{
      salesOrderItemId: string;
      productId: string;
      quantity: number;
      unitPrice: number;
      taxRateId: string | null;
      taxPercentage: number | null;
      taxAmount: number;
      lineTotal: number;
    }>
  ) =>
    prisma.$transaction(async (tx) => {
      await tx.salesInvoiceItem.deleteMany({ where: { salesInvoiceId: invoiceId } });
      await tx.salesInvoice.update({ where: { id: invoiceId }, data: { ...headerData, items: { create: items } } });
      return tx.salesInvoice.findFirstOrThrow({ where: { id: invoiceId }, include: detailInclude });
    }),

  /** Conditional status write — same race-closing shape used throughout this project. */
  updateStatusConditional: (id: string, expectedStatus: SalesInvoiceStatus, data: Prisma.SalesInvoiceUncheckedUpdateInput) =>
    prisma.salesInvoice.updateMany({ where: { id, status: expectedStatus }, data }),

  /** Invoices with a real outstanding balance for one customer — feeds Payment's allocation picker (Phase 7D). */
  findOutstandingByCustomer: (companyId: string, customerId: string) =>
    prisma.salesInvoice.findMany({
      where: { companyId, customerId, status: { in: ["POSTED", "PARTIALLY_PAID"] } },
      orderBy: { invoiceDate: "asc" },
    }),
};
