import { prisma } from "@/core/db/client";
import { Prisma } from "@prisma/client";
import type { ImportBatchStatus, ImportBatchType } from "@prisma/client";

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
        status: true,
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

  // --- Bulk Master Data Import portal additions (2026-09-04) ---

  createQueued: (data: {
    companyId: string;
    importType: ImportBatchType;
    fileName: string;
    totalRows: number;
    originalFileKey: string | null;
    createdByUserId: string;
  }) =>
    prisma.importBatch.create({
      data: {
        companyId: data.companyId,
        importType: data.importType,
        fileName: data.fileName,
        totalRows: data.totalRows,
        importedCount: 0,
        skippedCount: 0,
        status: "QUEUED",
        originalFileKey: data.originalFileKey,
        createdByUserId: data.createdByUserId,
      },
    }),

  setJobId: (id: string, jobId: string) => prisma.importBatch.update({ where: { id }, data: { jobId } }),

  setStatus: (id: string, status: ImportBatchStatus) => prisma.importBatch.update({ where: { id }, data: { status } }),

  finalize: (
    id: string,
    data: { importedCount: number; skippedCount: number; failedRowsJson: Prisma.InputJsonValue | null; status: ImportBatchStatus }
  ) =>
    prisma.importBatch.update({
      where: { id },
      data: { ...data, failedRowsJson: data.failedRowsJson ?? Prisma.JsonNull },
    }),

  /** No companyId scoping -- called only from the trusted worker process,
   * which already received a fully-resolved actor/batchId pair at enqueue
   * time (never from client input). */
  findRawById: (id: string) => prisma.importBatch.findUnique({ where: { id } }),

  addRecord: (data: { importBatchId: string; rowNumber: number; tableName: string; recordId: string }) =>
    prisma.importBatchRecord.create({ data }),

  findRecordsForBatch: (importBatchId: string) => prisma.importBatchRecord.findMany({ where: { importBatchId } }),
};
