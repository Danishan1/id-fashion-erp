import type { Prisma } from "@prisma/client";
import type { ListQuery } from "@/lib/list-query";
import { AuditLogRepository } from "./audit-log.repository";
import type { AuditLogListFiltersInput } from "./audit-log.schema";

export async function listAuditLogs(companyId: string, query: ListQuery, filters: AuditLogListFiltersInput) {
  const where: Prisma.AuditLogWhereInput = {
    companyId,
    ...(filters.tableName ? { tableName: filters.tableName } : {}),
    ...(filters.action ? { action: filters.action } : {}),
    ...(filters.userId ? { userId: filters.userId } : {}),
    ...(filters.recordId ? { recordId: filters.recordId } : {}),
    ...(filters.dateFrom || filters.dateTo
      ? {
          performedAt: {
            ...(filters.dateFrom ? { gte: new Date(filters.dateFrom) } : {}),
            // Inclusive of the whole "to" calendar day, matching the same
            // dateTo-as-end-of-day convention already used by every other
            // date-range filter in this codebase (e.g. Sampling's worklist).
            ...(filters.dateTo ? { lte: new Date(`${filters.dateTo}T23:59:59.999Z`) } : {}),
          },
        }
      : {}),
  };

  const orderBy: Prisma.AuditLogOrderByWithRelationInput = { [query.sortBy]: query.sortOrder };

  const [data, totalCount] = await Promise.all([
    AuditLogRepository.findMany(where, orderBy, query.skip, query.take),
    AuditLogRepository.count(where),
  ]);

  return { data, totalCount };
}

export function listDistinctAuditedTables(companyId: string) {
  return AuditLogRepository.findDistinctTableNames(companyId);
}
