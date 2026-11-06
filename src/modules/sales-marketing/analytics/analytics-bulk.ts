import { z } from "zod";
import { prisma } from "@/core/db/client";
import { registerAction, registerEntity } from "@/modules/bulk-actions/bulk-registry";
import type { BulkActionDefinition, BulkEntityDefinition } from "@/modules/bulk-actions/bulk-types";
import { deliverSavedReport } from "./analytics-delivery.service";

/**
 * Phase 17 — scheduled report delivery on the Phase 14 schedule engine.
 *
 * Entity SM_ANALYTICS_REPORT (a saved report), selected by the filter
 * `reportId=<id>`; action `analytics_report.deliver` is schedulable. Each
 * scheduled run is an ordinary bulk job started AS THE OWNER (so owner
 * permission and ownership are re-checked every run); the item then produces
 * one copy per recipient with the RECIPIENT's permissions. The job item's
 * idempotency key is the delivery run key, so a retried item never sends a
 * recipient a second copy.
 */

export const ANALYTICS_REPORT_ENTITY = "SM_ANALYTICS_REPORT";
export const ANALYTICS_DELIVER_ACTION = "analytics_report.deliver";

const filterSchema = z.object({ reportId: z.string().uuid("Pick a saved report.") }).strict();

const ownedIds = async (companyId: string, userId: string, ids: string[]) =>
  new Set((await prisma.smAnalyticsReport.findMany({ where: { companyId, ownerUserId: userId, isArchived: false, id: { in: ids } }, select: { id: true } })).map((r) => r.id));

const entity: BulkEntityDefinition = {
  entityType: ANALYTICS_REPORT_ENTITY,
  label: "Saved report",
  pluralLabel: "Saved reports",
  viewPermission: { module: "sales_analytics", action: "view" },
  adminPermission: { module: "sales_marketing_settings", action: "edit" },
  parseFilterQuery: (query) => filterSchema.parse(Object.fromEntries(new URLSearchParams(query))),
  resolveFilterIds: async (actor, filter) => {
    const ids = [...(await ownedIds(actor.companyId, actor.userId, [(filter as { reportId: string }).reportId]))];
    return { ids, total: ids.length };
  },
  visibleIds: (actor, ids) => ownedIds(actor.companyId, actor.userId, ids),
  recordLabels: async (companyId, ids) => new Map((await prisma.smAnalyticsReport.findMany({ where: { companyId, id: { in: ids } }, select: { id: true, name: true } })).map((r) => [r.id, r.name])),
  recordHref: (id) => `/sales-marketing/analytics/reports/${id}`,
  listHref: "/sales-marketing/analytics?tab=saved",
};

const deliverSchema = z.object({}).strict();

const deliver: BulkActionDefinition<z.infer<typeof deliverSchema>> = {
  key: ANALYTICS_DELIVER_ACTION,
  entityType: ANALYTICS_REPORT_ENTITY,
  kind: "communication",
  label: "Deliver report",
  description: "Prepare the saved report for each of its recipients — each copy with that recipient's own access — and notify them to download it (valid 7 days). Recipients without access are skipped.",
  permissions: [
    { module: "sales_analytics", action: "view" },
    { module: "sales_analytics", action: "edit" },
  ],
  paramsSchema: deliverSchema,
  confirmation: "none",
  retrySafe: true,
  cancellable: true,
  maxItems: 1,
  schedulable: true,
  dryRunUnavailableReason: "Delivery has no dry run — use Send now on the report to test it.",
  prepare: async (_actor, params) => ({ params, summary: "Deliver to the report's recipients" }),
  executeItem: async (ctx) => {
    const s = await deliverSavedReport(ctx.actor, ctx.item.entityId, ctx.idempotencyKey);
    const message = `${s.delivered} delivered, ${s.skipped} skipped, ${s.failed} failed${s.alreadyDone ? `, ${s.alreadyDone} already sent` : ""}.`;
    if (s.failed && !s.delivered) throw new Error(message);
    return { status: "SUCCEEDED", message, result: { ...s } };
  },
};

let registered = false;
export function registerAnalyticsBulkActions() {
  if (registered) return;
  registered = true;
  registerEntity(entity);
  registerAction(deliver);
}
