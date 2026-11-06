import type { MarketingSegment, Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { prisma } from "@/core/db/client";
import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { getTeamScope } from "@/core/hierarchy/team-scope";
import { PermissionService } from "@/core/rbac/PermissionService";
import type { SalesActor } from "@/modules/sales-marketing/enquiries/sales-enquiry.service";
import type { SegmentSourceKey } from "./segment-registry";

/**
 * Shared segment helpers (Phase 09): visibility (same rule as campaigns —
 * owner / creator / owner in the viewer's CRM team, unless view_all), loading,
 * history events (sales_performance_events, entity SEGMENT), audit, and the
 * minimal display data for member lists (names only — no contact details).
 */

export const SEGMENT_TABLE = "marketing_segments";
type Db = Prisma.TransactionClient | typeof prisma;

export interface SegmentScope {
  userId: string;
  viewAll: boolean;
  visibleOwnerIds: string[];
}

export async function getSegmentScope(actor: SalesActor): Promise<SegmentScope> {
  const [viewAll, team] = await Promise.all([PermissionService.can(actor.userId, "marketing_segments", "view_all"), getTeamScope(actor.userId, "CRM")]);
  return { userId: actor.userId, viewAll, visibleOwnerIds: [actor.userId, ...team.teamUserIds] };
}

export function segmentScopeWhere(actor: SalesActor, scope: SegmentScope): Prisma.MarketingSegmentWhereInput {
  if (scope.viewAll) return { companyId: actor.companyId };
  return { companyId: actor.companyId, OR: [{ ownerUserId: { in: scope.visibleOwnerIds } }, { createdByUserId: actor.userId }] };
}

export async function loadSegment(actor: SalesActor, id: string, scope?: SegmentScope): Promise<MarketingSegment> {
  const s = scope ?? (await getSegmentScope(actor));
  const seg = await prisma.marketingSegment.findFirst({ where: { AND: [{ id }, segmentScopeWhere(actor, s)] } });
  if (!seg) throw new BusinessRuleError("NOT_FOUND", "Segment not found.", { id });
  return seg;
}

export function assertNotArchived(seg: Pick<MarketingSegment, "status">) {
  if (seg.status === "ARCHIVED") throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This segment is archived and can't be changed.");
}

export function recordSegmentEvent(tx: Db, actor: { companyId: string; userId: string }, segmentId: string, type: string, comment: string | null = null, metadata: Record<string, unknown> = {}) {
  return tx.salesPerformanceEvent.create({
    data: { companyId: actor.companyId, entityType: "SEGMENT", entityId: segmentId, type, comment, metadata: metadata as Prisma.InputJsonValue, createdByUserId: actor.userId },
  });
}

export async function listSegmentEvents(companyId: string, segmentId: string) {
  const rows = await prisma.salesPerformanceEvent.findMany({
    where: { companyId, entityType: "SEGMENT", entityId: segmentId },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { createdBy: { select: { fullName: true } } },
  });
  return rows.map((e) => ({ id: e.id, type: e.type, comment: e.comment, metadata: e.metadata, at: e.createdAt.toISOString(), by: e.createdBy.fullName }));
}

export async function auditSegment(tx: Db, actor: { companyId: string; userId: string }, recordId: string, action: "CREATE" | "UPDATE" | "DELETE", oldValues: unknown, newValues: unknown, tableName = SEGMENT_TABLE) {
  await writeAuditLog(
    { companyId: actor.companyId, userId: actor.userId, tableName, recordId, action, oldValues: oldValues as Record<string, unknown>, newValues: newValues as Record<string, unknown> },
    tx as Prisma.TransactionClient
  );
}

/** Optimistic, status-guarded update of the segment row. */
export async function guardedSegmentUpdate(tx: Prisma.TransactionClient, actor: SalesActor, s: Pick<MarketingSegment, "id" | "status" | "version">, data: Prisma.MarketingSegmentUncheckedUpdateManyInput) {
  const { count } = await tx.marketingSegment.updateMany({
    where: { id: s.id, companyId: actor.companyId, status: s.status, version: s.version },
    data: { ...data, updatedByUserId: actor.userId, version: { increment: 1 } },
  });
  if (count === 0) throw new BusinessRuleError("RECORD_VERSION_CONFLICT", "This segment was changed by someone else just now. Reload and try again.");
}

/** Stable hash of a definition (key order independent) — detects "nothing changed". */
export function definitionHash(def: { criteria: unknown; exclusionCriteria: unknown; eligibilityChannel: string | null }): string {
  const canon = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(canon);
    if (v && typeof v === "object") return Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])]));
    return v;
  };
  return createHash("sha256").update(JSON.stringify(canon(def))).digest("hex");
}

// ── Display data for member / preview lists ─────────────────────────

export interface RecordDisplay {
  id: string;
  name: string;
  organization: string | null;
  status: string | null;
  owner: string | null;
  location: string | null;
  href: string;
}

const loc = (...parts: (string | null | undefined)[]) => parts.filter(Boolean).join(", ") || null;

/** Minimal, non-sensitive fields for a set of record ids (no emails / phones). */
export async function loadDisplay(db: Db, companyId: string, source: SegmentSourceKey, ids: string[]): Promise<Map<string, RecordDisplay>> {
  const map = new Map<string, RecordDisplay>();
  if (!ids.length) return map;
  if (source === "CONTACT") {
    const rows = await db.crmContact.findMany({
      where: { companyId, id: { in: ids } },
      select: { id: true, fullName: true, designation: true, archivedAt: true, mergedIntoId: true, crmCompany: { select: { name: true, city: true, country: true } }, owner: { select: { fullName: true } } },
    });
    for (const r of rows)
      map.set(r.id, {
        id: r.id,
        name: r.fullName,
        organization: r.crmCompany?.name ?? null,
        status: r.mergedIntoId ? "Merged" : r.archivedAt ? "Archived" : (r.designation ?? null),
        owner: r.owner?.fullName ?? null,
        location: loc(r.crmCompany?.city, r.crmCompany?.country),
        href: `/crm/contacts/${r.id}`,
      });
  } else if (source === "COMPANY") {
    const rows = await db.crmCompany.findMany({
      where: { companyId, id: { in: ids } },
      select: { id: true, name: true, industry: true, city: true, country: true, archivedAt: true, mergedIntoId: true, status: { select: { name: true } }, owner: { select: { fullName: true } } },
    });
    for (const r of rows)
      map.set(r.id, { id: r.id, name: r.name, organization: r.industry, status: r.mergedIntoId ? "Merged" : r.archivedAt ? "Archived" : (r.status?.name ?? null), owner: r.owner?.fullName ?? null, location: loc(r.city, r.country), href: `/crm/companies/${r.id}` });
  } else if (source === "LEAD") {
    const rows = await db.crmLead.findMany({
      where: { companyId, id: { in: ids } },
      select: { id: true, fullName: true, leadNumber: true, companyName: true, city: true, country: true, archivedAt: true, status: { select: { name: true } }, owner: { select: { fullName: true } } },
    });
    for (const r of rows)
      map.set(r.id, { id: r.id, name: `${r.fullName} (${r.leadNumber})`, organization: r.companyName, status: r.archivedAt ? "Archived" : r.status.name, owner: r.owner?.fullName ?? null, location: loc(r.city, r.country), href: `/crm/leads/${r.id}` });
  } else {
    const rows = await db.customer.findMany({
      where: { companyId, id: { in: ids } },
      select: { id: true, name: true, code: true, type: true, city: true, country: true, isActive: true, deletedAt: true, salesTerritory: { select: { name: true } } },
    });
    for (const r of rows)
      map.set(r.id, {
        id: r.id,
        name: `${r.name} (${r.code})`,
        organization: r.salesTerritory?.name ?? null,
        status: r.deletedAt ? "Deleted" : r.isActive ? r.type : "Inactive",
        owner: null,
        location: loc(r.city, r.country),
        href: `/masters/customers/${r.id}`,
      });
  }
  return map;
}

/** Display rows in the given id order; ids with no readable record show as unavailable. */
export function displayRows(ids: string[], map: Map<string, RecordDisplay>): RecordDisplay[] {
  return ids.map((id) => map.get(id) ?? { id, name: "(record no longer available)", organization: null, status: null, owner: null, location: null, href: "" });
}
