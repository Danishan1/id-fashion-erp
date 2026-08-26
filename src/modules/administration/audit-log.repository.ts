import { prisma } from "@/core/db/client";
import type { Prisma } from "@prisma/client";

const INCLUDE = {
  user: { select: { id: true, fullName: true, email: true } },
} satisfies Prisma.AuditLogInclude;

export const AuditLogRepository = {
  findMany(where: Prisma.AuditLogWhereInput, orderBy: Prisma.AuditLogOrderByWithRelationInput, skip: number, take: number) {
    return prisma.auditLog.findMany({ where, orderBy, skip, take, include: INCLUDE });
  },

  count(where: Prisma.AuditLogWhereInput) {
    return prisma.auditLog.count({ where });
  },

  // Populates the Table filter dropdown from what this company's own audit
  // trail actually contains, rather than a hand-maintained list that would
  // drift every time a new module starts writing audit rows.
  async findDistinctTableNames(companyId: string): Promise<string[]> {
    const rows = await prisma.auditLog.findMany({
      where: { companyId },
      distinct: ["tableName"],
      select: { tableName: true },
      orderBy: { tableName: "asc" },
    });
    return rows.map((r) => r.tableName);
  },
};
