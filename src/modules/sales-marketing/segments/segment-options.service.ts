import { prisma } from "@/core/db/client";
import { PermissionService } from "@/core/rbac/PermissionService";
import type { SalesActor } from "@/modules/sales-marketing/enquiries/sales-enquiry.service";
import { SEGMENT_FIELDS, type LookupKey, type SegmentSourceKey } from "./segment-registry";

/**
 * Option lists for the criteria builder (Phase 09): only the lookups the
 * chosen source's fields use, from this company's own masters. Ids picked
 * here are filter values only — a foreign id simply matches nothing.
 */
export async function segmentFieldOptions(actor: SalesActor, source: SegmentSourceKey) {
  await PermissionService.assert(actor.userId, "marketing_segments", "view");
  const needed = new Set(SEGMENT_FIELDS[source].map((f) => f.lookup).filter((l): l is LookupKey => Boolean(l)));
  const c = actor.companyId;
  const out: Partial<Record<LookupKey, { value: string; label: string }[]>> = {};
  const tasks: Promise<void>[] = [];
  const add = (key: LookupKey, p: Promise<{ value: string; label: string }[]>) => {
    if (needed.has(key)) tasks.push(p.then((v) => void (out[key] = v)));
  };
  add("users", prisma.user.findMany({ where: { companyId: c, supportForPlatformUserId: null }, orderBy: { fullName: "asc" }, select: { id: true, fullName: true, status: true } }).then((r) => r.map((u) => ({ value: u.id, label: u.status === "ACTIVE" ? u.fullName : `${u.fullName} (inactive)` }))));
  add("leadSources", prisma.crmLeadSource.findMany({ where: { companyId: c }, orderBy: { name: "asc" }, select: { id: true, name: true } }).then((r) => r.map((x) => ({ value: x.id, label: x.name }))));
  add("leadStatuses", prisma.crmLeadStatus.findMany({ where: { companyId: c }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }).then((r) => r.map((x) => ({ value: x.id, label: x.name }))));
  add("companyStatuses", prisma.crmCompanyStatus.findMany({ where: { companyId: c }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }).then((r) => r.map((x) => ({ value: x.id, label: x.name }))));
  add("territories", prisma.salesTerritory.findMany({ where: { companyId: c }, orderBy: { name: "asc" }, select: { id: true, name: true } }).then((r) => r.map((x) => ({ value: x.id, label: x.name }))));
  add("campaigns", prisma.marketingCampaign.findMany({ where: { companyId: c }, orderBy: { code: "asc" }, select: { id: true, code: true, name: true } }).then((r) => r.map((x) => ({ value: x.id, label: `${x.code} · ${x.name}` }))));
  add("tags", prisma.crmTag.findMany({ where: { companyId: c }, orderBy: { name: "asc" }, select: { id: true, name: true } }).then((r) => r.map((x) => ({ value: x.id, label: x.name }))));
  await Promise.all(tasks);
  return out;
}

/** Active users who can own a segment (have marketing_segments.view). */
export async function segmentOwnerOptions(actor: SalesActor) {
  await PermissionService.assert(actor.userId, "marketing_segments", "view");
  const users = await prisma.user.findMany({ where: { companyId: actor.companyId, status: "ACTIVE", supportForPlatformUserId: null }, orderBy: { fullName: "asc" }, select: { id: true, fullName: true } });
  const ok = await Promise.all(users.map((u) => PermissionService.can(u.id, "marketing_segments", "view")));
  return users.filter((_, i) => ok[i]).map((u) => ({ id: u.id, label: u.fullName }));
}

/** Which record types this user can build segments on. */
export async function availableSources(actor: SalesActor): Promise<SegmentSourceKey[]> {
  const [crm, customers] = await Promise.all([PermissionService.can(actor.userId, "crm", "view"), PermissionService.can(actor.userId, "masters_core", "view")]);
  return [...(crm ? (["CONTACT", "COMPANY", "LEAD"] as const) : []), ...(customers ? (["CUSTOMER"] as const) : [])];
}
