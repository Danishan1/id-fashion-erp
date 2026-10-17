import { prisma } from "@/core/db/client";
import type { Prisma, CustomInvoiceCreditNoteStatus } from "@prisma/client";

const detailInclude = {
  createdBy: { select: { id: true, fullName: true } },
  items: { include: { customInvoiceItem: { select: { id: true, itemName: true } } } },
} satisfies Prisma.CustomInvoiceCreditNoteInclude;

export const CustomInvoiceCreditNoteRepository = {
  findByInvoiceId: (customInvoiceId: string) =>
    prisma.customInvoiceCreditNote.findMany({ where: { customInvoiceId }, include: detailInclude, orderBy: { creditNoteDate: "desc" } }),

  /** Company-wide list, across every invoice — backs the standalone Credit Notes page. */
  findMany: (where: Prisma.CustomInvoiceCreditNoteWhereInput, args: Omit<Prisma.CustomInvoiceCreditNoteFindManyArgs, "where">) =>
    prisma.customInvoiceCreditNote.findMany({
      where,
      include: {
        customInvoice: { select: { id: true, invoiceNumber: true, customer: { select: { id: true, name: true } } } },
      },
      ...args,
    }),

  count: (where: Prisma.CustomInvoiceCreditNoteWhereInput) => prisma.customInvoiceCreditNote.count({ where }),

  /** Any status, including CANCELLED — used to inspect full history. */
  countByInvoiceId: (customInvoiceId: string) => prisma.customInvoiceCreditNote.count({ where: { customInvoiceId } }),

  /** Count only active (ISSUED) credit notes — used to guard invoice editing. */
  countActiveByInvoiceId: (customInvoiceId: string) =>
    prisma.customInvoiceCreditNote.count({ where: { customInvoiceId, status: "ISSUED" } }),

  findAnyById: (companyId: string, id: string) =>
    prisma.customInvoiceCreditNote.findFirst({ where: { id, companyId }, include: detailInclude }),

  /** Full details for PDF generation — includes company letterhead, customer addresses, invoice series, and original line items. */
  findByIdWithFullDetails: (companyId: string, id: string) =>
    prisma.customInvoiceCreditNote.findFirst({
      where: { id, companyId },
      include: {
        createdBy: { select: { id: true, fullName: true } },
        company: {
          select: {
            id: true,
            name: true,
            legalName: true,
            taxRegistrationNo: true,
            addressJson: true,
          },
        },
        customInvoice: {
          select: {
            id: true,
            invoiceNumber: true,
            invoiceDate: true,
            placeOfSupplyStateCode: true,
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
              },
            },
            invoiceSeries: { select: { id: true, name: true, prefix: true } },
          },
        },
        items: {
          include: {
            customInvoiceItem: {
              select: {
                id: true,
                itemName: true,
                hsnCode: true,
                unitPrice: true,
                gstPercentage: true,
              },
            },
          },
        },
      },
    }),

  /** Conditional status write — same race-closing shape used throughout this project. */
  updateStatusConditional: (id: string, expectedStatus: CustomInvoiceCreditNoteStatus, data: Prisma.CustomInvoiceCreditNoteUncheckedUpdateInput) =>
    prisma.customInvoiceCreditNote.updateMany({ where: { id, status: expectedStatus }, data }),
};
