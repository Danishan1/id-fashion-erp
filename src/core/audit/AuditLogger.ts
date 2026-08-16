import { prisma } from "@/core/db/client";
import { Prisma, type AuditAction } from "@prisma/client";

interface WriteAuditLogOptions {
  companyId: string;
  userId?: string | null;
  tableName: string;
  recordId: string;
  action: AuditAction;
  oldValues?: Record<string, unknown> | null;
  newValues?: Record<string, unknown> | null;
  ipAddress?: string | null;
}

/**
 * Every create/update/approve/reject/post/cancel/delete on a business record
 * must call this — enforced at the service layer, not left to individual
 * route handlers to remember. Never fails the parent transaction silently:
 * call within the same `prisma.$transaction` as the mutation it's recording.
 */
export async function writeAuditLog(options: WriteAuditLogOptions) {
  return prisma.auditLog.create({
    data: {
      companyId: options.companyId,
      userId: options.userId ?? null,
      tableName: options.tableName,
      recordId: options.recordId,
      action: options.action,
      oldValues: (options.oldValues as Prisma.InputJsonValue) ?? Prisma.JsonNull,
      newValues: (options.newValues as Prisma.InputJsonValue) ?? Prisma.JsonNull,
      ipAddress: options.ipAddress ?? null,
    },
  });
}
