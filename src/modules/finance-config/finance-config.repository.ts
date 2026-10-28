import { prisma } from "@/core/db/client";

export const FinanceConfigRepository = {
  paymentType: prisma.paymentType,
  bankAccount: prisma.bankAccount,
  payee: prisma.payee,
  expensePurpose: prisma.expensePurpose,
  chartOfAccount: prisma.chartOfAccount,
};
