import { prisma } from "@/core/db/client";
import type { AuditAction } from "@prisma/client";

export interface ListAuditLogsOptions {
  limit?: number;
  offset?: number;
  action?: AuditAction;
  companyId?: string;
  tableName?: string;
}

export async function listPlatformAuditLogs(options: ListAuditLogsOptions = {}) {
  const { limit = 50, offset = 0, action, companyId, tableName } = options;

  const where: any = {};
  if (action) where.action = action;
  if (companyId) where.companyId = companyId;
  if (tableName) where.tableName = tableName;

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { performedAt: "desc" },
      take: Math.min(limit, 100),
      skip: offset,
      include: {
        company: { select: { id: true, name: true } },
        platformUser: { select: { id: true, fullName: true, email: true, role: true } },
        user: { select: { id: true, fullName: true, email: true } },
      },
    }),
    prisma.auditLog.count({ where }),
  ]);

  return {
    total,
    logs: logs.map((log) => ({
      id: log.id,
      companyId: log.companyId,
      companyName: log.company.name,
      tableName: log.tableName,
      recordId: log.recordId,
      action: log.action,
      oldValues: log.oldValues,
      newValues: log.newValues,
      ipAddress: log.ipAddress,
      performedAt: log.performedAt,
      operator: log.platformUser
        ? {
            name: log.platformUser.fullName,
            email: log.platformUser.email,
            role: log.platformUser.role,
            isPlatform: true,
          }
        : log.user
        ? {
            name: log.user.fullName,
            email: log.user.email,
            role: "TENANT_USER",
            isPlatform: false,
          }
        : null,
    })),
  };
}
