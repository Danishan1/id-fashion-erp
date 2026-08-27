import { prisma } from "@/core/db/client";
import type { Prisma, CustomInvoicePaymentStatus } from "@prisma/client";

const detailInclude = {
  paymentType: { select: { id: true, name: true, type: true } },
  receivedBy: { select: { id: true, fullName: true } },
} satisfies Prisma.CustomInvoicePaymentInclude;

export const CustomInvoicePaymentRepository = {
  findByInvoiceId: (customInvoiceId: string) =>
    prisma.customInvoicePayment.findMany({ where: { customInvoiceId }, include: detailInclude, orderBy: { paymentDate: "desc" } }),

  findAnyById: (companyId: string, id: string) => prisma.customInvoicePayment.findFirst({ where: { id, companyId } }),

  create: (data: Prisma.CustomInvoicePaymentUncheckedCreateInput) =>
    prisma.customInvoicePayment.create({ data, include: detailInclude }),

  /** Conditional status write — same race-closing shape used throughout this project. */
  updateStatusConditional: (id: string, expectedStatus: CustomInvoicePaymentStatus, data: Prisma.CustomInvoicePaymentUncheckedUpdateInput) =>
    prisma.customInvoicePayment.updateMany({ where: { id, status: expectedStatus }, data }),
};
