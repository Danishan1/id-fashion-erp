import { prisma } from "@/core/db/client";
import type { Prisma } from "@prisma/client";

export const ChartOfAccountRepository = {
  findMany: (where: Prisma.ChartOfAccountWhereInput, args: Omit<Prisma.ChartOfAccountFindManyArgs, "where">) =>
    prisma.chartOfAccount.findMany({
      where,
      include: { parentAccount: { select: { id: true, name: true } } },
      ...args,
    }),

  count: (where: Prisma.ChartOfAccountWhereInput) => prisma.chartOfAccount.count({ where }),

  findAnyById: (companyId: string, id: string) => prisma.chartOfAccount.findFirst({ where: { id, companyId } }),

  findByCode: (companyId: string, code: string) => prisma.chartOfAccount.findFirst({ where: { companyId, code } }),

  create: (data: Prisma.ChartOfAccountUncheckedCreateInput) => prisma.chartOfAccount.create({ data }),

  update: (id: string, data: Prisma.ChartOfAccountUncheckedUpdateInput) =>
    prisma.chartOfAccount.update({ where: { id }, data }),

  countJournalLineReferences: (accountId: string) => prisma.journalLine.count({ where: { accountId } }),

  /** Posted lines for one account, oldest first, for the ledger/running-balance view. */
  findLedgerLines: (companyId: string, accountId: string, dateFrom?: Date, dateTo?: Date) =>
    prisma.journalLine.findMany({
      where: {
        accountId,
        journal: {
          companyId,
          status: "POSTED",
          ...(dateFrom || dateTo
            ? { journalDate: { ...(dateFrom ? { gte: dateFrom } : {}), ...(dateTo ? { lte: dateTo } : {}) } }
            : {}),
        },
      },
      include: { journal: { select: { journalNumber: true, journalDate: true, narration: true } } },
      orderBy: [{ journal: { journalDate: "asc" } }, { createdAt: "asc" }],
    }),

  /** Per-account debit/credit sums across every POSTED journal line, for the trial balance. */
  sumPostedLinesByAccount: (companyId: string, asOfDate?: Date) =>
    prisma.journalLine.groupBy({
      by: ["accountId"],
      where: {
        journal: {
          companyId,
          status: "POSTED",
          ...(asOfDate ? { journalDate: { lte: asOfDate } } : {}),
        },
      },
      _sum: { debitAmount: true, creditAmount: true },
    }),
};
