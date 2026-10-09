import { Prisma, type CrmIngestOutcome, type CrmImportRowValidation } from "@prisma/client";
import { prisma } from "@/core/db/client";

export const IMPORT_JOB_SELECT = {
  id: true,
  companyId: true,
  fileName: true,
  fileType: true,
  fileSizeBytes: true,
  status: true,
  sourceId: true,
  duplicatePolicy: true,
  headers: true,
  mapping: true,
  options: true,
  totalRows: true,
  validRows: true,
  warningRows: true,
  errorRows: true,
  duplicateRows: true,
  processedRows: true,
  importedRows: true,
  updatedRows: true,
  skippedRows: true,
  flaggedRows: true,
  failedRows: true,
  errorSummary: true,
  validatedAt: true,
  startedAt: true,
  completedAt: true,
  cancelRequestedAt: true,
  createdByUserId: true,
  createdAt: true,
  updatedAt: true,
  source: { select: { id: true, name: true, key: true } },
  createdBy: { select: { id: true, fullName: true } },
} satisfies Prisma.CrmImportJobSelect;
export type ImportJobRow = Prisma.CrmImportJobGetPayload<{ select: typeof IMPORT_JOB_SELECT }>;

export const IMPORT_ROW_SELECT = {
  id: true,
  rowNumber: true,
  raw: true,
  normalized: true,
  validation: true,
  messages: true,
  duplicateMatches: true,
  inFileDuplicateOf: true,
  outcome: true,
  outcomeReason: true,
  leadId: true,
  reviewedAt: true,
  processedAt: true,
  lead: { select: { id: true, leadNumber: true, fullName: true } },
} satisfies Prisma.CrmImportRowSelect;
export type ImportRowRecord = Prisma.CrmImportRowGetPayload<{ select: typeof IMPORT_ROW_SELECT }>;

export const CrmImportRepository = {
  createJob(data: Prisma.CrmImportJobUncheckedCreateInput) {
    return prisma.crmImportJob.create({ data, select: IMPORT_JOB_SELECT });
  },
  async insertRows(jobId: string, rows: { rowNumber: number; raw: Record<string, string> }[]) {
    for (let i = 0; i < rows.length; i += 1000) {
      await prisma.crmImportRow.createMany({ data: rows.slice(i, i + 1000).map((r) => ({ jobId, rowNumber: r.rowNumber, raw: r.raw })) });
    }
  },
  findJob(where: Prisma.CrmImportJobWhereInput) {
    return prisma.crmImportJob.findFirst({ where, select: { ...IMPORT_JOB_SELECT, fileKey: true, queueJobId: true } });
  },
  listJobs(where: Prisma.CrmImportJobWhereInput, skip: number, take: number) {
    return Promise.all([
      prisma.crmImportJob.findMany({ where, select: IMPORT_JOB_SELECT, orderBy: { createdAt: "desc" }, skip, take }),
      prisma.crmImportJob.count({ where }),
    ]);
  },
  updateJob(id: string, data: Prisma.CrmImportJobUncheckedUpdateInput) {
    return prisma.crmImportJob.update({ where: { id }, data, select: IMPORT_JOB_SELECT });
  },
  /** Conditional status change — returns false when another request already moved the job on. */
  async transition(id: string, from: Prisma.CrmImportJobWhereInput["status"], data: Prisma.CrmImportJobUncheckedUpdateManyInput) {
    const { count } = await prisma.crmImportJob.updateMany({ where: { id, status: from }, data });
    return count === 1;
  },
  rowsChunk(jobId: string, afterRow: number, take: number, where: Prisma.CrmImportRowWhereInput = {}) {
    return prisma.crmImportRow.findMany({ where: { jobId, rowNumber: { gt: afterRow }, ...where }, orderBy: { rowNumber: "asc" }, take, select: IMPORT_ROW_SELECT });
  },
  listRows(where: Prisma.CrmImportRowWhereInput, skip: number, take: number) {
    return Promise.all([
      prisma.crmImportRow.findMany({ where, orderBy: { rowNumber: "asc" }, skip, take, select: IMPORT_ROW_SELECT }),
      prisma.crmImportRow.count({ where }),
    ]);
  },
  rowsByIds(jobId: string, ids: string[]) {
    return prisma.crmImportRow.findMany({ where: { jobId, id: { in: ids } }, orderBy: { rowNumber: "asc" }, select: IMPORT_ROW_SELECT });
  },
  updateRow(id: string, data: Prisma.CrmImportRowUncheckedUpdateInput) {
    return prisma.crmImportRow.update({ where: { id }, data });
  },
  updateRows(updates: { id: string; data: Prisma.CrmImportRowUncheckedUpdateInput }[]) {
    return prisma.$transaction(updates.map((u) => prisma.crmImportRow.update({ where: { id: u.id }, data: u.data })));
  },
  resetRows(jobId: string) {
    return prisma.crmImportRow.updateMany({
      where: { jobId },
      data: { normalized: Prisma.DbNull, validation: "PENDING", messages: [], duplicateMatches: Prisma.DbNull, inFileDuplicateOf: null },
    });
  },
  markPending(jobId: string, outcome: CrmIngestOutcome, reason: string) {
    return prisma.crmImportRow.updateMany({ where: { jobId, outcome: "PENDING" }, data: { outcome, outcomeReason: reason, processedAt: new Date() } });
  },
  async outcomeCounts(jobId: string) {
    const groups = await prisma.crmImportRow.groupBy({ by: ["outcome"], where: { jobId }, _count: { _all: true } });
    return Object.fromEntries(groups.map((g) => [g.outcome, g._count._all])) as Partial<Record<CrmIngestOutcome, number>>;
  },
  async validationCounts(jobId: string) {
    const [groups, duplicates] = await Promise.all([
      prisma.crmImportRow.groupBy({ by: ["validation"], where: { jobId }, _count: { _all: true } }),
      prisma.crmImportRow.count({ where: { jobId, OR: [{ inFileDuplicateOf: { not: null } }, { NOT: { duplicateMatches: { equals: Prisma.DbNull } } }] } }),
    ]);
    return { byValidation: Object.fromEntries(groups.map((g) => [g.validation, g._count._all])) as Partial<Record<CrmImportRowValidation, number>>, duplicates };
  },
  activeUser(companyId: string, id: string) {
    return prisma.user.findFirst({ where: { id, companyId, status: "ACTIVE" }, select: { id: true } });
  },
  externalRefs(companyId: string, provider: string, externalIds: string[]) {
    return prisma.crmLeadExternalRef.findMany({
      where: { companyId, provider, externalId: { in: externalIds } },
      select: { externalId: true, lead: { select: { id: true, leadNumber: true } } },
    });
  },
  staleJobs(before: Date) {
    return prisma.crmImportJob.findMany({
      where: { OR: [{ status: { in: ["PENDING", "READY"] }, updatedAt: { lt: before } }, { status: { in: ["COMPLETED", "PARTIALLY_COMPLETED", "FAILED", "CANCELLED"] }, fileKey: { not: null } }] },
      select: { id: true, companyId: true, status: true, fileKey: true, createdByUserId: true },
      take: 200,
    });
  },
};
