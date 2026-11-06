import { Prisma } from "@prisma/client";
import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { PermissionService } from "@/core/rbac/PermissionService";
import type { SalesActor } from "@/modules/sales-marketing/enquiries/sales-enquiry.service";
import {
  ANALYTICS_LIMITS,
  ANALYTICS_TIMEZONE,
  DATASETS,
  METRIC_BY_ID,
  REPORTING_CURRENCY_NOTE,
  TIME_GRAINS,
  changePercent,
  comparePeriod,
  ratio,
  reportQuerySchema,
  type DatasetDef,
  type MetricDef,
  type ReportQuery,
  type TimeGrain,
} from "./analytics-registry";
import { SQL_DATASETS, type SqlDatasetImpl } from "./analytics-datasets";
import { datasetFreshness, type Freshness } from "./analytics-freshness";
import { resolveLabels } from "./analytics-labels";
import { SERVICE_DATASETS } from "./analytics-service-datasets";

/**
 * Phase 17 — the governed query engine. A request names a dataset, governed
 * metrics, up to two dimensions, filters and a bounded period; the engine
 * validates all of it against the registry, checks every permission (the
 * dataset's module, each metric's extra modules, sales_analytics.view), runs
 * one parameterized aggregate per period (current, comparison, totals) with a
 * statement timeout, and returns labelled rows with the metric versions,
 * freshness and reconciliation. Ratios are always recomputed from their
 * summed parts (never averaged); totals come from an ungrouped query, never
 * from adding rows.
 */

export interface ResultColumn {
  key: string;
  label: string;
  kind: "dimension" | "metric";
  unit?: MetricDef["unit"];
  metricId?: string;
  version?: number;
}
export interface ResultRow {
  keys: Record<string, string | null>;
  labels: Record<string, string>;
  values: Record<string, number | null>;
  compare?: Record<string, number | null>;
  change?: Record<string, number | null>;
}
export interface ReportResult {
  dataset: { key: string; label: string; grain: string };
  query: ReportQuery;
  columns: ResultColumn[];
  rows: ResultRow[];
  totals: { values: Record<string, number | null>; compare?: Record<string, number | null>; change?: Record<string, number | null> };
  unavailableMetrics: { id: string; reason: string }[];
  truncated: boolean;
  meta: {
    timezone: string;
    currency: string;
    period: { from: string; to: string };
    comparePeriod: { from: string; to: string } | null;
    metrics: { id: string; version: number; label: string; formula: string }[];
    freshness: Freshness[];
    reconciliation: Reconciliation | null;
    durationMs: number;
    generatedAt: string;
    latestSourceChangeAt: string | null;
  };
}
export interface Reconciliation {
  metricId: string;
  reportTotal: number;
  sourceTotal: number;
  matches: boolean;
  source: string;
}

const DAY = 86_400_000;
const days = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY) + 1;
const num = (v: unknown) => (v === null || v === undefined ? 0 : typeof v === "bigint" ? Number(v) : Number(v));
const dimCol = (key: string) => `d_${key.toLowerCase()}`;
const NONE = "__none__";

export interface ValidatedQuery {
  q: ReportQuery;
  dataset: DatasetDef;
  metrics: MetricDef[];
  timeField: string;
}

/** Validates a query against the registry (no permission checks). Clear messages for retired or unknown items. */
export function validateQuery(raw: unknown): ValidatedQuery {
  const q = reportQuerySchema.parse(raw);
  const dataset = DATASETS[q.dataset];
  if (!dataset) throw new BusinessRuleError("VALIDATION_ERROR", `Unknown dataset "${q.dataset}".`, { fieldErrors: { dataset: "Unknown." } });
  const metrics: MetricDef[] = [];
  for (const id of [...new Set(q.metrics)]) {
    const m = METRIC_BY_ID.get(id);
    if (!m) throw new BusinessRuleError("VALIDATION_ERROR", `Unknown metric "${id}".`, { fieldErrors: { metrics: `Unknown: ${id}` } });
    if (m.retired) throw new BusinessRuleError("VALIDATION_ERROR", `The metric "${m.label}" (v${m.version}) has been retired. Edit the report and choose its replacement.`, { fieldErrors: { metrics: `Retired: ${id}` } });
    if (m.dataset !== dataset.key) throw new BusinessRuleError("VALIDATION_ERROR", `"${m.label}" belongs to ${DATASETS[m.dataset]?.label ?? m.dataset}, not ${dataset.label} — metrics of different grains can't be mixed in one report.`, { fieldErrors: { metrics: "Different dataset." } });
    metrics.push(m);
  }
  const dimKeys = new Set(dataset.dimensions.map((d) => d.key));
  for (const g of q.groupBy) if (!dimKeys.has(g)) throw new BusinessRuleError("VALIDATION_ERROR", `"${g}" isn't a dimension of ${dataset.label}.`, { fieldErrors: { groupBy: `Unknown: ${g}` } });
  if (new Set(q.groupBy).size !== q.groupBy.length) throw new BusinessRuleError("VALIDATION_ERROR", "A dimension can be used once.");
  for (const f of Object.keys(q.filters)) if (!dimKeys.has(f) || f === "period") throw new BusinessRuleError("VALIDATION_ERROR", `"${f}" can't be filtered on ${dataset.label}.`, { fieldErrors: { filters: `Unknown: ${f}` } });
  const timeField = q.timeField ?? dataset.defaultTimeField;
  if (!dataset.timeFields[timeField]) throw new BusinessRuleError("VALIDATION_ERROR", `"${timeField}" isn't a time field of ${dataset.label}.`);
  if (q.to < q.from) throw new BusinessRuleError("VALIDATION_ERROR", "The end date is before the start date.");
  if (days(q.from, q.to) > ANALYTICS_LIMITS.maxRangeDays) throw new BusinessRuleError("VALIDATION_ERROR", `A report covers at most ${ANALYTICS_LIMITS.maxRangeDays} days.`);
  if (q.sort && !q.metrics.includes(q.sort.by) && !q.groupBy.includes(q.sort.by)) throw new BusinessRuleError("VALIDATION_ERROR", "Sort by a chosen metric or dimension.");
  if (dataset.engine === "service" && q.groupBy.some((g) => g === "period")) throw new BusinessRuleError("VALIDATION_ERROR", `${dataset.label} can't be grouped by period.`);
  return { q, dataset, metrics, timeField };
}

/** Which of the metrics this viewer may see (dataset permission is checked by the dataset itself). */
export async function metricAccess(userId: string, metrics: MetricDef[]) {
  const ok: MetricDef[] = [];
  const no: { id: string; reason: string }[] = [];
  for (const m of metrics) {
    let allowed = true;
    for (const p of m.permissions ?? []) if (!(await PermissionService.can(userId, p.module as never, p.action as never))) allowed = false;
    if (allowed) ok.push(m);
    else no.push({ id: m.id, reason: `Needs ${(m.permissions ?? []).map((p) => `${p.module}.${p.action}`).join(" and ")}.` });
  }
  return { ok, no };
}

/**
 * Period start of t.tf. Fiscal grains use the company's fiscal-year start
 * month (Company.fiscalYearStartMonth, also used by Phase 05 targets): shift
 * back by the offset, truncate, shift forward.
 */
export function grainSql(g: TimeGrain, fiscalStartMonth = 4) {
  if (g === "day") return Prisma.raw("t.tf");
  if (g === "fiscal_year" || g === "fiscal_quarter") {
    const k = g === "fiscal_year" ? (fiscalStartMonth - 1) % 12 : (fiscalStartMonth - 1) % 3;
    const unit = g === "fiscal_year" ? "year" : "quarter";
    return Prisma.raw(`(date_trunc('${unit}', t.tf - interval '${k} months') + interval '${k} months')::date`);
  }
  return Prisma.raw(`date_trunc('${g}', t.tf)::date`);
}

async function fiscalStart(companyId: string) {
  const c = await prisma.company.findUnique({ where: { id: companyId }, select: { fiscalYearStartMonth: true } });
  return c?.fiscalYearStartMonth ?? 4;
}

async function aggregateSql(impl: SqlDatasetImpl, actor: SalesActor, v: ValidatedQuery, metrics: MetricDef[], period: { from: string; to: string }, grouped: boolean, fsm = 4) {
  const base = await impl.base({ actor, from: period.from, to: period.to, timeField: v.timeField });
  if (!base) return null;
  const parts = [...new Set(metrics.flatMap((m) => [impl.parts[m.id].num, impl.parts[m.id].den].filter((x): x is string => Boolean(x))))];
  const groups = grouped ? v.q.groupBy : [];
  const keySql = groups.map((g, i) => (g === "period" ? Prisma.sql`${grainSql(v.q.timeGrain, fsm)}::text AS ${Prisma.raw(`g${i}`)}` : Prisma.sql`COALESCE(t.${Prisma.raw(dimCol(g))}, ${NONE}) AS ${Prisma.raw(`g${i}`)}`));
  const aggSql = parts.map((p) => Prisma.sql`COALESCE(SUM(t.${Prisma.raw(`p_${p}`)}), 0) AS ${Prisma.raw(`s_${p}`)}`);
  const filters = Object.entries(v.q.filters)
    .filter(([, vals]) => vals.length)
    .map(([k, vals]) => {
      const real = vals.filter((x) => x !== NONE);
      const col = Prisma.raw(`t.${dimCol(k)}`);
      const inReal = real.length ? Prisma.sql`${col} IN (${Prisma.join(real)})` : Prisma.sql`FALSE`;
      return vals.includes(NONE) ? Prisma.sql`AND (${inReal} OR ${col} IS NULL)` : Prisma.sql`AND ${inReal}`;
    });
  const select = Prisma.join([...keySql, ...aggSql, Prisma.sql`MAX(t.upd) AS latest`], ", ");
  const groupBy = groups.length ? Prisma.sql`GROUP BY ${Prisma.join(groups.map((_, i) => Prisma.raw(`g${i}`)))}` : Prisma.empty;
  return Prisma.sql`SELECT ${select} FROM (${base}) t WHERE TRUE ${filters.length ? Prisma.join(filters, " ") : Prisma.empty} ${groupBy}`;
}

/** One bounded query with a statement timeout (runs in its own short transaction). */
async function runBounded<T>(sql: Prisma.Sql): Promise<T[]> {
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = ${ANALYTICS_LIMITS.statementTimeoutMs}`);
      return tx.$queryRaw<T[]>(sql);
    });
  } catch (e) {
    const msg = (e as Error).message ?? "";
    if (/statement timeout|canceling statement/i.test(msg)) throw new BusinessRuleError("VALIDATION_ERROR", "This report took too long. Narrow the period, remove a dimension or add filters.");
    throw e;
  }
}

function metricValues(metrics: MetricDef[], impl: SqlDatasetImpl, row: Record<string, unknown>) {
  const out: Record<string, number | null> = {};
  for (const m of metrics) {
    const p = impl.parts[m.id];
    const n = num(row[`s_${p.num}`]);
    if (p.den) out[m.id] = ratio(n, num(row[`s_${p.den}`]), m.unit);
    else out[m.id] = Math.round(n * 100) / 100;
  }
  return out;
}

const keyOf = (keys: Record<string, string | null>) => JSON.stringify(keys);

/** Runs a validated query. Throws PERMISSION_DENIED if the dataset is hidden from the viewer. */
export async function runReport(actor: SalesActor, raw: unknown): Promise<ReportResult> {
  await PermissionService.assert(actor.userId, "sales_analytics", "view");
  const started = Date.now();
  const v = validateQuery(raw);
  const { ok: metrics, no: unavailable } = await metricAccess(actor.userId, v.metrics);
  const cmp = v.q.compare === "none" ? null : comparePeriod(v.q.from, v.q.to, v.q.compare);
  let rows: ResultRow[] = [];
  let totals: ReportResult["totals"] = { values: {} };
  let truncated = false;
  let latest: Date | null = null;
  let reconciliation: Reconciliation | null = null;

  if (v.dataset.engine === "service") {
    const svc = SERVICE_DATASETS[v.dataset.key];
    const r = await svc.run(actor, v, metrics, { from: v.q.from, to: v.q.to }, cmp);
    rows = r.rows;
    totals = r.totals;
    truncated = r.truncated;
  } else {
    const impl = SQL_DATASETS[v.dataset.key];
    if (!metrics.length) throw new BusinessRuleError("PERMISSION_DENIED", "You can't see any of the chosen metrics.");
    const fsm = await fiscalStart(actor.companyId);
    const cur = await aggregateSql(impl, actor, v, metrics, v.q, true, fsm);
    if (!cur) throw new BusinessRuleError("PERMISSION_DENIED", `You can't see ${v.dataset.label}.`);
    const order = v.q.groupBy.includes("period") ? Prisma.sql`ORDER BY ${Prisma.raw(`g${v.q.groupBy.indexOf("period")}`)}` : Prisma.empty;
    const limited = v.q.groupBy.length ? Prisma.sql`${cur} ${order} LIMIT ${ANALYTICS_LIMITS.maxRows + 1}` : cur;
    const totSql = (await aggregateSql(impl, actor, v, metrics, v.q, false, fsm))!;
    const [curRows, totRows] = await Promise.all([runBounded<Record<string, unknown>>(limited), runBounded<Record<string, unknown>>(totSql)]);
    truncated = curRows.length > ANALYTICS_LIMITS.maxRows;
    const groupKeys = (r: Record<string, unknown>) => Object.fromEntries(v.q.groupBy.map((g, i) => [g, (r[`g${i}`] as string) === NONE ? null : ((r[`g${i}`] as string) ?? null)]));
    rows = curRows.slice(0, ANALYTICS_LIMITS.maxRows).map((r) => ({ keys: groupKeys(r), labels: {}, values: metricValues(metrics, impl, r) }));
    totals = { values: totRows[0] ? metricValues(metrics, impl, totRows[0]) : {} };
    latest = (totRows[0]?.latest as Date | null) ?? null;
    if (cmp) {
      const shifted = { ...v.q, from: cmp.from, to: cmp.to };
      const [cRows, cTot] = await Promise.all([
        runBounded<Record<string, unknown>>((await aggregateSql(impl, actor, { ...v, q: shifted }, metrics, cmp, true, fsm))!),
        runBounded<Record<string, unknown>>((await aggregateSql(impl, actor, { ...v, q: shifted }, metrics, cmp, false, fsm))!),
      ]);
      // Period keys can't match across periods: with a period dimension only the totals are compared.
      if (!v.q.groupBy.includes("period")) {
        const byKey = new Map(cRows.map((r) => [keyOf(groupKeys(r)), metricValues(metrics, impl, r)]));
        for (const row of rows) {
          row.compare = byKey.get(keyOf(row.keys)) ?? Object.fromEntries(metrics.map((m) => [m.id, m.aggregation === "ratio" || m.aggregation === "avg" ? null : 0]));
          row.change = Object.fromEntries(metrics.map((m) => [m.id, changePercent(row.values[m.id], row.compare![m.id])]));
        }
      }
      totals.compare = cTot[0] ? metricValues(metrics, impl, cTot[0]) : {};
      totals.change = Object.fromEntries(metrics.map((m) => [m.id, changePercent(totals.values[m.id] ?? null, totals.compare![m.id] ?? null)]));
    }
    if (!Object.keys(v.q.filters).length) reconciliation = await reconcile(actor, v.dataset.key, totals.values, v.q);
  }

  // Sort (period groups stay chronological unless another sort is asked for).
  if (v.q.sort) {
    const { by, dir } = v.q.sort;
    const val = (r: ResultRow) => (by in r.values ? (r.values[by] ?? -Infinity) : (r.keys[by] ?? ""));
    rows.sort((a, b) => {
      const x = val(a);
      const y = val(b);
      const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
      return dir === "asc" ? c : -c;
    });
  } else if (!v.q.groupBy.includes("period") && metrics[0]) {
    rows.sort((a, b) => (b.values[metrics[0].id] ?? -Infinity) - (a.values[metrics[0].id] ?? -Infinity));
  }
  if (rows.length > v.q.limit) {
    rows = rows.slice(0, v.q.limit);
    truncated = true;
  }
  await resolveLabels(actor.companyId, v.dataset, rows, v.q.timeGrain, await fiscalStart(actor.companyId));

  const columns: ResultColumn[] = [
    ...v.q.groupBy.map((g) => ({ key: g, label: g === "period" ? `${TIME_GRAINS[v.q.timeGrain]} (${v.dataset.timeFields[v.timeField].label})` : (v.dataset.dimensions.find((d) => d.key === g)?.label ?? g), kind: "dimension" as const })),
    ...metrics.map((m) => ({ key: m.id, label: m.label, kind: "metric" as const, unit: m.unit, metricId: m.id, version: m.version })),
  ];
  const freshness = await datasetFreshness(actor, v.dataset, { from: v.q.from, to: v.q.to }, latest);
  return {
    dataset: { key: v.dataset.key, label: v.dataset.label, grain: v.dataset.grain },
    query: v.q,
    columns,
    rows,
    totals,
    unavailableMetrics: unavailable,
    truncated,
    meta: {
      timezone: ANALYTICS_TIMEZONE,
      currency: REPORTING_CURRENCY_NOTE,
      period: { from: v.q.from, to: v.q.to },
      comparePeriod: cmp,
      metrics: metrics.map((m) => ({ id: m.id, version: m.version, label: m.label, formula: m.formula })),
      freshness,
      reconciliation,
      durationMs: Date.now() - started,
      generatedAt: new Date().toISOString(),
      latestSourceChangeAt: latest ? new Date(latest).toISOString() : null,
    },
  };
}

/**
 * Independent check of a money total against the authoritative table through
 * Prisma (not the analytics SQL): booked order value and invoiced value, for
 * unfiltered reports. A mismatch is shown, never hidden.
 */
async function reconcile(actor: SalesActor, dataset: string, totals: Record<string, number | null>, q: ReportQuery): Promise<Reconciliation | null> {
  const branch = await PermissionService.getAllowedBranchIds(actor.userId);
  const branchWhere = branch === null ? {} : { branchId: { in: [...branch] } };
  const range = { gte: new Date(`${q.from}T00:00:00Z`), lte: new Date(`${q.to}T00:00:00Z`) };
  if (dataset === "orders" && totals.booked_order_value !== undefined) {
    const { bookedOrderWhere } = await import("@/modules/sales-marketing/performance/performance-actuals");
    const a = await prisma.salesOrder.aggregate({ where: { companyId: actor.companyId, orderDate: range, ...branchWhere, ...bookedOrderWhere }, _sum: { baseTotalAmount: true } });
    const src = Math.round(Number(a._sum.baseTotalAmount ?? 0) * 100) / 100;
    return { metricId: "booked_order_value", reportTotal: totals.booked_order_value ?? 0, sourceTotal: src, matches: Math.abs(src - (totals.booked_order_value ?? 0)) < 0.01, source: "sales_orders (Phase 05 booked rule), summed directly" };
  }
  if (dataset === "invoices" && totals.invoiced_value_incl_tax !== undefined) {
    const a = await prisma.salesInvoice.aggregate({ where: { companyId: actor.companyId, invoiceDate: range, status: { in: ["POSTED", "PARTIALLY_PAID", "PAID", "CLOSED"] }, ...branchWhere }, _sum: { baseTotalAmount: true } });
    const src = Math.round(Number(a._sum.baseTotalAmount ?? 0) * 100) / 100;
    return { metricId: "invoiced_value_incl_tax", reportTotal: totals.invoiced_value_incl_tax ?? 0, sourceTotal: src, matches: Math.abs(src - (totals.invoiced_value_incl_tax ?? 0)) < 0.01, source: "sales_invoices base totals, summed directly" };
  }
  return null;
}

// ── Drill-down ───────────────────────────────────────────────────

export interface DrillResult {
  label: string;
  rows: { id: string; ref: string; date: string | null; href: string | null; value: number | null; flags?: Record<string, boolean> }[];
  truncated: boolean;
  note: string | null;
  linkOnly?: { href: string; label: string };
}

/**
 * The source records behind one result row. The dataset's own visibility rule
 * applies again (same base query, as the viewer); links open the record in its
 * module, which checks its own permission again.
 */
export async function drillDown(actor: SalesActor, raw: unknown, keys: Record<string, string | null>): Promise<DrillResult> {
  await PermissionService.assert(actor.userId, "sales_analytics", "view");
  const v = validateQuery(raw);
  const def = v.dataset;
  if (def.engine === "service") {
    const id = keys.campaign ?? keys.target ?? null;
    return { label: def.drillDown?.label ?? def.label, rows: [], truncated: false, note: "Open the record for its own breakdown.", linkOnly: id && def.drillDown ? { href: `${def.drillDown.hrefPrefix}${id}`, label: `Open ${def.drillDown.label.toLowerCase()}` } : undefined };
  }
  const impl = SQL_DATASETS[def.key];
  const base = await impl.base({ actor, from: v.q.from, to: v.q.to, timeField: v.timeField });
  if (!base) throw new BusinessRuleError("PERMISSION_DENIED", `You can't see ${def.label}.`);
  const conds: Prisma.Sql[] = [];
  for (const [k, val] of Object.entries({ ...Object.fromEntries(Object.entries(v.q.filters).map(([k2, vals]) => [k2, vals])), ...keys })) {
    if (k === "period") {
      if (typeof val !== "string") continue;
      conds.push(Prisma.sql`AND ${grainSql(v.q.timeGrain, await fiscalStart(actor.companyId))} = ${val}::date`);
      continue;
    }
    if (!def.dimensions.some((d) => d.key === k)) continue;
    const col = Prisma.raw(`t.${dimCol(k)}`);
    if (Array.isArray(val)) {
      const real = val.filter((x) => x !== NONE);
      conds.push(val.includes(NONE) ? Prisma.sql`AND (${real.length ? Prisma.sql`${col} IN (${Prisma.join(real)})` : Prisma.sql`FALSE`} OR ${col} IS NULL)` : Prisma.sql`AND ${real.length ? Prisma.sql`${col} IN (${Prisma.join(real)})` : Prisma.sql`FALSE`}`);
    } else conds.push(val === null ? Prisma.sql`AND ${col} IS NULL` : Prisma.sql`AND ${col} = ${val}`);
  }
  const valueCol = impl.drill?.valuePart ? Prisma.raw(`t.p_${impl.drill.valuePart}`) : Prisma.sql`NULL`;
  const funnel = def.key === "funnel";
  const flagCols = funnel ? Prisma.sql`, t.p_qualified, t.p_quoted, t.p_accepted, t.p_ordered, t.p_invoiced, t.p_paid` : Prisma.empty;
  const rows = await runBounded<Record<string, unknown>>(Prisma.sql`
    SELECT t.id::text AS id, t.ref, t.tf::text AS date, ${valueCol} AS value ${flagCols}
    FROM (${base}) t WHERE TRUE ${conds.length ? Prisma.join(conds, " ") : Prisma.empty}
    ORDER BY t.tf DESC, t.ref LIMIT ${ANALYTICS_LIMITS.maxDrillRows + 1}`);
  // Funnel stages the viewer can't see are not shown per record either.
  const { ok } = await metricAccess(actor.userId, v.metrics.length ? (await import("./analytics-registry")).metricsOf("funnel") : []);
  const visibleStages = new Set(ok.map((m) => m.id.replace("funnel_", "")));
  return {
    label: def.drillDown?.label ?? def.label,
    truncated: rows.length > ANALYTICS_LIMITS.maxDrillRows,
    note: funnel ? "Stages are shown only for modules you can open." : null,
    rows: rows.slice(0, ANALYTICS_LIMITS.maxDrillRows).map((r) => ({
      id: String(r.id),
      ref: String(r.ref ?? ""),
      date: (r.date as string) ?? null,
      href: def.drillDown ? `${def.drillDown.hrefPrefix}${r.id}` : null,
      value: r.value === null || r.value === undefined ? null : Math.round(Number(r.value) * 100) / 100,
      ...(funnel ? { flags: Object.fromEntries(["qualified", "quoted", "accepted", "ordered", "invoiced", "paid"].filter((s) => visibleStages.has(s)).map((s) => [s, Number(r[`p_${s}`]) === 1])) } : {}),
    })),
  };
}
