import { describe, expect, it } from "vitest";

const R = await import("./analytics-registry");
const { SQL_DATASETS } = await import("./analytics-datasets");
const { SERVICE_DATASETS, campaignValues } = await import("./analytics-service-datasets");
const { validateQuery, grainSql } = await import("./analytics-engine");
const { resolvePreset, indiaToday } = await import("./analytics-periods");
const { periodLabel } = await import("./analytics-labels");
const { attributionFreshness } = await import("./analytics-freshness");
const { headerBlock, tableRows, buildReportFile } = await import("./analytics-export");
const { DASHBOARDS } = await import("./analytics-dashboards");
const { canSeeReport, savedDefinitionSchema } = await import("./analytics-reports.service");

/** Phase 17 — pure units of the analytics layer (no database). */

const q = (o: Record<string, unknown> = {}) => ({ dataset: "orders", metrics: ["booked_order_value"], from: "2026-04-01", to: "2026-06-30", ...o });
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as { code?: string; name?: string }).code ?? (e as { name?: string }).name;
  }
  return "OK";
};

describe("registry consistency", () => {
  it("every metric belongs to one dataset, ids are unique, ratios name their parts, versions start at 1", () => {
    const ids = R.METRICS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const m of R.METRICS) {
      expect(R.DATASETS[m.dataset], m.id).toBeTruthy();
      expect(m.version).toBeGreaterThanOrEqual(1);
      expect(m.formula.length, m.id).toBeGreaterThan(3);
      if (m.aggregation === "ratio") expect(m.denominator, m.id).toBeTruthy();
    }
  });

  it("every SQL dataset implements each of its metrics and dimensions; service datasets have a runner", () => {
    for (const ds of Object.values(R.DATASETS)) {
      if (ds.engine === "service") {
        expect(SERVICE_DATASETS[ds.key], ds.key).toBeTruthy();
        continue;
      }
      const impl = SQL_DATASETS[ds.key];
      expect(impl, ds.key).toBeTruthy();
      for (const m of R.metricsOf(ds.key)) {
        expect(impl.parts[m.id], `${ds.key}.${m.id}`).toBeTruthy();
        expect(Boolean(impl.parts[m.id].den), `${m.id} ratio ↔ denominator`).toBe(m.aggregation === "ratio" || m.aggregation === "avg");
      }
      expect(ds.dimensions.map((d) => d.key).filter((k) => k !== "period").sort(), ds.key).toEqual([...impl.dimensions].sort());
    }
  });

  it("standard dashboards only use governed metrics and dimensions of the widget's dataset", () => {
    for (const d of DASHBOARDS)
      for (const w of d.widgets) expect(code(() => validateQuery({ ...w.query, from: "2026-04-01", to: "2026-06-30" })), `${d.key}/${w.id}`).toBe("OK");
  });
});

describe("query validation", () => {
  it("accepts a governed query; refuses unknown, mixed-grain, bad dimension, too long, inverted, unknown keys", () => {
    expect(code(() => validateQuery(q({ groupBy: ["period", "customer"] })))).toBe("OK");
    expect(code(() => validateQuery(q({ metrics: ["nope"] })))).toBe("VALIDATION_ERROR");
    expect(code(() => validateQuery(q({ metrics: ["booked_order_value", "invoiced_value"] })))).toBe("VALIDATION_ERROR");
    expect(code(() => validateQuery(q({ groupBy: ["stage"] })))).toBe("VALIDATION_ERROR");
    expect(code(() => validateQuery(q({ groupBy: ["customer", "customer"] })))).toBe("VALIDATION_ERROR");
    expect(code(() => validateQuery(q({ from: "2023-01-01", to: "2026-01-01" })))).toBe("VALIDATION_ERROR");
    expect(code(() => validateQuery(q({ from: "2026-06-30", to: "2026-04-01" })))).toBe("VALIDATION_ERROR");
    expect(code(() => validateQuery(q({ sql: "select 1" })))).toBe("ZodError");
    expect(code(() => validateQuery(q({ metrics: ["a", "b", "c", "d", "e", "f", "g"] })))).toBe("ZodError");
    expect(code(() => validateQuery(q({ groupBy: ["customer", "rep", "channel"] })))).toBe("ZodError");
    expect(code(() => validateQuery(q({ filters: { period: ["x"] } })))).toBe("VALIDATION_ERROR");
    expect(code(() => validateQuery({ ...q(), dataset: "campaigns", metrics: ["attributed_revenue"], groupBy: ["period"] }))).toBe("VALIDATION_ERROR");
  });

  it("a retired metric is refused with a clear message", () => {
    const m = R.METRICS[0] as { retired?: boolean };
    m.retired = true;
    try {
      expect(() => validateQuery(q({ dataset: R.METRICS[0].dataset, metrics: [R.METRICS[0].id] }))).toThrow(/retired/);
    } finally {
      m.retired = undefined;
    }
  });
});

describe("periods, grains and labels", () => {
  it("relative presets (India dates, financial year)", () => {
    expect(resolvePreset("last_month", "2026-01-15")).toEqual({ from: "2025-12-01", to: "2025-12-31" });
    expect(resolvePreset("last_month", "2026-03-31")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(resolvePreset("this_quarter", "2026-11-06")).toEqual({ from: "2026-10-01", to: "2026-11-06" });
    expect(resolvePreset("last_quarter", "2026-02-10")).toEqual({ from: "2025-10-01", to: "2025-12-31" });
    expect(resolvePreset("this_fiscal_year", "2026-02-10", 4)).toEqual({ from: "2025-04-01", to: "2026-02-10" });
    expect(resolvePreset("last_fiscal_year", "2026-11-06", 4)).toEqual({ from: "2025-04-01", to: "2026-03-31" });
    expect(resolvePreset("last_fiscal_year", "2026-11-06", 1)).toEqual({ from: "2025-01-01", to: "2025-12-31" });
    expect(resolvePreset("last_12_months", "2026-11-06")).toEqual({ from: "2025-11-01", to: "2026-10-31" });
    expect(resolvePreset("last_12_months", "2026-01-06")).toEqual({ from: "2025-01-01", to: "2025-12-31" });
    expect(resolvePreset("last_7_days", "2026-03-02")).toEqual({ from: "2026-02-24", to: "2026-03-02" });
    // 18:45 UTC is already the next day in India.
    expect(indiaToday(new Date("2026-11-06T18:45:00Z"))).toBe("2026-11-07");
  });

  it("comparison periods: same length before; same dates last year with 29 Feb", () => {
    expect(R.comparePeriod("2026-04-01", "2026-04-30", "previous_period")).toEqual({ from: "2026-03-02", to: "2026-03-31" });
    expect(R.comparePeriod("2024-02-01", "2024-02-29", "previous_year")).toEqual({ from: "2023-02-01", to: "2023-02-28" });
  });

  it("fiscal grains shift by the financial-year start", () => {
    expect(grainSql("fiscal_year", 4).sql).toContain("interval '3 months'");
    expect(grainSql("fiscal_quarter", 4).sql).toContain("interval '0 months'");
    expect(grainSql("fiscal_quarter", 2).sql).toContain("interval '1 months'");
    expect(grainSql("month").sql).toBe("date_trunc('month', t.tf)::date");
  });

  it("period labels", () => {
    expect(periodLabel("2026-04-01", "month")).toBe("Apr 2026");
    expect(periodLabel("2026-04-01", "quarter")).toBe("Q2 2026");
    expect(periodLabel("2026-04-01", "fiscal_year", 4)).toBe("FY 2026-27");
    expect(periodLabel("2027-01-01", "fiscal_quarter", 4)).toBe("Q4 FY 2026-27");
    expect(periodLabel("2026-07-01", "fiscal_quarter", 4)).toBe("Q2 FY 2026-27");
    expect(periodLabel("2026-01-01", "fiscal_year", 1)).toBe("FY 2026");
  });
});

describe("ratios and campaign maths", () => {
  it("an empty denominator is n/a (null), never 0; change % needs a non-zero base", () => {
    expect(R.ratio(5, 0, "percent")).toBeNull();
    expect(R.ratio(1, 3, "percent")).toBe(33.3);
    expect(R.ratio(10, 4, "ratio")).toBe(2.5);
    expect(R.changePercent(150, 100)).toBe(50);
    expect(R.changePercent(150, 0)).toBeNull();
    expect(R.changePercent(null, 100)).toBeNull();
  });

  it("ROI / ROAS / cost per order from summed parts", () => {
    const ms = R.metricsOf("campaigns");
    expect(campaignValues({ revenue: 3000, spend: 1000, budget: 2000, orders: 2.5, delivered: 40 }, ms)).toMatchObject({ campaign_roi: 200, campaign_roas: 3, cost_per_order: 400, budget_utilization: 50 });
    expect(campaignValues({ revenue: 3000, spend: 0, budget: 0, orders: 0, delivered: 0 }, ms)).toMatchObject({ campaign_roi: null, campaign_roas: null, cost_per_order: null, budget_utilization: null });
  });
});

describe("freshness", () => {
  const now = Date.parse("2026-11-06T12:00:00Z");
  const cur = { finishedAt: new Date(now - 3_600_000), periodFrom: "2026-01-01", periodTo: "2026-12-31" };
  const range = { from: "2026-10-01", to: "2026-10-31" };
  it("current, refreshing, failed, stale, incomplete, unknown", () => {
    expect(attributionFreshness({ running: false, latestFailed: false, current: cur, syncLagMs: 0 }, range, now).status).toBe("CURRENT");
    expect(attributionFreshness({ running: true, latestFailed: false, current: cur, syncLagMs: 0 }, range, now).status).toBe("REFRESHING");
    expect(attributionFreshness({ running: false, latestFailed: true, current: cur, syncLagMs: 0 }, range, now).status).toBe("FAILED");
    expect(attributionFreshness({ running: false, latestFailed: false, current: { ...cur, finishedAt: new Date(now - 40 * 3_600_000) }, syncLagMs: 0 }, range, now).status).toBe("STALE");
    expect(attributionFreshness({ running: false, latestFailed: false, current: cur, syncLagMs: 0 }, { from: "2025-12-01", to: "2026-01-31" }, now).status).toBe("INCOMPLETE");
    expect(attributionFreshness({ running: false, latestFailed: false, current: cur, syncLagMs: 48 * 3_600_000 }, range, now).status).toBe("INCOMPLETE");
    expect(attributionFreshness({ running: false, latestFailed: false, current: null, syncLagMs: null }, range, now).status).toBe("UNKNOWN");
  });
});

describe("export files", () => {
  const result = {
    dataset: { key: "orders", label: "Booked Sales Orders", grain: "Sales Order" },
    query: R.reportQuerySchema.parse(q({ groupBy: ["customer"], filters: { customer: ["c1"] }, compare: "previous_period" })),
    columns: [
      { key: "customer", label: "Customer", kind: "dimension" as const },
      { key: "booked_order_value", label: "Booked order value", kind: "metric" as const, unit: "currency" as const, metricId: "booked_order_value", version: 1 },
    ],
    rows: [{ keys: { customer: "c1" }, labels: { customer: "=HYPERLINK(\"http://evil\")" }, values: { booked_order_value: 1500 }, compare: { booked_order_value: 1000 }, change: { booked_order_value: 50 } }],
    totals: { values: { booked_order_value: 1500 }, compare: { booked_order_value: 1000 }, change: { booked_order_value: 50 } },
    unavailableMetrics: [{ id: "invoiced_value", reason: "Needs accounts.view." }],
    truncated: false,
    meta: {
      timezone: "Asia/Kolkata",
      currency: "Base currency",
      period: { from: "2026-04-01", to: "2026-06-30" },
      comparePeriod: { from: "2026-01-01", to: "2026-03-31" },
      metrics: [{ id: "booked_order_value", version: 1, label: "Booked order value", formula: "SUM(base total)" }],
      freshness: [{ source: "Sales Orders", status: "CURRENT" as const, label: "Current", asOf: null, detail: "Read live." }],
      reconciliation: null,
      durationMs: 5,
      generatedAt: "2026-11-06T10:00:00.000Z",
      latestSourceChangeAt: null,
    },
  };

  it("carries context: period, comparison, filters, currency, freshness, definitions, hidden metrics", () => {
    const head = headerBlock(result, "My report", "Asha").map((l) => l.join(" | ")).join("\n");
    for (const s of ["My report", "2026-04-01 to 2026-06-30", "2026-01-01 to 2026-03-31", "Customer: 1 selected", "Asia/Kolkata", "for Asha", "Definition: Booked order value (v1)", "Not included"]) expect(head).toContain(s);
    const t = tableRows(result);
    expect(t.header).toEqual(["Customer", "Booked order value", "Booked order value — previous", "Booked order value — change %"]);
    expect(t.rows.at(-1)).toEqual(["Total", 1500, 1000, 50]);
  });

  it("CSV is formula-safe and keeps numbers as numbers", async () => {
    const f = await buildReportFile(result, "My report", "CSV", "Asha");
    const text = f.buffer.toString("utf8");
    expect(text).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(text).toContain(",1500,1000,50");
    expect(f.fileName).toMatch(/^my-report-\d{12}\.csv$/);
    const x = await buildReportFile(result, "My report", "XLSX", "Asha");
    expect(x.buffer.subarray(0, 2).toString()).toBe("PK");
  });
});

describe("saved reports", () => {
  it("visibility: owner always; others only when shared and not deleted", () => {
    const r = { ownerUserId: "o", sharing: "PRIVATE", sharedUserIds: [] as string[], isArchived: false };
    expect(canSeeReport(r, "o")).toBe(true);
    expect(canSeeReport(r, "x")).toBe(false);
    expect(canSeeReport({ ...r, sharing: "USERS", sharedUserIds: ["x"] }, "x")).toBe(true);
    expect(canSeeReport({ ...r, sharing: "USERS", sharedUserIds: ["y"] }, "x")).toBe(false);
    expect(canSeeReport({ ...r, sharing: "COMPANY" }, "x")).toBe(true);
    expect(canSeeReport({ ...r, sharing: "COMPANY", isArchived: true }, "x")).toBe(false);
  });

  it("a definition is a governed query plus a period — nothing else", () => {
    expect(savedDefinitionSchema.safeParse({ query: q(), period: { mode: "relative", preset: "last_month" } }).success).toBe(true);
    expect(savedDefinitionSchema.safeParse({ query: q(), period: { mode: "relative", preset: "forever" } }).success).toBe(false);
    expect(savedDefinitionSchema.safeParse({ query: q(), sql: "select 1" }).success).toBe(false);
  });
});
