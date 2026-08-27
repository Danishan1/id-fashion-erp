import { prisma } from "@/core/db/client";
import type { Prisma, CustomInvoiceStatus } from "@prisma/client";

const detailInclude = {
  invoiceSeries: { select: { id: true, name: true, prefix: true } },
  customer: { select: { id: true, name: true, code: true } },
  incomeAccount: { select: { id: true, code: true, name: true } },
  createdBy: { select: { id: true, fullName: true } },
  items: { include: { product: { select: { id: true, styleName: true, styleCode: true } } } },
  notes: { orderBy: { createdAt: "asc" } },
  payments: {
    orderBy: { paymentDate: "desc" as const },
    include: { paymentType: { select: { id: true, name: true } }, receivedBy: { select: { id: true, fullName: true } } },
  },
  creditNotes: {
    orderBy: { creditNoteDate: "desc" as const },
    include: { createdBy: { select: { id: true, fullName: true } }, items: true },
  },
} satisfies Prisma.CustomInvoiceInclude;

type CustomInvoiceItemCreateInput = {
  productId: string | null;
  itemName: string;
  hsnCode: string | null;
  quantity: number;
  unitPrice: number;
  gstPercentage: number;
  lineAmount: number;
  lineTaxAmount: number;
  lineTotal: number;
};

export const CustomInvoiceRepository = {
  findMany: (where: Prisma.CustomInvoiceWhereInput, args: Omit<Prisma.CustomInvoiceFindManyArgs, "where">) =>
    prisma.customInvoice.findMany({
      where,
      include: {
        customer: { select: { id: true, name: true } },
        invoiceSeries: { select: { id: true, name: true } },
      },
      ...args,
    }),

  count: (where: Prisma.CustomInvoiceWhereInput) => prisma.customInvoice.count({ where }),

  findAnyById: (companyId: string, id: string) => prisma.customInvoice.findFirst({ where: { id, companyId } }),

  findByIdWithDetails: (companyId: string, id: string) =>
    prisma.customInvoice.findFirst({ where: { id, companyId }, include: detailInclude }),

  createWithItems: (
    data: Omit<Prisma.CustomInvoiceUncheckedCreateInput, "items" | "notes">,
    items: CustomInvoiceItemCreateInput[],
    notes: string[]
  ) =>
    prisma.customInvoice.create({
      data: { ...data, items: { create: items }, notes: { create: notes.map((note) => ({ note })) } },
      include: detailInclude,
    }),

  /** Full replace of a DRAFT invoice's items/notes — same shape as SalesInvoiceRepository.replaceItems. */
  replaceItemsAndNotes: (
    invoiceId: string,
    headerData: Prisma.CustomInvoiceUncheckedUpdateInput,
    items: CustomInvoiceItemCreateInput[],
    notes: string[]
  ) =>
    prisma.$transaction(async (tx) => {
      await tx.customInvoiceItem.deleteMany({ where: { customInvoiceId: invoiceId } });
      await tx.customInvoiceNote.deleteMany({ where: { customInvoiceId: invoiceId } });
      await tx.customInvoice.update({
        where: { id: invoiceId },
        data: { ...headerData, items: { create: items }, notes: { create: notes.map((note) => ({ note })) } },
      });
      return tx.customInvoice.findFirstOrThrow({ where: { id: invoiceId }, include: detailInclude });
    }),

  updateStatusConditional: (id: string, expectedStatus: CustomInvoiceStatus, data: Prisma.CustomInvoiceUncheckedUpdateInput) =>
    prisma.customInvoice.updateMany({ where: { id, status: expectedStatus }, data }),
};
