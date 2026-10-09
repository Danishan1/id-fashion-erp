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

/** The subset of a Prisma client (the global one or an interactive-transaction `tx`) this logger needs. */
type AuditLogWriter = Pick<Prisma.TransactionClient, "auditLog">;

/**
 * Every create/update/approve/reject/post/cancel/delete on a business record
 * must call this — enforced at the service layer, not left to individual
 * route handlers to remember. Never fails the parent transaction silently:
 * call within the same `prisma.$transaction` as the mutation it's recording.
 * Pass that transaction's `tx` as the second argument to make the audit row
 * commit or roll back together with the mutation (optional — defaults to the
 * global client, so every existing call site is unchanged).
 */
export async function writeAuditLog(options: WriteAuditLogOptions, db: AuditLogWriter = prisma) {
  return db.auditLog.create({
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
