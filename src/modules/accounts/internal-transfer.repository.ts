import { prisma } from "@/core/db/client";
import type { Prisma, InternalTransferStatus } from "@prisma/client";

const detailInclude = {
  fromPaymentType: { select: { id: true, name: true, type: true } },
  toPaymentType: { select: { id: true, name: true, type: true } },
  fromBankAccount: { select: { id: true, name: true, bankName: true } },
  toBankAccount: { select: { id: true, name: true, bankName: true } },
  journal: { select: { id: true, journalNumber: true, status: true } },
  createdBy: { select: { id: true, fullName: true } },
  postedBy: { select: { id: true, fullName: true } },
} satisfies Prisma.InternalTransferInclude;

export const InternalTransferRepository = {
  findMany: (where: Prisma.InternalTransferWhereInput, args: Omit<Prisma.InternalTransferFindManyArgs, "where">) =>
    prisma.internalTransfer.findMany({
      where,
      include: {
        fromPaymentType: { select: { id: true, name: true } },
        toPaymentType: { select: { id: true, name: true } },
      },
      ...args,
    }),

  count: (where: Prisma.InternalTransferWhereInput) => prisma.internalTransfer.count({ where }),

  findAnyById: (companyId: string, id: string) => prisma.internalTransfer.findFirst({ where: { id, companyId } }),

  /** CF-5 idempotent-replay lookup. */
  findByIdempotencyKey: (companyId: string, idempotencyKey: string) =>
    prisma.internalTransfer.findUnique({ where: { companyId_idempotencyKey: { companyId, idempotencyKey } } }),

  findByIdWithDetails: (companyId: string, id: string) =>
    prisma.internalTransfer.findFirst({ where: { id, companyId }, include: detailInclude }),

  create: (data: Prisma.InternalTransferUncheckedCreateInput) => prisma.internalTransfer.create({ data, include: detailInclude }),

  /** Conditional status write — same race-closing shape used throughout this project. */
  updateStatusConditional: (id: string, expectedStatus: InternalTransferStatus, data: Prisma.InternalTransferUncheckedUpdateInput) =>
    prisma.internalTransfer.updateMany({ where: { id, status: expectedStatus }, data }),
};
