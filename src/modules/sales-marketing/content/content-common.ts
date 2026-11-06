import type { Prisma } from "@prisma/client";
import { prisma } from "@/core/db/client";
import { writeAuditLog } from "@/core/audit/AuditLogger";
import { createNotification } from "@/core/notifications/NotificationService";
import { PermissionService } from "@/core/rbac/PermissionService";
import type { SalesActor } from "@/modules/sales-marketing/enquiries/sales-enquiry.service";

/** Shared helpers of the Phase 11 content library. */

export type Db = Prisma.TransactionClient | typeof prisma;
export const ASSETS_TABLE = "marketing_assets";
export const ASSET_VERSIONS_TABLE = "marketing_asset_versions";
export const REVIEWS_TABLE = "marketing_content_reviews";
export const CONTENTS_TABLE = "marketing_campaign_contents";

export function auditContent(tx: Db, actor: SalesActor, tableName: string, recordId: string, action: "CREATE" | "UPDATE" | "DELETE" | "APPROVE" | "REJECT", oldValues: unknown, newValues: unknown) {
  return writeAuditLog(
    { companyId: actor.companyId, userId: actor.userId, tableName, recordId, action, oldValues: (oldValues ?? null) as Record<string, unknown> | null, newValues: (newValues ?? null) as Record<string, unknown> | null },
    tx as Prisma.TransactionClient
  );
}

/** Campaign history row (as Phases 08–10 do). */
export function recordContentCampaignEvent(tx: Db, actor: SalesActor, campaignId: string, type: string, comment: string | null, metadata: Record<string, unknown>) {
  return tx.salesPerformanceEvent.create({ data: { companyId: actor.companyId, entityType: "CAMPAIGN", entityId: campaignId, type, comment, metadata: metadata as Prisma.InputJsonValue, createdByUserId: actor.userId } });
}

export async function userNames(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((i): i is string => Boolean(i)))];
  if (!unique.length) return new Map();
  const rows = await prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, fullName: true } });
  return new Map(rows.map((u) => [u.id, u.fullName]));
}

/** Tell everyone who may approve content (except the people involved) that something waits. */
export async function notifyContentApprovers(tx: Prisma.TransactionClient, actor: SalesActor, exclude: string[], title: string, body: string) {
  const users = await prisma.user.findMany({ where: { companyId: actor.companyId, status: "ACTIVE", supportForPlatformUserId: null }, select: { id: true } });
  const ok = await Promise.all(users.map((u) => PermissionService.can(u.id, "marketing_content", "approve")));
  for (const u of users.filter((x, i) => ok[i] && !exclude.includes(x.id))) await createNotification({ companyId: actor.companyId, userId: u.id, title, body }, tx);
}

export async function notifyContentUsers(tx: Prisma.TransactionClient, actor: SalesActor, userIds: (string | null | undefined)[], title: string, body: string) {
  for (const userId of new Set(userIds.filter((u): u is string => Boolean(u) && u !== actor.userId))) await createNotification({ companyId: actor.companyId, userId, title, body }, tx);
}

export const searchTextOf = (...parts: (string | null | undefined | string[])[]) =>
  parts
    .flat()
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 2000);
