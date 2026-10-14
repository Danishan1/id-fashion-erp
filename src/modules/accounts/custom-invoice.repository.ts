import { prisma } from "@/core/db/client";
import type { Prisma, CustomInvoiceStatus } from "@prisma/client";

const detailInclude = {
  invoiceSeries: { select: { id: true, name: true, prefix: true } },
  customer: {
    select: {
      id: true,
      name: true,
      code: true,
      taxRegistrationNo: true,
      billingAddress: true,
      shippingAddress: true,
      city: true,
      pinCode: true,
      country: true,
    },
  },
  incomeAccount: { select: { id: true, code: true, name: true } },
  createdBy: { select: { id: true, fullName: true } },
  items: {
    where: { quantity: { gt: 0 } },
    include: { product: { select: { id: true, styleName: true, styleCode: true } } },
  },
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

  /**
   * Safely updates a DRAFT invoice's items and notes. If any item is
   * referenced by existing (cancelled) credit note lines, we update referenced
   * items in-place and create new items/delete unreferenced ones so foreign key
   * constraints on historical credit notes are never violated.
   */
  replaceItemsAndNotes: (
    invoiceId: string,
    headerData: Prisma.CustomInvoiceUncheckedUpdateInput,
    items: CustomInvoiceItemCreateInput[],
    notes: string[]
  ) =>
    prisma.$transaction(async (tx) => {
      // Find existing items and determine which ones are referenced by credit notes
      const existingItems = await tx.customInvoiceItem.findMany({
        where: { customInvoiceId: invoiceId },
        orderBy: { id: "asc" },
      });

      const referencedLines = await tx.customInvoiceCreditNoteItem.findMany({
        where: { customInvoiceItemId: { in: existingItems.map((i) => i.id) } },
        select: { customInvoiceItemId: true },
      });
      const referencedItemIds = new Set(referencedLines.map((r) => r.customInvoiceItemId));

      // Separate existing items into referenced vs unreferenced
      const referencedExisting = existingItems.filter((existing) => referencedItemIds.has(existing.id));
      const unreferencedExisting = existingItems.filter((existing) => !referencedItemIds.has(existing.id));

      const remainingNewItems = [...items];

      // Helper to check if two item representations are semantically the same product/item
      const isSameProduct = (
        existing: { productId: string | null; itemName: string },
        candidate: CustomInvoiceItemCreateInput
      ) => {
        if (existing.productId && candidate.productId) {
          return existing.productId === candidate.productId;
        }
        return existing.itemName.trim().toLowerCase() === candidate.itemName.trim().toLowerCase();
      };

      // 1. For referenced existing items:
      // We only reuse an existing referenced row if it matches the same product semantically.
      // If the product changed or was removed, we NEVER overwrite the historical row with an
      // unrelated product (which would distort historical credit note identity). Instead, we
      // preserve the historical row's itemName/productId/hsnCode, but set its active amounts to 0.
      for (const existing of referencedExisting) {
        const matchIndex = remainingNewItems.findIndex((candidate) => isSameProduct(existing, candidate));
        if (matchIndex !== -1) {
          const matchedItem = remainingNewItems.splice(matchIndex, 1)[0];
          await tx.customInvoiceItem.update({
            where: { id: existing.id },
            data: matchedItem,
          });
        } else {
          // No semantic match in the updated invoice: preserve historical item identity
          // but zero active quantities and financial amounts.
          await tx.customInvoiceItem.update({
            where: { id: existing.id },
            data: {
              quantity: 0,
              lineAmount: 0,
              lineTaxAmount: 0,
              lineTotal: 0,
            },
          });
        }
      }

      // 2. For unreferenced existing items:
      // They have no foreign key dependencies. Any unreferenced item can be safely deleted.
      for (const unused of unreferencedExisting) {
        await tx.customInvoiceItem.delete({ where: { id: unused.id } });
      }

      // 3. For any remaining new items that were not matched to an existing referenced item:
      // Create them as new rows with their own distinct IDs.
      if (remainingNewItems.length > 0) {
        await tx.customInvoiceItem.createMany({
          data: remainingNewItems.map((item) => ({ ...item, customInvoiceId: invoiceId })),
        });
      }

      // Notes can be safely recreated as they have no foreign key dependencies
      await tx.customInvoiceNote.deleteMany({ where: { customInvoiceId: invoiceId } });
      await tx.customInvoice.update({
        where: { id: invoiceId },
        data: { ...headerData, notes: { create: notes.map((note) => ({ note })) } },
      });
      return tx.customInvoice.findFirstOrThrow({ where: { id: invoiceId }, include: detailInclude });
    }),

  updateStatusConditional: (id: string, expectedStatus: CustomInvoiceStatus, data: Prisma.CustomInvoiceUncheckedUpdateInput) =>
    prisma.customInvoice.updateMany({ where: { id, status: expectedStatus }, data }),
};
