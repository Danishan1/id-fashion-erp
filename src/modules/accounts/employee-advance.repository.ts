import { prisma } from "@/core/db/client";
import type { Prisma, EmployeeAdvanceStatus, ExpenseStatus } from "@prisma/client";

const detailInclude = {
  employee: { select: { id: true, fullName: true, employeeCode: true } },
  paymentType: { select: { id: true, name: true, type: true } },
  bankAccount: { select: { id: true, name: true, bankName: true } },
  journal: { select: { id: true, journalNumber: true, status: true } },
  createdBy: { select: { id: true, fullName: true } },
  settlements: {
    orderBy: { settlementDate: "desc" as const },
    include: {
      expenseAccount: { select: { id: true, code: true, name: true } },
      taxRate: { select: { id: true, name: true } },
      createdBy: { select: { id: true, fullName: true } },
    },
  },
} satisfies Prisma.EmployeeAdvanceInclude;

export const EmployeeAdvanceRepository = {
  findMany: (where: Prisma.EmployeeAdvanceWhereInput, args: Omit<Prisma.EmployeeAdvanceFindManyArgs, "where">) =>
    prisma.employeeAdvance.findMany({
      where,
      include: { employee: { select: { id: true, fullName: true } } },
      ...args,
    }),

  count: (where: Prisma.EmployeeAdvanceWhereInput) => prisma.employeeAdvance.count({ where }),

  findAnyById: (companyId: string, id: string) => prisma.employeeAdvance.findFirst({ where: { id, companyId } }),

  /** CF-5 idempotent-replay lookup. */
  findByIdempotencyKey: (companyId: string, idempotencyKey: string) =>
    prisma.employeeAdvance.findUnique({ where: { companyId_idempotencyKey: { companyId, idempotencyKey } } }),

  findByIdWithDetails: (companyId: string, id: string) =>
    prisma.employeeAdvance.findFirst({ where: { id, companyId }, include: detailInclude }),

  create: (data: Prisma.EmployeeAdvanceUncheckedCreateInput) => prisma.employeeAdvance.create({ data, include: detailInclude }),

  /** Conditional status write — same race-closing shape used throughout this project. */
  updateStatusConditional: (id: string, expectedStatus: EmployeeAdvanceStatus, data: Prisma.EmployeeAdvanceUncheckedUpdateInput) =>
    prisma.employeeAdvance.updateMany({ where: { id, status: expectedStatus }, data }),
};

export const EmployeeAdvanceSettlementRepository = {
  findAnyById: (companyId: string, id: string) => prisma.employeeAdvanceSettlement.findFirst({ where: { id, companyId } }),

  create: (data: Prisma.EmployeeAdvanceSettlementUncheckedCreateInput) => prisma.employeeAdvanceSettlement.create({ data }),

  updateStatusConditional: (id: string, expectedStatus: ExpenseStatus, data: Prisma.EmployeeAdvanceSettlementUncheckedUpdateInput) =>
    prisma.employeeAdvanceSettlement.updateMany({ where: { id, status: expectedStatus }, data }),
};
