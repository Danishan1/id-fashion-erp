import { prisma } from "@/core/db/client";
import type { JournalStatus, Prisma } from "@prisma/client";

const detailInclude = {
  createdBy: { select: { id: true, fullName: true } },
  postedBy: { select: { id: true, fullName: true } },
  reversalOf: { select: { id: true, journalNumber: true } },
  reversedByJournal: { select: { id: true, journalNumber: true } },
  lines: {
    include: { account: { select: { id: true, code: true, name: true, accountType: true } } },
    orderBy: { lineNumber: "asc" as const },
  },
} satisfies Prisma.JournalInclude;

export const JournalRepository = {
  findMany: (where: Prisma.JournalWhereInput, args: Omit<Prisma.JournalFindManyArgs, "where">) =>
    prisma.journal.findMany({
      where,
      include: { createdBy: { select: { id: true, fullName: true } } },
      ...args,
    }),

  count: (where: Prisma.JournalWhereInput) => prisma.journal.count({ where }),

  findAnyById: (companyId: string, id: string) => prisma.journal.findFirst({ where: { id, companyId } }),

  findByIdWithDetails: (companyId: string, id: string) =>
    prisma.journal.findFirst({ where: { id, companyId }, include: detailInclude }),

  createWithLines: (
    data: Omit<Prisma.JournalUncheckedCreateInput, "lines">,
    lines: Array<{ accountId: string; debitAmount: number; creditAmount: number; description: string | null; lineNumber: number }>
  ) =>
    prisma.journal.create({
      data: { ...data, lines: { create: lines } },
      include: detailInclude,
    }),

  /** Full replace of a DRAFT journal's lines — same shape as SalesOrder's replaceItems. */
  replaceLines: (
    journalId: string,
    headerData: Prisma.JournalUncheckedUpdateInput,
    lines: Array<{ accountId: string; debitAmount: number; creditAmount: number; description: string | null; lineNumber: number }>
  ) =>
    prisma.$transaction(async (tx) => {
      await tx.journalLine.deleteMany({ where: { journalId } });
      await tx.journal.update({ where: { id: journalId }, data: { ...headerData, lines: { create: lines } } });
      return tx.journal.findFirstOrThrow({ where: { id: journalId }, include: detailInclude });
    }),

  /** Conditional status write — same race-closing shape as SalesOrderRepository.updateStatusConditional. */
  updateStatusConditional: (id: string, expectedStatus: JournalStatus, data: Prisma.JournalUncheckedUpdateInput) =>
    prisma.journal.updateMany({ where: { id, status: expectedStatus }, data }),
};
