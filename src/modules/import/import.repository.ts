import { prisma } from "@/core/db/client";
import type { ImportBatchType, Prisma } from "@prisma/client";

export const ImportBatchRepository = {
  create: (data: {
    companyId: string;
    importType: ImportBatchType;
    fileName: string;
    totalRows: number;
    importedCount: number;
    skippedCount: number;
    failedRowsJson: Prisma.InputJsonValue | null;
    createdByUserId: string;
  }) =>
    prisma.importBatch.create({
      data: {
        companyId: data.companyId,
        importType: data.importType,
        fileName: data.fileName,
        totalRows: data.totalRows,
        importedCount: data.importedCount,
        skippedCount: data.skippedCount,
        failedRowsJson: data.failedRowsJson ?? undefined,
        createdByUserId: data.createdByUserId,
      },
    }),

  findMany: (where: Prisma.ImportBatchWhereInput, skip: number, take: number) =>
    prisma.importBatch.findMany({
      where,
      select: {
        id: true,
        importType: true,
        fileName: true,
        totalRows: true,
        importedCount: true,
        skippedCount: true,
        failedRowsJson: true,
        createdAt: true,
        createdBy: { select: { fullName: true } },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take,
    }),

  count: (where: Prisma.ImportBatchWhereInput) => prisma.importBatch.count({ where }),

  findByIdWithDetails: (companyId: string, id: string) =>
    prisma.importBatch.findFirst({
      where: { id, companyId },
      include: { createdBy: { select: { fullName: true } } },
    }),
};
