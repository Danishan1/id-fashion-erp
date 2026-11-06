// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }));

const { SmAnalyticsClient } = await import("./SmAnalyticsClient");
const { AnalyticsChart } = await import("./AnalyticsChart");
const R = await import("@/modules/sales-marketing/analytics/analytics-registry");
const { DASHBOARDS } = await import("@/modules/sales-marketing/analytics/analytics-dashboards");
const { PERIOD_PRESETS } = await import("@/modules/sales-marketing/analytics/analytics-periods");

type Call = { url: string; init?: RequestInit };
function stub(routes: (c: Call) => unknown) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: routes({ url, init }) }) } as Response);
    })
  );
  return calls;
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const catalog = (noAccounts = false) => ({
  datasets: Object.values(R.DATASETS).map((d) => {
    const hidden = noAccounts && d.permission.module === "accounts";
    return { ...d, available: !hidden, unavailableReason: hidden ? "Needs accounts.view." : null, metrics: R.metricsOf(d.key).map((m) => ({ ...m, available: !hidden, unavailableReason: null })) };
  }),
  retiredMetrics: [],
  timeGrains: R.TIME_GRAINS,
  presets: PERIOD_PRESETS,
  limits: R.ANALYTICS_LIMITS,
  freshness: R.FRESHNESS,
  timezone: "Asia/Kolkata",
  currency: "Amounts in base currency.",
  dashboards: DASHBOARDS.map((d) => ({ key: d.key, label: d.label, description: d.description, defaultPreset: d.defaultPreset })),
  can: { create: true, edit: true, export: true, admin: false },
});

const result = (over: Record<string, unknown> = {}) => ({
  dataset: { key: "orders", label: "Booked Sales Orders", grain: "Sales Order" },
  query: { dataset: "orders", metrics: ["booked_order_value"], groupBy: [], timeGrain: "month", from: "2026-04-01", to: "2026-11-06", filters: {}, compare: "previous_period", limit: 100 },
  columns: [{ key: "booked_order_value", label: "Booked order value", kind: "metric", unit: "currency", metricId: "booked_order_value", version: 1 }],
  rows: [],
  totals: { values: { booked_order_value: 125000 }, compare: { booked_order_value: 100000 }, change: { booked_order_value: 25 } },
  unavailableMetrics: [],
  truncated: false,
  meta: { timezone: "Asia/Kolkata", currency: "x", period: { from: "2026-04-01", to: "2026-11-06" }, comparePeriod: { from: "2025-09-01", to: "2026-03-31" }, metrics: [], freshness: [{ source: "Sales Orders", status: "CURRENT", label: "Current", asOf: null, detail: "Read live." }], reconciliation: null, durationMs: 4, generatedAt: "2026-11-06T10:00:00Z", latestSourceChangeAt: null },
  ...over,
});

const dashboard = (hideInvoices: boolean) => {
  const d = DASHBOARDS[0];
  return {
    dashboard: { key: d.key, label: d.label, description: d.description },
    preset: "this_fiscal_year",
    presetLabel: "This financial year",
    period: { from: "2026-04-01", to: "2026-11-06" },
    widgets: d.widgets.map((w) => ({ ...w, outcome: hideInvoices && w.query.dataset === "invoices" ? { id: w.id, status: "HIDDEN", message: "You can't see Sales invoices." } : { id: w.id, status: "OK", result: result() } })),
  };
};

describe("Analytics page", () => {
  it("dashboard: KPI with comparison; a widget the viewer can't see says so instead of showing zero", async () => {
    stub(({ url }) => (url.endsWith("/catalog") ? catalog(true) : url.includes("/dashboards/") ? dashboard(true) : null));
    render(<SmAnalyticsClient />);
    await waitFor(() => expect(screen.getAllByText("₹1,25,000").length).toBeGreaterThan(0));
    expect(screen.getAllByText(/was ₹1,00,000/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Not available to you\. You can't see Sales invoices\./)).toBeTruthy();
    expect(screen.getByText(/Everything is shown with your own access/)).toBeTruthy();
  });

  it("builder: datasets without access are disabled; runs a governed query with a server-resolved period", async () => {
    const calls = stub(({ url }) => (url.endsWith("/catalog") ? catalog(true) : url.endsWith("/run") ? result({ meta: { ...result().meta, reconciliation: { metricId: "booked_order_value", reportTotal: 125000, sourceTotal: 125000, matches: true, source: "sales_orders, summed directly" } } }) : null));
    render(<SmAnalyticsClient initialTab="builder" />);
    await waitFor(() => expect(screen.getByLabelText("Data")).toBeTruthy());
    const opt = screen.getByRole("option", { name: /Sales invoices \(no access\)/ }) as HTMLOptionElement;
    expect(opt.disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Run report" }));
    await waitFor(() => expect(screen.getByText(/Total checked against/)).toBeTruthy());
    const body = JSON.parse(String(calls.find((c) => c.url.endsWith("/run"))!.init!.body));
    expect(body).toMatchObject({ dataset: "enquiries", preset: "this_fiscal_year", groupBy: ["period"] });
    expect(Object.keys(body)).not.toContain("sql");
  });

  it("glossary shows governed definitions with versions and limitations", async () => {
    stub(({ url }) => (url.endsWith("/catalog") ? catalog() : null));
    render(<SmAnalyticsClient initialTab="glossary" />);
    await waitFor(() => expect(screen.getByText("Revenue-based ROI")).toBeTruthy());
    fireEvent.change(screen.getByLabelText("Search metrics"), { target: { value: "roas" } });
    expect(screen.queryByText("Revenue-based ROI")).toBeNull();
    expect(screen.getByText("ROAS")).toBeTruthy();
    expect(screen.getByText(/campaign_roas · v1/)).toBeTruthy();
  });

  it("deliveries: download link only while valid; the owner's log shows skips but no files", async () => {
    stub(({ url }) =>
      url.endsWith("/catalog")
        ? catalog()
        : url.endsWith("/deliveries")
          ? {
              received: [
                { id: "d1", reportName: "Weekly bookings", status: "DELIVERED", reason: null, fileName: "w.xlsx", rowCount: 12, createdAt: "2026-11-06T08:00:00Z", expiresAt: "2026-11-13T08:00:00Z", downloadable: true, downloadedAt: null },
                { id: "d2", reportName: "Old one", status: "DELIVERED", reason: null, fileName: "o.xlsx", rowCount: 3, createdAt: "2026-10-01T08:00:00Z", expiresAt: "2026-10-08T08:00:00Z", downloadable: false, downloadedAt: null },
              ],
              sent: [{ id: "s1", reportName: "Weekly bookings", recipient: "Ravi", status: "SKIPPED", reason: "The recipient can't open Analytics.", createdAt: "2026-11-06T08:00:00Z" }],
            }
          : null
    );
    render(<SmAnalyticsClient initialTab="deliveries" />);
    await waitFor(() => expect(screen.getByText("Delivered to you")).toBeTruthy());
    expect(screen.getByRole("link", { name: /Download \(12 rows\)/ }).getAttribute("href")).toBe("/api/v1/sales-marketing/analytics/deliveries/d1/download");
    expect(screen.getByText("Expired")).toBeTruthy();
    expect(screen.getByText("The recipient can't open Analytics.")).toBeTruthy();
    expect(screen.getAllByRole("link").filter((a) => a.getAttribute("href")?.includes("/download"))).toHaveLength(1);
  });

  it("chart: only metrics sharing a unit share an axis; n/a never drawn as zero", () => {
    const r = result({
      query: { ...result().query, groupBy: ["period"] },
      columns: [
        { key: "period", label: "Month", kind: "dimension" },
        { key: "booked_order_value", label: "Booked order value", kind: "metric", unit: "currency", version: 1 },
        { key: "avg_order_value", label: "Average order value", kind: "metric", unit: "currency", version: 1 },
        { key: "booked_order_count", label: "Booked orders", kind: "metric", unit: "count", version: 1 },
      ],
      rows: [
        { keys: { period: "2026-04-01" }, labels: { period: "Apr 2026" }, values: { booked_order_value: 100, avg_order_value: null, booked_order_count: 1 } },
        { keys: { period: "2026-05-01" }, labels: { period: "May 2026" }, values: { booked_order_value: 300, avg_order_value: 150, booked_order_count: 2 } },
      ],
    });
    const { container } = render(<AnalyticsChart result={r as never} />);
    expect(container.querySelectorAll("polyline")).toHaveLength(2);
    expect(container.textContent).not.toContain("Booked orders");
    expect(container.querySelectorAll("circle")).toHaveLength(3);
  });
});
