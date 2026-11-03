import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { writeAuditLog } from "@/core/audit/AuditLogger";
import type { SalesActor } from "@/modules/sales-marketing/enquiries/sales-enquiry.service";
import type { PerformanceEventType } from "./performance-registry";

/** Shared helpers for the Phase 05 services (events, audit, schemas). */

export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date");
export const optionalText = (max: number) => z.string().trim().max(max).optional().or(z.literal("")).nullable();
export const blank = (v: string | null | undefined) => (v ? v : null);
export const reasonSchema = z.object({ reason: z.string().trim().min(3, "Say why").max(1000) }).strict();
export const commentSchema = z.object({ comment: optionalText(1000) }).strict();

/** A @db.Date column as "YYYY-MM-DD" (Prisma reads it as UTC midnight). */
export const dbDate = (d: Date) => d.toISOString().slice(0, 10);
/** "YYYY-MM-DD" → the Date Prisma stores in a @db.Date column. */
export const toDbDate = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

export type PerformanceEntity = "TERRITORY" | "TARGET" | "SALES_ORDER";

export function recordPerformanceEvent(
  tx: Prisma.TransactionClient,
  actor: SalesActor,
  entityType: PerformanceEntity,
  entityId: string,
  type: PerformanceEventType,
  comment: string | null = null,
  metadata: Record<string, unknown> = {}
) {
  return tx.salesPerformanceEvent.create({
    data: { companyId: actor.companyId, entityType, entityId, type, comment, metadata: metadata as Prisma.InputJsonValue, createdByUserId: actor.userId },
  });
}

export async function auditPerformance(
  tx: Prisma.TransactionClient,
  actor: SalesActor,
  tableName: string,
  recordId: string,
  action: "CREATE" | "UPDATE" | "APPROVE" | "REJECT" | "DELETE",
  oldValues: unknown,
  newValues: unknown
) {
  await writeAuditLog(
    { companyId: actor.companyId, userId: actor.userId, tableName, recordId, action, oldValues: oldValues as Record<string, unknown>, newValues: newValues as Record<string, unknown> },
    tx
  );
}

export async function listPerformanceEvents(tx: Prisma.TransactionClient, companyId: string, entityType: PerformanceEntity, entityId: string) {
  const rows = await tx.salesPerformanceEvent.findMany({
    where: { companyId, entityType, entityId },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { createdBy: { select: { fullName: true } } },
  });
  return rows.map((e) => ({ id: e.id, type: e.type, comment: e.comment, metadata: e.metadata, at: e.createdAt.toISOString(), by: e.createdBy.fullName }));
}
