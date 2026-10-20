import { Prisma, type CrmEntityType } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { PermissionService } from "@/core/rbac/PermissionService";
import { CrmActivityRepository } from "../activities/crm-activity.repository";
import { labelsFor, presentActivity, buildActivityWhere } from "../activities/crm-activities.service";
import { buildAppointmentWhere } from "../appointments/crm-appointments.service";
import type { CrmActor } from "../core/crm-actor";
import { addCalendarDays, businessDayEnd, businessDayStart, businessToday } from "../core/crm-dates";
import { crmEntityHref } from "../core/crm-entity-types";
import { CrmEventRepository } from "../core/crm-event.repository";
import { presentCrmEvent } from "../core/crm-events.service";
import { BUSINESS_TIME_ZONE } from "../core/crm-timezone";
import { getCrmRecordScope, type CrmRecordScope } from "../core/crm-visibility";
import { buildLeadWhere } from "../leads/lead-filters";
import { leadFilterSchema, leadFilterToParams, type LeadFilter } from "../leads/lead.schema";
import { buildOpportunityWhere } from "../opportunities/opportunity-filters";
import { opportunityFilterSchema, opportunityFilterToParams, type OpportunityFilter } from "../opportunities/opportunity.schema";
import { ensureDefaultPipeline, listPipelines } from "../pipelines/crm-pipelines.service";
import { listLeadSources, listLeadStatuses } from "../settings/crm-settings.service";
import { ACTIVE_EXECUTION_STATUSES } from "../workflows/workflow-registry";
import { DASHBOARD_MAX_RANGE_DAYS, DASHBOARD_RANGE_KEYS, DASHBOARD_RANGES, DATA_WIDGET_KEYS, type DashboardRangeKey, type DashboardWidgetKey } from "./dashboard-registry";

/**
 * Phase 21 — the CRM dashboard's single read API. One request returns every
 * requested widget; each widget is computed independently (in parallel) and
 * fails on its own, so one broken source shows an error card instead of an
 * empty dashboard.
 *
 * Rules every widget follows:
 *   - authoritative sources only: the same where-builders the lists use
 *     (buildLeadWhere / buildOpportunityWhere / buildActivityWhere /
 *     buildAppointmentWhere) so a number and its drill-down list always agree;
 *   - record visibility (crm.view = own, crm.view_all = everyone) is applied on
 *     the server, and the owner filter can only narrow it;
 *   - aggregation in the database (count / groupBy / one grouped SQL per chart),
 *     never "load all rows and count in the browser"; lists are capped (5–12 rows);
 *   - periods are business days in Asia/Kolkata (the CRM's zone);
 *   - CRM values are opportunity ESTIMATES in their own currencies, never mixed
 *     with ERP orders / invoices and never summed across currencies.
 */

const LIST_SIZE = 5;
const MAX_TREND_POINTS = 60;

// ── Query ────────────────────────────────────────────────────────

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
export const dashboardQuerySchema = z
  .object({
    range: z.enum(DASHBOARD_RANGE_KEYS).default("30d"),
    from: isoDate.optional(),
    to: isoDate.optional(),
    pipelineId: z.string().uuid().optional(),
    owner: z.union([z.enum(["all", "me"]), z.string().uuid()]).default("all"),
    widgets: z.array(z.enum(DATA_WIDGET_KEYS as [DashboardWidgetKey, ...DashboardWidgetKey[]])).optional(),
  })
  .strict();
export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;

export function parseDashboardQuery(sp: URLSearchParams): DashboardQuery {
  const get = (k: string) => sp.get(k)?.trim() || undefined;
  return dashboardQuerySchema.parse({
    range: get("range"),
    from: get("from"),
    to: get("to"),
    pipelineId: get("pipelineId"),
    owner: get("owner"),
    widgets: get("widgets")?.split(",").map((s) => s.trim()).filter(Boolean),
  });
}

/** Inclusive business-day range for a preset. */
export function resolveDashboardRange(q: Pick<DashboardQuery, "range" | "from" | "to">, now: Date = new Date()): { key: DashboardRangeKey; from: string; to: string; label: string; days: number } {
  const today = businessToday(now);
  let from: string;
  let to = today;
  switch (q.range) {
    case "today":
      from = today;
      break;
    case "7d":
      from = addCalendarDays(today, -6);
      break;
    case "30d":
      from = addCalendarDays(today, -29);
      break;
    case "month":
      from = `${today.slice(0, 8)}01`;
      break;
    case "custom":
      if (!q.from || !q.to) throw new BusinessRuleError("VALIDATION_ERROR", "Choose a start and an end date.", { fieldErrors: { from: "Required for a custom range." } });
      from = q.from;
      to = q.to;
      break;
  }
  const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
  if (days < 1) throw new BusinessRuleError("VALIDATION_ERROR", "The start date must be on or before the end date.", { fieldErrors: { from: "After the end date." } });
  if (days > DASHBOARD_MAX_RANGE_DAYS) throw new BusinessRuleError("VALIDATION_ERROR", `Choose at most ${DASHBOARD_MAX_RANGE_DAYS} days.`, { fieldErrors: { to: "Range too long." } });
  const label = q.range === "custom" ? `${from} – ${to}` : DASHBOARD_RANGES[q.range];
  return { key: q.range, from, to, label, days };
}

// ── Context ──────────────────────────────────────────────────────

interface Ctx {
  actor: CrmActor;
  scope: CrmRecordScope;
  now: Date;
  today: string;
  range: ReturnType<typeof resolveDashboardRange>;
  fromAt: Date;
  toAt: Date;
  /** undefined = everyone the viewer can see. */
  ownerIds: string[] | undefined;
  /** Whose "My work" to show. */
  workUserId: string;
  pipeline: { id: string; name: string; stages: { id: string; name: string; sortOrder: number; probability: number | null }[] } | null;
  perms: { viewAll: boolean; settingsView: boolean; settingsEdit: boolean };
}

async function buildContext(actor: CrmActor, q: DashboardQuery, now: Date): Promise<Ctx> {
  const [scope, settingsView, settingsEdit] = await Promise.all([getCrmRecordScope(actor), PermissionService.can(actor.userId, "crm_settings", "view"), PermissionService.can(actor.userId, "crm_settings", "edit")]);
  const range = resolveDashboardRange(q, now);
  let ownerIds: string[] | undefined;
  let workUserId = actor.userId;
  if (q.owner === "me") ownerIds = [actor.userId];
  else if (q.owner !== "all") {
    // Another person's numbers need view_all; their own id is always fine.
    if (q.owner !== actor.userId && scope.mode !== "ALL") throw new BusinessRuleError("PERMISSION_DENIED", "You can only see your own records.");
    const user = await prisma.user.findFirst({ where: { id: q.owner, companyId: actor.companyId }, select: { id: true } });
    if (!user) throw new BusinessRuleError("VALIDATION_ERROR", "Unknown owner.", { fieldErrors: { owner: "Choose a user of this company." } });
    ownerIds = [q.owner];
    workUserId = q.owner;
  }
  await ensureDefaultPipeline(actor.companyId);
  const pipelines = (await listPipelines(actor.companyId)).filter((p) => p.status === "ACTIVE");
  const chosen = (q.pipelineId && pipelines.find((p) => p.id === q.pipelineId)) || pipelines.find((p) => p.isDefault) || pipelines[0] || null;
  if (q.pipelineId && chosen?.id !== q.pipelineId) throw new BusinessRuleError("VALIDATION_ERROR", "Unknown or archived pipeline.", { fieldErrors: { pipelineId: "Choose an active pipeline." } });
  return {
    actor,
    scope,
    now,
    today: businessToday(now),
    range,
    fromAt: businessDayStart(range.from),
    toAt: businessDayEnd(range.to),
    ownerIds,
    workUserId,
    pipeline: chosen ? { id: chosen.id, name: chosen.name, stages: chosen.stages.filter((s) => s.status === "ACTIVE").map((s) => ({ id: s.id, name: s.name, sortOrder: s.sortOrder, probability: s.probability })) } : null,
    perms: { viewAll: scope.mode === "ALL", settingsView, settingsEdit },
  };
}

// ── Shared helpers ───────────────────────────────────────────────

type Money = { currencyCode: string | null; total: number };
const num = (v: Prisma.Decimal | number | null | undefined) => (v === null || v === undefined ? 0 : Number(v));
const moneyOf = (groups: { currencyCode: string | null; _sum: { amount: Prisma.Decimal | null } }[]): Money[] =>
  groups.filter((g) => g._sum.amount !== null).map((g) => ({ currencyCode: g.currencyCode, total: Math.round(num(g._sum.amount) * 100) / 100 })).sort((a, b) => b.total - a.total);

function leadFilter(ctx: Ctx, f: Partial<LeadFilter>): LeadFilter {
  return leadFilterSchema.parse({ ...(ctx.ownerIds ? { ownerUserIds: ctx.ownerIds } : {}), ...f });
}
function oppFilter(ctx: Ctx, f: Partial<OpportunityFilter>, { pipeline = true } = {}): OpportunityFilter {
  return opportunityFilterSchema.parse({ ...(ctx.ownerIds ? { ownerUserIds: ctx.ownerIds } : {}), ...(pipeline && ctx.pipeline ? { pipelineIds: [ctx.pipeline.id] } : {}), ...f });
}
const leadWhere = (ctx: Ctx, f: LeadFilter) => buildLeadWhere(ctx.actor.companyId, f, ctx.scope);
const oppWhere = (ctx: Ctx, f: OpportunityFilter) => buildOpportunityWhere(ctx.actor.companyId, f, ctx.scope, undefined, ctx.now);
const qs = (params: Record<string, string>) => new URLSearchParams(params).toString();
/** Drill-down link: the list page with exactly the filter used for the number. */
const leadHref = (f: LeadFilter) => `/crm/leads?${qs({ view: "list", ...leadFilterToParams(f) })}`;
const oppHref = (f: OpportunityFilter) => `/crm/opportunities?${qs({ view: "list", ...opportunityFilterToParams(f) })}`;

/** Activities of the person whose work is shown (assigned to them), within the viewer's visibility. */
function workWhere(ctx: Ctx, f: Record<string, unknown>) {
  return buildActivityWhere(ctx.actor, ctx.scope, { assignedToUserIds: [ctx.workUserId], ...f } as never, undefined, ctx.now);
}
function activitiesHref(ctx: Ctx, view: string) {
  return ctx.workUserId === ctx.actor.userId ? `/crm/activities?${qs({ view, assignee: ctx.actor.userId })}` : `/crm/activities?${qs({ view, assignee: ctx.workUserId })}`;
}

/** Raw-SQL visibility + owner filter for a table aliased `t` (same rule as crmOwnerWhere). */
function ownerSql(ctx: Ctx): Prisma.Sql {
  const vis = ctx.scope.mode === "ALL" ? Prisma.empty : Prisma.sql`AND (t."owner_user_id" = ${ctx.scope.userId}::uuid OR (t."owner_user_id" IS NULL AND t."created_by_user_id" = ${ctx.scope.userId}::uuid))`;
  const own = ctx.ownerIds ? Prisma.sql`AND t."owner_user_id" IN (${Prisma.join(ctx.ownerIds.map((id) => Prisma.sql`${id}::uuid`))})` : Prisma.empty;
  return Prisma.sql`${vis} ${own}`;
}

/** Day buckets for short ranges, Monday-weeks for long ones; every bucket present (zeros included). */
function buckets(ctx: Ctx): { unit: "day" | "week"; keys: string[] } {
  const unit = ctx.range.days <= 45 ? "day" : "week";
  const keys: string[] = [];
  if (unit === "day") {
    for (let d = ctx.range.from; d <= ctx.range.to; d = addCalendarDays(d, 1)) keys.push(d);
  } else {
    const dow = new Date(`${ctx.range.from}T00:00:00Z`).getUTCDay();
    let d = addCalendarDays(ctx.range.from, -((dow + 6) % 7));
    for (; d <= ctx.range.to && keys.length < MAX_TREND_POINTS; d = addCalendarDays(d, 7)) keys.push(d);
  }
  return { unit, keys };
}
/** SQL expression: the business-day (or week start) of a UTC timestamp column. */
function bucketSql(col: Prisma.Sql, unit: "day" | "week"): Prisma.Sql {
  return unit === "day"
    ? Prisma.sql`to_char(${col} + interval '5 hours 30 minutes', 'YYYY-MM-DD')`
    : Prisma.sql`to_char(date_trunc('week', ${col} + interval '5 hours 30 minutes'), 'YYYY-MM-DD')`;
}

// ── Widgets ──────────────────────────────────────────────────────

async function kpis(ctx: Ctx) {
  const active = leadFilter(ctx, { statusKinds: ["OPEN"] });
  const newLeads = leadFilter(ctx, { createdAt: { from: ctx.range.from, to: ctx.range.to }, archived: "include" });
  const followUpsPassed = leadFilter(ctx, { statusKinds: ["OPEN"], nextFollowUpAt: { to: addCalendarDays(ctx.today, -1) } });
  const open = oppFilter(ctx, { statuses: ["OPEN"] });
  const won = oppFilter(ctx, { statuses: ["WON"], closedAt: { from: ctx.range.from, to: ctx.range.to }, archived: "include" });
  const weekEnd = new Date(ctx.now.getTime() + 7 * 86_400_000);
  const apptWhere = await buildAppointmentWhere(ctx.actor, ctx.scope, { ...(ctx.ownerIds ? { assignedToUserIds: ctx.ownerIds } : {}), statuses: ["SCHEDULED", "CONFIRMED", "RESCHEDULED"], when: "upcoming", to: weekEnd.toISOString() } as never, undefined, ctx.now);
  const overdueWhere = buildActivityWhere(ctx.actor, ctx.scope, { due: "overdue", ...(ctx.ownerIds ? { assignedToUserIds: ctx.ownerIds } : {}) } as never, undefined, ctx.now);
  const [activeLeads, newLeadsCount, followUps, openCount, openValue, wonCount, wonValue, overdue, appts] = await Promise.all([
    prisma.crmLead.count({ where: leadWhere(ctx, active) }),
    prisma.crmLead.count({ where: leadWhere(ctx, newLeads) }),
    prisma.crmLead.count({ where: leadWhere(ctx, followUpsPassed) }),
    prisma.crmOpportunity.count({ where: oppWhere(ctx, open) }),
    prisma.crmOpportunity.groupBy({ by: ["currencyCode"], where: oppWhere(ctx, open), _sum: { amount: true } }),
    prisma.crmOpportunity.count({ where: oppWhere(ctx, won) }),
    prisma.crmOpportunity.groupBy({ by: ["currencyCode"], where: oppWhere(ctx, won), _sum: { amount: true } }),
    prisma.crmActivity.count({ where: overdueWhere }),
    prisma.crmActivity.count({ where: apptWhere }),
  ]);
  const overdueHref = ctx.ownerIds ? `/crm/activities?${qs({ view: "overdue", assignee: ctx.ownerIds[0] })}` : "/crm/activities?view=overdue";
  return {
    cards: [
      { key: "activeLeads", label: "Active leads", value: activeLeads, scope: "now", hint: "Open-status leads, not archived", href: leadHref(active) },
      { key: "newLeads", label: "New leads", value: newLeadsCount, scope: "period", hint: `Created ${ctx.range.label.toLowerCase()}`, href: leadHref(newLeads) },
      { key: "openOpportunities", label: "Open opportunities", value: openCount, scope: "now", hint: ctx.pipeline ? `In ${ctx.pipeline.name}` : "All pipelines", href: oppHref(open) },
      { key: "openPipelineValue", label: "Open pipeline value", value: null, money: moneyOf(openValue), scope: "now", hint: "Estimated value of open opportunities (not orders or invoices)", href: oppHref(open) },
      { key: "wonInPeriod", label: "Won", value: wonCount, money: moneyOf(wonValue), scope: "period", hint: `Closed as won ${ctx.range.label.toLowerCase()} (estimated value)`, href: oppHref(won) },
      { key: "overdueTasks", label: "Overdue tasks", value: overdue, scope: "now", hint: "Open activities past their due time", href: overdueHref, tone: overdue > 0 ? "warning" : undefined },
      { key: "followUpsPassed", label: "Follow-ups passed", value: followUps, scope: "now", hint: "Open leads whose follow-up date is before today", href: leadHref(followUpsPassed), tone: followUps > 0 ? "warning" : undefined },
      { key: "upcomingAppointments", label: "Appointments (7 days)", value: appts, scope: "next", hint: "Scheduled in the next 7 days", href: "/crm/calendar" },
    ],
  };
}

async function pipelineWidget(ctx: Ctx) {
  const pipelines = (await listPipelines(ctx.actor.companyId)).filter((p) => p.status === "ACTIVE").map((p) => ({ id: p.id, name: p.name, isDefault: p.isDefault }));
  if (!ctx.pipeline) return { pipelines, pipeline: null, stages: [], outcomes: null };
  const pipeline = ctx.pipeline;
  const open = oppFilter(ctx, { statuses: ["OPEN"] });
  const [byStage, closed] = await Promise.all([
    prisma.crmOpportunity.groupBy({ by: ["stageId", "currencyCode"], where: oppWhere(ctx, open), _count: { _all: true }, _sum: { amount: true } }),
    prisma.crmOpportunity.groupBy({ by: ["status"], where: oppWhere(ctx, oppFilter(ctx, { statuses: ["WON", "LOST", "ABANDONED"], closedAt: { from: ctx.range.from, to: ctx.range.to }, archived: "include" })), _count: { _all: true } }),
  ]);
  const stages = pipeline.stages.map((s) => {
    const rows = byStage.filter((g) => g.stageId === s.id);
    return {
      id: s.id,
      name: s.name,
      probability: s.probability,
      count: rows.reduce((n, g) => n + g._count._all, 0),
      values: moneyOf(rows),
      href: oppHref(oppFilter(ctx, { statuses: ["OPEN"], stageIds: [s.id] })),
    };
  });

  const { unit, keys } = buckets(ctx);
  const series = await prisma.$queryRaw<{ bucket: string; status: string; count: bigint }[]>`
    SELECT ${bucketSql(Prisma.sql`t."closed_at"`, unit)} AS bucket, t."status"::text AS status, COUNT(*) AS count
    FROM "crm_opportunities" t
    WHERE t."company_id" = ${ctx.actor.companyId}::uuid AND t."pipeline_id" = ${pipeline.id}::uuid
      AND t."status" IN ('WON', 'LOST') AND t."closed_at" >= ${ctx.fromAt} AND t."closed_at" <= ${ctx.toAt}
      ${ownerSql(ctx)}
    GROUP BY 1, 2`;
  const at = (k: string, s: string) => Number(series.find((r) => r.bucket === k && r.status === s)?.count ?? 0);
  const n = (s: string) => closed.find((g) => g.status === s)?._count._all ?? 0;
  const won = n("WON");
  const lost = n("LOST");
  const abandoned = n("ABANDONED");
  return {
    pipelines,
    pipeline: { id: pipeline.id, name: pipeline.name },
    stages,
    openHref: oppHref(open),
    outcomes: {
      unit,
      points: keys.map((k) => ({ bucket: k, won: at(k, "WON"), lost: at(k, "LOST") })),
      won,
      lost,
      abandoned,
      winRate: won + lost + abandoned ? Math.round((won / (won + lost + abandoned)) * 1000) / 10 : null,
      wonHref: oppHref(oppFilter(ctx, { statuses: ["WON"], closedAt: { from: ctx.range.from, to: ctx.range.to }, archived: "include" })),
      lostHref: oppHref(oppFilter(ctx, { statuses: ["LOST"], closedAt: { from: ctx.range.from, to: ctx.range.to }, archived: "include" })),
    },
  };
}

async function leadsWidget(ctx: Ctx) {
  const created = leadFilter(ctx, { createdAt: { from: ctx.range.from, to: ctx.range.to }, archived: "include" });
  const current = leadFilter(ctx, {});
  const { unit, keys } = buckets(ctx);
  const [trend, bySource, byStatus, sources, statuses] = await Promise.all([
    prisma.$queryRaw<{ bucket: string; count: bigint }[]>`
      SELECT ${bucketSql(Prisma.sql`t."created_at"`, unit)} AS bucket, COUNT(*) AS count
      FROM "crm_leads" t
      WHERE t."company_id" = ${ctx.actor.companyId}::uuid AND t."created_at" >= ${ctx.fromAt} AND t."created_at" <= ${ctx.toAt}
        ${ownerSql(ctx)}
      GROUP BY 1`,
    prisma.crmLead.groupBy({ by: ["sourceId"], where: leadWhere(ctx, created), _count: { _all: true } }),
    prisma.crmLead.groupBy({ by: ["statusId"], where: leadWhere(ctx, current), _count: { _all: true } }),
    listLeadSources(ctx.actor.companyId),
    listLeadStatuses(ctx.actor.companyId),
  ]);
  const total = (rows: { _count: { _all: number } }[]) => rows.reduce((s, r) => s + r._count._all, 0);
  return {
    unit,
    trend: keys.map((k) => ({ bucket: k, count: Number(trend.find((r) => r.bucket === k)?.count ?? 0) })),
    createdTotal: total(bySource),
    createdHref: leadHref(created),
    bySource: bySource
      .map((g) => ({
        id: g.sourceId,
        label: g.sourceId ? (sources.find((s) => s.id === g.sourceId)?.name ?? "Unknown source") : "No source",
        count: g._count._all,
        // "No source" has no list filter; it links to the period's leads.
        href: g.sourceId ? leadHref(leadFilter(ctx, { createdAt: { from: ctx.range.from, to: ctx.range.to }, archived: "include", sourceIds: [g.sourceId] })) : leadHref(created),
      }))
      .sort((a, b) => b.count - a.count),
    currentTotal: total(byStatus),
    byStatus: statuses
      .map((s) => ({ id: s.id, label: s.name, kind: s.kind, count: byStatus.find((g) => g.statusId === s.id)?._count._all ?? 0, href: leadHref(leadFilter(ctx, { statusIds: [s.id] })) }))
      .filter((s) => s.count > 0),
  };
}

async function attentionWidget(ctx: Ctx) {
  const never = leadFilter(ctx, { statusKinds: ["OPEN"], neverContacted: true });
  const passed = leadFilter(ctx, { statusKinds: ["OPEN"], nextFollowUpAt: { to: addCalendarDays(ctx.today, -1) } });
  const dueToday = leadFilter(ctx, { statusKinds: ["OPEN"], nextFollowUpAt: { from: ctx.today, to: ctx.today } });
  const recentF = leadFilter(ctx, {});
  const select = { id: true, leadNumber: true, fullName: true, companyName: true, createdAt: true, updatedAt: true, nextFollowUpAt: true, lastContactedAt: true, status: { select: { name: true } }, owner: { select: { id: true, fullName: true } } } as const;
  const [neverCount, neverRows, passedCount, passedRows, todayCount, recent] = await Promise.all([
    prisma.crmLead.count({ where: leadWhere(ctx, never) }),
    prisma.crmLead.findMany({ where: leadWhere(ctx, never), orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: LIST_SIZE, select }),
    prisma.crmLead.count({ where: leadWhere(ctx, passed) }),
    prisma.crmLead.findMany({ where: leadWhere(ctx, passed), orderBy: [{ nextFollowUpAt: "asc" }, { id: "asc" }], take: LIST_SIZE, select }),
    prisma.crmLead.count({ where: leadWhere(ctx, dueToday) }),
    prisma.crmLead.findMany({ where: leadWhere(ctx, recentF), orderBy: [{ updatedAt: "desc" }, { id: "asc" }], take: LIST_SIZE, select }),
  ]);
  const row = (l: (typeof recent)[number]) => ({ id: l.id, label: `${l.leadNumber} · ${l.fullName}`, sublabel: l.companyName, status: l.status.name, owner: l.owner?.fullName ?? null, createdAt: l.createdAt, updatedAt: l.updatedAt, nextFollowUpAt: l.nextFollowUpAt, href: `/crm/leads/${l.id}` });
  return {
    neverContacted: { count: neverCount, rows: neverRows.map(row), href: leadHref(never) },
    followUpPassed: { count: passedCount, rows: passedRows.map(row), href: leadHref(passed) },
    followUpToday: { count: todayCount, href: leadHref(dueToday) },
    recentlyUpdated: { rows: recent.map(row), href: `/crm/leads?${qs({ view: "list", sortBy: "updatedAt", sortOrder: "desc" })}` },
  };
}

async function myWorkWidget(ctx: Ctx) {
  const notAppt = { types: ["TASK", "CALL", "MEETING", "EMAIL", "SMS", "WHATSAPP", "OTHER"] };
  const in7 = addCalendarDays(ctx.today, 7);
  const order = [{ dueAt: { sort: "asc" as const, nulls: "last" as const } }, { id: "asc" as const }];
  const apptWhere = await buildAppointmentWhere(ctx.actor, ctx.scope, { assignedToUserIds: [ctx.workUserId], statuses: ["SCHEDULED", "CONFIRMED", "RESCHEDULED"], when: "upcoming", to: businessDayEnd(in7).toISOString() } as never, undefined, ctx.now);
  const overdueW = workWhere(ctx, { ...notAppt, due: "overdue" });
  const todayW = workWhere(ctx, { ...notAppt, due: "today" });
  const upcomingW = workWhere(ctx, { ...notAppt, state: "open", dueFrom: addCalendarDays(ctx.today, 1), dueTo: in7 });
  const doneW = workWhere(ctx, { statuses: ["COMPLETED"] });
  const [counts, overdue, today, upcoming, appts, done] = await Promise.all([
    Promise.all([prisma.crmActivity.count({ where: overdueW }), prisma.crmActivity.count({ where: todayW }), prisma.crmActivity.count({ where: upcomingW }), prisma.crmActivity.count({ where: apptWhere })]),
    CrmActivityRepository.findMany(overdueW, order, 0, LIST_SIZE),
    CrmActivityRepository.findMany(todayW, order, 0, LIST_SIZE),
    CrmActivityRepository.findMany(upcomingW, order, 0, LIST_SIZE),
    CrmActivityRepository.findMany(apptWhere, order, 0, LIST_SIZE),
    CrmActivityRepository.findMany(doneW, [{ completedAt: { sort: "desc", nulls: "last" } }, { id: "asc" }], 0, LIST_SIZE),
  ]);
  const all = [...overdue, ...today, ...upcoming, ...appts, ...done];
  // One batched label lookup for every list (no per-row queries).
  const labels = await labelsFor(ctx.actor.companyId, all);
  const users = new Map((await prisma.user.findMany({ where: { id: { in: [...new Set(all.map((a) => a.assignedToUserId).filter((x): x is string => Boolean(x)))] } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
  const item = (a: (typeof all)[number]) => {
    const p = presentActivity(a, labels, ctx.actor, ctx.scope, ctx.now);
    return { id: p.id, type: p.type, typeLabel: p.typeLabel, subject: p.subject, status: p.status, priority: p.priority, due: p.due, dueState: p.dueState, completedAt: p.completedAt, assignee: a.assignedToUserId ? (users.get(a.assignedToUserId) ?? null) : null, related: p.primary ? { label: p.primary.label, href: p.primary.href } : null };
  };
  const [overdueN, todayN, upcomingN, apptN] = counts;
  const workerName = ctx.workUserId === ctx.actor.userId ? null : ((await prisma.user.findUnique({ where: { id: ctx.workUserId }, select: { fullName: true } }))?.fullName ?? null);
  return {
    forUser: workerName,
    overdue: { count: overdueN, items: overdue.map(item), href: activitiesHref(ctx, "overdue") },
    today: { count: todayN, items: today.map(item), href: activitiesHref(ctx, "today") },
    upcoming: { count: upcomingN, items: upcoming.map(item), href: activitiesHref(ctx, "upcoming") },
    appointments: { count: apptN, items: appts.map(item), href: "/crm/calendar" },
    completed: { items: done.map(item), href: activitiesHref(ctx, "completed") },
  };
}

/** Event types shown in the dashboard feed (business milestones; edits, receipts and tag noise stay on record timelines). */
export const DASHBOARD_EVENT_TYPES = [
  "lead.created",
  "lead.converted",
  "lead.status_changed",
  "opportunity.created",
  "opportunity.stage_changed",
  "opportunity.won",
  "opportunity.lost",
  "activity.completed",
  "activity.call_logged",
  "activity.meeting_logged",
  "appointment.created",
  "appointment.cancelled",
  "appointment.completed",
  "appointment.no_show",
  "conversation.created",
  "message.received",
  "message.failed",
];

async function activityWidget(ctx: Ctx) {
  // Same visibility rule as the company activity feed (GET /crm/events): view_all
  // sees everyone's events, everyone else only their own actions.
  const actorUserId = ctx.scope.mode === "OWN" ? ctx.actor.userId : ctx.ownerIds?.[0];
  const where: Prisma.CrmEventWhereInput = {
    companyId: ctx.actor.companyId,
    eventType: { in: DASHBOARD_EVENT_TYPES },
    occurredAt: { gte: ctx.fromAt, lte: ctx.toAt },
    ...(actorUserId ? { actorUserId } : {}),
  };
  const rows = await CrmEventRepository.findMany(where, 0, 12, "desc");
  return {
    events: rows.map((r) => {
      const e = presentCrmEvent(r);
      return { id: e.id, eventType: e.eventType, label: e.label, category: e.category, summary: e.summary, entityType: e.entityType, entityLabel: e.entityLabel, href: e.entityHref, occurredAt: e.occurredAt, actor: e.actor?.fullName ?? null };
    }),
    href: `/crm/activity?${qs({ from: ctx.range.from, to: ctx.range.to })}`,
  };
}

async function automationWidget(ctx: Ctx) {
  const bulkWhere: Prisma.BulkJobWhereInput = { companyId: ctx.actor.companyId, ...(ctx.perms.settingsEdit ? {} : { requestedByUserId: ctx.actor.userId }) };
  const [bulkActive, bulkProblems] = await Promise.all([
    prisma.bulkJob.count({ where: { ...bulkWhere, status: { in: ["QUEUED", "VALIDATING", "RUNNING", "CANCEL_REQUESTED"] } } }),
    prisma.bulkJob.count({ where: { ...bulkWhere, status: { in: ["FAILED", "COMPLETED_WITH_ERRORS"] }, finishedAt: { gte: ctx.fromAt, lte: ctx.toAt } } }),
  ]);
  const bulk = { active: bulkActive, problems: bulkProblems, href: "/crm/bulk-jobs", problemsHref: "/crm/bulk-jobs?statuses=FAILED" };
  // Workflow runs and integration health are configuration data: CRM settings access only.
  if (!ctx.perms.settingsView) return { workflows: null, integrations: null, bulk };

  const live = { companyId: ctx.actor.companyId, mode: "LIVE" };
  const [byStatus, activeNow, failures, failedCaptures, flaggedCaptures, failedMessages, pausedChannels] = await Promise.all([
    prisma.crmWorkflowExecution.groupBy({ by: ["status"], where: { ...live, createdAt: { gte: ctx.fromAt, lte: ctx.toAt } }, _count: { _all: true } }),
    prisma.crmWorkflowExecution.count({ where: { ...live, status: { in: ACTIVE_EXECUTION_STATUSES } } }),
    prisma.crmWorkflowExecution.findMany({
      where: { ...live, status: "FAILED", finishedAt: { gte: ctx.fromAt, lte: ctx.toAt } },
      orderBy: [{ finishedAt: "desc" }, { id: "desc" }],
      take: LIST_SIZE,
      select: { id: true, finishedAt: true, errorCode: true, errorMessage: true, entityType: true, entityId: true, workflow: { select: { id: true, name: true } } },
    }),
    prisma.crmIngestEvent.count({ where: { companyId: ctx.actor.companyId, status: "FAILED", receivedAt: { gte: ctx.fromAt, lte: ctx.toAt } } }),
    prisma.crmIngestEvent.count({ where: { companyId: ctx.actor.companyId, status: "FLAGGED", receivedAt: { gte: ctx.fromAt, lte: ctx.toAt } } }),
    prisma.crmMessage.count({ where: { companyId: ctx.actor.companyId, direction: "OUTBOUND", status: "FAILED", occurredAt: { gte: ctx.fromAt, lte: ctx.toAt } } }),
    prisma.crmChannel.count({ where: { companyId: ctx.actor.companyId, status: "PAUSED" } }),
  ]);
  const n = (s: string) => byStatus.find((g) => g.status === s)?._count._all ?? 0;
  return {
    bulk,
    workflows: {
      completed: n("COMPLETED") + n("EXITED"),
      failed: n("FAILED"),
      cancelled: n("CANCELLED"),
      activeNow,
      started: byStatus.reduce((s, g) => s + g._count._all, 0),
      recentFailures: failures.map((f) => ({
        id: f.id,
        workflow: f.workflow.name,
        finishedAt: f.finishedAt,
        errorCode: f.errorCode,
        // Short, user-facing reason only (never payloads or stack traces).
        message: (f.errorMessage ?? "Failed").split("\n")[0].slice(0, 160),
        record: f.entityType && f.entityId ? { entityType: f.entityType, href: crmEntityHref(f.entityType as CrmEntityType, f.entityId) } : null,
        href: `/crm/workflows/executions/${f.id}`,
      })),
      href: "/crm/workflows/executions",
      failedHref: "/crm/workflows/executions?statuses=FAILED",
    },
    integrations: {
      failedLeadCaptures: failedCaptures,
      flaggedLeadCaptures: flaggedCaptures,
      capturesHref: "/crm/leads/imports",
      failedMessages,
      messagesHref: "/crm/inbox",
      pausedChannels,
      channelsHref: "/crm/settings",
    },
  };
}

const WIDGETS: Record<Exclude<DashboardWidgetKey, "quickActions">, (ctx: Ctx) => Promise<unknown>> = {
  kpis,
  pipeline: pipelineWidget,
  leads: leadsWidget,
  attention: attentionWidget,
  myWork: myWorkWidget,
  activity: activityWidget,
  automation: automationWidget,
};

export type DashboardWidgetResult = { status: "ok"; data: unknown } | { status: "error"; message: string };

/**
 * The dashboard for the signed-in user. Filters that are invalid or not allowed
 * (another owner without view_all, an archived pipeline) fail the whole request
 * with a clear message; a widget whose query fails returns its own error.
 */
export async function getCrmDashboard(actor: CrmActor, query: DashboardQuery, now: Date = new Date()) {
  const ctx = await buildContext(actor, query, now);
  const keys = (query.widgets?.length ? query.widgets : DATA_WIDGET_KEYS) as Exclude<DashboardWidgetKey, "quickActions">[];
  const results = await Promise.all(
    keys.map(async (k): Promise<[string, DashboardWidgetResult]> => {
      try {
        return [k, { status: "ok", data: await WIDGETS[k](ctx) }];
      } catch (e) {
        console.error(JSON.stringify({ level: "error", message: "CRM dashboard widget failed", widget: k, error: (e as Error)?.message }));
        return [k, { status: "error", message: e instanceof BusinessRuleError ? e.message : "This section couldn't be loaded. Try refreshing." }];
      }
    })
  );
  return {
    generatedAt: now.toISOString(),
    timeZone: BUSINESS_TIME_ZONE,
    filters: {
      range: ctx.range,
      owner: query.owner,
      pipelineId: ctx.pipeline?.id ?? null,
      pipelineName: ctx.pipeline?.name ?? null,
    },
    viewer: { viewAll: ctx.perms.viewAll, settingsView: ctx.perms.settingsView },
    widgets: Object.fromEntries(results) as Record<string, DashboardWidgetResult>,
  };
}
