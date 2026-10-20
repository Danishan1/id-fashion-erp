import { describe, expect, it, vi } from "vitest";

vi.mock("@/core/db/client", () => ({ prisma: {} }));

const { parseDashboardQuery, resolveDashboardRange } = await import("./crm-dashboard.service");
const { DEFAULT_DASHBOARD_LAYOUT, dashboardLayoutSchema, dashboardFiltersSchema } = await import("./dashboard-registry");
const { CRM_PREFERENCES } = await import("../preferences/crm-preference-registry");

// 2026-10-13 21:00 UTC = 2026-10-14 02:30 in Asia/Kolkata: the business day has already changed.
const lateUtc = new Date("2026-10-13T21:00:00.000Z");

describe("dashboard date ranges (business days, Asia/Kolkata)", () => {
  it("presets are inclusive business-day ranges ending today in IST", () => {
    expect(resolveDashboardRange({ range: "today" }, lateUtc)).toMatchObject({ from: "2026-10-14", to: "2026-10-14", days: 1, label: "Today" });
    expect(resolveDashboardRange({ range: "7d" }, lateUtc)).toMatchObject({ from: "2026-10-08", to: "2026-10-14", days: 7 });
    expect(resolveDashboardRange({ range: "30d" }, lateUtc)).toMatchObject({ from: "2026-09-15", to: "2026-10-14", days: 30 });
    expect(resolveDashboardRange({ range: "month" }, lateUtc)).toMatchObject({ from: "2026-10-01", to: "2026-10-14", days: 14 });
    expect(resolveDashboardRange({ range: "month" }, new Date("2026-03-01T00:10:00+05:30"))).toMatchObject({ from: "2026-03-01", to: "2026-03-01", days: 1 });
  });

  it("custom ranges are validated (both dates, order, at most 366 days)", () => {
    expect(resolveDashboardRange({ range: "custom", from: "2026-02-01", to: "2026-03-01" }, lateUtc)).toMatchObject({ days: 29, label: "2026-02-01 – 2026-03-01" });
    expect(() => resolveDashboardRange({ range: "custom", from: "2026-02-01" }, lateUtc)).toThrow(/start and an end/);
    expect(() => resolveDashboardRange({ range: "custom", from: "2026-03-02", to: "2026-03-01" }, lateUtc)).toThrow(/on or before/);
    expect(() => resolveDashboardRange({ range: "custom", from: "2025-01-01", to: "2026-03-01" }, lateUtc)).toThrow(/at most 366/);
  });
});

describe("dashboard query", () => {
  it("parses filters and the visible widget list; rejects unknown widgets / owners / ranges", () => {
    expect(parseDashboardQuery(new URLSearchParams("range=7d&owner=me&widgets=kpis,pipeline"))).toEqual({ range: "7d", owner: "me", widgets: ["kpis", "pipeline"] });
    expect(parseDashboardQuery(new URLSearchParams(""))).toEqual({ range: "30d", owner: "all" });
    expect(() => parseDashboardQuery(new URLSearchParams("widgets=kpis,secrets"))).toThrow();
    expect(() => parseDashboardQuery(new URLSearchParams("widgets=quickActions"))).toThrow();
    expect(() => parseDashboardQuery(new URLSearchParams("owner=everyone-else"))).toThrow();
    expect(() => parseDashboardQuery(new URLSearchParams("range=year"))).toThrow();
    expect(() => parseDashboardQuery(new URLSearchParams("range=custom&from=13/10/2026&to=2026-10-14"))).toThrow();
  });
});

describe("dashboard preferences", () => {
  it("are registered with strict schemas", () => {
    expect(CRM_PREFERENCES["dashboard.layout"].safeParse(DEFAULT_DASHBOARD_LAYOUT).success).toBe(true);
    expect(dashboardLayoutSchema.safeParse({ widgets: [{ key: "kpis", visible: true, size: "full" }, { key: "kpis", visible: false, size: "half" }] }).success).toBe(false);
    expect(dashboardLayoutSchema.safeParse({ widgets: [{ key: "kpis", visible: true, size: "huge" }] }).success).toBe(false);
    expect(dashboardFiltersSchema.safeParse({ range: "7d", pipelineId: null, owner: "me" }).success).toBe(true);
    expect(dashboardFiltersSchema.safeParse({ range: "7d", sql: "x" }).success).toBe(false);
  });
});
