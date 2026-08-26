import { prisma } from "@/core/db/client";
import type { Prisma, ExpenseStatus } from "@prisma/client";

const detailInclude = {
  account: { select: { id: true, code: true, name: true, accountType: true, isActive: true } },
  supplier: { select: { id: true, name: true } },
  taxRate: { select: { id: true, name: true } },
  paymentType: { select: { id: true, name: true, type: true } },
  bankAccount: { select: { id: true, name: true, bankName: true } },
  journal: { select: { id: true, journalNumber: true, status: true } },
  createdBy: { select: { id: true, fullName: true } },
  postedBy: { select: { id: true, fullName: true } },
} satisfies Prisma.ExpenseInclude;

export const ExpenseRepository = {
  findMany: (where: Prisma.ExpenseWhereInput, args: Omit<Prisma.ExpenseFindManyArgs, "where">) =>
    prisma.expense.findMany({
      where,
      include: {
        account: { select: { id: true, code: true, name: true } },
        supplier: { select: { id: true, name: true } },
      },
      ...args,
    }),

  count: (where: Prisma.ExpenseWhereInput) => prisma.expense.count({ where }),

  findAnyById: (companyId: string, id: string) => prisma.expense.findFirst({ where: { id, companyId } }),

  /** CF-5 idempotent-replay lookup. */
  findByIdempotencyKey: (companyId: string, idempotencyKey: string) =>
    prisma.expense.findUnique({ where: { companyId_idempotencyKey: { companyId, idempotencyKey } } }),

  findByIdWithDetails: (companyId: string, id: string) =>
    prisma.expense.findFirst({ where: { id, companyId }, include: detailInclude }),

  create: (data: Prisma.ExpenseUncheckedCreateInput) => prisma.expense.create({ data, include: detailInclude }),

  update: (id: string, data: Prisma.ExpenseUncheckedUpdateInput) =>
    prisma.expense.update({ where: { id }, data, include: detailInclude }),

  /** Conditional status write — same race-closing shape used throughout this project. */
  updateStatusConditional: (id: string, expectedStatus: ExpenseStatus, data: Prisma.ExpenseUncheckedUpdateInput) =>
    prisma.expense.updateMany({ where: { id, status: expectedStatus }, data }),
};

/** Colocated here rather than a dedicated Company module — same pattern as
 * sales-order.repository.ts/purchase-order.repository.ts/payment.repository.ts's own copy. */
export const CompanyRepository = {
  findBaseCurrencyCode: (companyId: string) =>
    prisma.company.findUnique({ where: { id: companyId }, select: { baseCurrencyCode: true } }),
};
