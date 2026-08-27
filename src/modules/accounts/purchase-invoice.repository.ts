import { prisma } from "@/core/db/client";
import type { Prisma, PurchaseInvoiceStatus } from "@prisma/client";

const detailInclude = {
  purchaseOrder: { select: { id: true, orderNumber: true, status: true } },
  supplier: { select: { id: true, name: true, paymentTermsDays: true } },
  journal: { select: { id: true, journalNumber: true, status: true } },
  createdBy: { select: { id: true, fullName: true } },
  postedBy: { select: { id: true, fullName: true } },
  items: {
    include: {
      product: { select: { id: true, styleName: true, styleCode: true } },
      expenseAccount: { select: { id: true, code: true, name: true, isActive: true } },
      taxRate: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.PurchaseInvoiceInclude;

export interface PurchaseInvoiceItemCreateData {
  purchaseOrderItemId: string | null;
  productId: string | null;
  description: string | null;
  expenseAccountId: string | null;
  quantity: number;
  unitPrice: number;
  taxRateId: string | null;
  taxPercentage: number | null;
  taxAmount: number;
  lineTotal: number;
}

export const PurchaseInvoiceRepository = {
  findMany: (where: Prisma.PurchaseInvoiceWhereInput, args: Omit<Prisma.PurchaseInvoiceFindManyArgs, "where">) =>
    prisma.purchaseInvoice.findMany({
      where,
      include: {
        purchaseOrder: { select: { id: true, orderNumber: true } },
        supplier: { select: { id: true, name: true } },
      },
      ...args,
    }),

  count: (where: Prisma.PurchaseInvoiceWhereInput) => prisma.purchaseInvoice.count({ where }),

  findAnyById: (companyId: string, id: string) => prisma.purchaseInvoice.findFirst({ where: { id, companyId } }),

  /** CF-5 idempotent-replay lookup. */
  findByIdempotencyKey: (companyId: string, idempotencyKey: string) =>
    prisma.purchaseInvoice.findUnique({ where: { companyId_idempotencyKey: { companyId, idempotencyKey } } }),

  findByIdWithDetails: (companyId: string, id: string) =>
    prisma.purchaseInvoice.findFirst({ where: { id, companyId }, include: detailInclude }),

  createWithItems: (data: Omit<Prisma.PurchaseInvoiceUncheckedCreateInput, "items">, items: PurchaseInvoiceItemCreateData[]) =>
    prisma.purchaseInvoice.create({
      data: { ...data, items: { create: items } },
      include: detailInclude,
    }),

  /** Full replace of a DRAFT invoice's items — same shape as Sales Invoice's replaceItems. */
  replaceItems: (invoiceId: string, headerData: Prisma.PurchaseInvoiceUncheckedUpdateInput, items: PurchaseInvoiceItemCreateData[]) =>
    prisma.$transaction(async (tx) => {
      await tx.purchaseInvoiceItem.deleteMany({ where: { purchaseInvoiceId: invoiceId } });
      await tx.purchaseInvoice.update({ where: { id: invoiceId }, data: { ...headerData, items: { create: items } } });
      return tx.purchaseInvoice.findFirstOrThrow({ where: { id: invoiceId }, include: detailInclude });
    }),

  /** Conditional status write — same race-closing shape used throughout this project. */
  updateStatusConditional: (id: string, expectedStatus: PurchaseInvoiceStatus, data: Prisma.PurchaseInvoiceUncheckedUpdateInput) =>
    prisma.purchaseInvoice.updateMany({ where: { id, status: expectedStatus }, data }),

  /** Invoices with a real outstanding balance for one supplier — feeds Payment's allocation picker (Phase 7D). */
  findOutstandingBySupplier: (companyId: string, supplierId: string) =>
    prisma.purchaseInvoice.findMany({
      where: { companyId, supplierId, status: { in: ["POSTED", "PARTIALLY_PAID"] } },
      orderBy: { invoiceDate: "asc" },
    }),
};

/** Same minimal shape as Expense/Payment's own per-module CompanyRepository — a direct/party bill with no PO has nothing else to derive currency from. */
export const CompanyRepository = {
  findBaseCurrencyCode: (companyId: string) => prisma.company.findUnique({ where: { id: companyId }, select: { baseCurrencyCode: true } }),
};
