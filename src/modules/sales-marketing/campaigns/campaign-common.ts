import type { MarketingCampaign, Prisma } from "@prisma/client";
import { prisma } from "@/core/db/client";
import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { getTeamScope } from "@/core/hierarchy/team-scope";
import { createNotification } from "@/core/notifications/NotificationService";
import { PermissionService } from "@/core/rbac/PermissionService";
import type { SalesActor } from "@/modules/sales-marketing/enquiries/sales-enquiry.service";

/**
 * Shared campaign helpers (Phase 08): visibility, loading, history events
 * (sales_performance_events, entity CAMPAIGN), audit and approver notices.
 */

export const CAMPAIGN_TABLE = "marketing_campaigns";
type Db = Prisma.TransactionClient | typeof prisma;

export interface CampaignScope {
  userId: string;
  viewAll: boolean;
  /** The viewer and everyone below them in the CRM reporting tree. */
  visibleOwnerIds: string[];
}

export async function getCampaignScope(actor: SalesActor): Promise<CampaignScope> {
  const [viewAll, team] = await Promise.all([PermissionService.can(actor.userId, "marketing_campaigns", "view_all"), getTeamScope(actor.userId, "CRM")]);
  return { userId: actor.userId, viewAll, visibleOwnerIds: [actor.userId, ...team.teamUserIds] };
}

/** Owner (or someone below the viewer owns it) or creator, unless view_all. */
export function campaignScopeWhere(actor: SalesActor, scope: CampaignScope): Prisma.MarketingCampaignWhereInput {
  if (scope.viewAll) return { companyId: actor.companyId };
  return { companyId: actor.companyId, OR: [{ ownerUserId: { in: scope.visibleOwnerIds } }, { createdByUserId: actor.userId }] };
}

export async function loadCampaign(actor: SalesActor, id: string, scope?: CampaignScope): Promise<MarketingCampaign> {
  const s = scope ?? (await getCampaignScope(actor));
  const c = await prisma.marketingCampaign.findFirst({ where: { AND: [{ id }, campaignScopeWhere(actor, s)] } });
  if (!c) throw new BusinessRuleError("NOT_FOUND", "Campaign not found.", { id });
  return c;
}

/** For other modules (CRM activity access, link panels): can this user see the campaign? */
export async function canSeeCampaign(actor: SalesActor, id: string) {
  if (!(await PermissionService.can(actor.userId, "marketing_campaigns", "view"))) return false;
  try {
    await loadCampaign(actor, id);
    return true;
  } catch {
    return false;
  }
}

export function recordCampaignEvent(tx: Db, actor: SalesActor, campaignId: string, type: string, comment: string | null = null, metadata: Record<string, unknown> = {}) {
  return tx.salesPerformanceEvent.create({
    data: { companyId: actor.companyId, entityType: "CAMPAIGN", entityId: campaignId, type, comment, metadata: metadata as Prisma.InputJsonValue, createdByUserId: actor.userId },
  });
}

export async function listCampaignEvents(companyId: string, campaignId: string) {
  const rows = await prisma.salesPerformanceEvent.findMany({
    where: { companyId, entityType: "CAMPAIGN", entityId: campaignId },
    orderBy: { createdAt: "desc" },
    take: 300,
    include: { createdBy: { select: { fullName: true } } },
  });
  return rows.map((e) => ({ id: e.id, type: e.type, comment: e.comment, metadata: e.metadata, at: e.createdAt.toISOString(), by: e.createdBy.fullName }));
}

export async function auditCampaign(tx: Db, actor: SalesActor, recordId: string, action: "CREATE" | "UPDATE" | "APPROVE" | "REJECT" | "DELETE", oldValues: unknown, newValues: unknown, tableName = CAMPAIGN_TABLE) {
  await writeAuditLog(
    { companyId: actor.companyId, userId: actor.userId, tableName, recordId, action, oldValues: oldValues as Record<string, unknown>, newValues: newValues as Record<string, unknown> },
    tx as Prisma.TransactionClient
  );
}

/** Approve needs `approve` and must not be (one of) the people who prepared / asked for it (Super Admin excepted). */
export async function canApproveCampaign(userId: string, involved: (string | null | undefined)[]) {
  const people = [...new Set(involved.filter((v): v is string => Boolean(v)))];
  if (!people.length) return PermissionService.can(userId, "marketing_campaigns", "approve");
  for (const createdBy of people) if (!(await PermissionService.can(userId, "marketing_campaigns", "approve", { createdBy }))) return false;
  return true;
}

export async function notifyCampaignApprovers(tx: Prisma.TransactionClient, actor: SalesActor, exclude: (string | null)[], title: string, body: string) {
  const users = await prisma.user.findMany({ where: { companyId: actor.companyId, status: "ACTIVE", supportForPlatformUserId: null }, select: { id: true } });
  const ok = await Promise.all(users.map((u) => PermissionService.can(u.id, "marketing_campaigns", "approve")));
  for (const u of users.filter((x, i) => ok[i] && !exclude.includes(x.id))) await createNotification({ companyId: actor.companyId, userId: u.id, title, body }, tx);
}

export async function notifyUsers(tx: Prisma.TransactionClient, actor: SalesActor, userIds: (string | null | undefined)[], title: string, body: string) {
  for (const userId of new Set(userIds.filter((u): u is string => Boolean(u) && u !== actor.userId))) await createNotification({ companyId: actor.companyId, userId, title, body }, tx);
}

/** Optimistic, status-guarded update of the campaign row. */
export async function guardedCampaignUpdate(tx: Prisma.TransactionClient, actor: SalesActor, c: Pick<MarketingCampaign, "id" | "status" | "version">, data: Prisma.MarketingCampaignUncheckedUpdateManyInput) {
  const { count } = await tx.marketingCampaign.updateMany({
    where: { id: c.id, companyId: actor.companyId, status: c.status, version: c.version },
    data: { ...data, updatedByUserId: actor.userId, version: { increment: 1 } },
  });
  if (count === 0) throw new BusinessRuleError("RECORD_VERSION_CONFLICT", "This campaign was changed by someone else just now. Reload and try again.");
}
