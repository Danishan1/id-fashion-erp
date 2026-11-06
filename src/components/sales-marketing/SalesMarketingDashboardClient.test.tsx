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

const { SalesMarketingDashboardClient, builderHref } = await import("./SalesMarketingDashboardClient");

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ok = (data: unknown) => Promise.resolve(new Response(JSON.stringify({ data }), { status: 200 }));

const result = (over: Record<string, unknown> = {}) => ({
  dataset: { key: "orders", label: "Booked Sales Orders", grain: "one row per Sales Order" },
  query: { dataset: "orders", metrics: ["booked_order_value"], groupBy: [], timeGrain: "day", from: "2026-11-01", to: "2026-11-06", filters: {}, compare: "none", limit: 100 },
  columns: [{ key: "booked_order_value", label: "Booked order value", kind: "metric", unit: "currency", metricId: "booked_order_value", version: 1 }],
  rows: [],
  totals: { values: { booked_order_value: 5000 } },
  unavailableMetrics: [],
  truncated: false,
  meta: { timezone: "Asia/Kolkata", currency: "x", period: { from: "2026-11-01", to: "2026-11-06" }, comparePeriod: null, metrics: [], freshness: [{ source: "Sales Orders", status: "CURRENT", label: "Current", asOf: null, detail: "Read live." }], reconciliation: null, durationMs: 3, generatedAt: "2026-11-06T10:00:00Z", latestSourceChangeAt: null },
  ...over,
});
const query = { dataset: "orders", metrics: ["booked_order_value"], from: "2026-11-01", to: "2026-11-06", compare: "previous_period", groupBy: ["period"], timeGrain: "day" };

const home = (over: Record<string, unknown> = {}) => ({
  preset: "this_month",
  presetLabel: "This month",
  period: { from: "2026-11-01", to: "2026-11-06" },
  generatedAt: "2026-11-06T10:00:00Z",
  kpis: [
    { key: "booked", metricId: "booked_order_value", label: "Booked order value", unit: "currency", higherIsBetter: true, description: "d", value: 125000, previous: 100000, change: 25, href: "/sales-orders", query },
    { key: "invoiced", metricId: "invoiced_value", label: "Invoiced value (before GST)", unit: "currency", higherIsBetter: true, description: "d", href: "/accounts/sales-invoices", query: { ...query, dataset: "invoices", metrics: ["invoiced_value"] }, hidden: "You can't see Sales invoices." },
    { key: "acceptance", metricId: "quotation_acceptance_rate", label: "Quotation acceptance rate", unit: "percent", higherIsBetter: true, description: "d", value: null, previous: 50, change: null, href: "/sales-marketing/quotations", query },
  ],
  trend: { status: "OK", result: result({ columns: [{ key: "period", label: "Day", kind: "dimension" }, ...result().columns], rows: [{ keys: { period: "2026-11-02" }, labels: { period: "2026-11-02" }, values: { booked_order_value: 5000 } }] }) },
  funnel: { status: "HIDDEN", message: "You can't see Enquiries." },
  team: {
    byRep: { status: "OK", result: result({ columns: [{ key: "rep", label: "Sales rep", kind: "dimension" }, ...result().columns], rows: [{ keys: { rep: "u1" }, labels: { rep: "Asha" }, values: { booked_order_value: 5000 } }] }) },
    byChannel: { status: "OK", result: result() },
    byCustomer: { status: "ERROR", message: "This report took too long." },
    targets: { status: "OK", result: result({ columns: [{ key: "target", label: "Target", kind: "dimension" }], rows: [{ keys: { target: "t1" }, labels: { target: "Asha · Booked value · Nov 2026" }, values: { target_attainment: 42.5 } }] }) },
  },
  queue: [
    { key: "overdue_followups", label: "Overdue enquiry follow-ups", count: 3, tone: "red", href: "/sales-marketing/enquiries", hint: "h" },
    { key: "quotes_to_approve", label: "Quotations waiting for approval", count: 0, tone: "amber", href: "/sales-marketing/quotations", hint: "h" },
  ],
  health: [
    { key: "attribution", label: "Attribution calculation", status: "WARN", detail: "Stale — Calculated more than 36 hours ago.", href: "/sales-marketing/attribution" },
    { key: "bulk", label: "Your bulk jobs (7 days)", status: "OK", detail: "No failed jobs.", href: "/sales-marketing/bulk-jobs" },
  ],
  canOpenAnalytics: true,
  ...over,
});

describe("SalesMarketingDashboardClient", () => {
  it("shows KPIs vs the previous period; hidden tiles say so (never zero); n/a for an empty ratio", async () => {
    vi.stubGlobal("fetch", vi.fn(() => ok(home())));
    render(<SalesMarketingDashboardClient />);
    expect(screen.getByRole("status").textContent).toContain("Loading");
    await waitFor(() => expect(screen.getByText("₹1,25,000")).toBeTruthy());
    expect(screen.getByText("was ₹1,00,000")).toBeTruthy();
    expect(screen.getByText(/25%/)).toBeTruthy();
    expect(screen.getByText("Not available to you.")).toBeTruthy();
    expect(screen.getByText("n/a")).toBeTruthy();
    expect(screen.queryByText(/Planned · Phase/)).toBeNull();
    // Report link carries the exact governed query; list link opens the source list.
    expect(screen.getAllByRole("link", { name: "Report" })[0].getAttribute("href")).toBe(builderHref(query));
    expect(screen.getAllByRole("link", { name: "Open list" })[0].getAttribute("href")).toBe("/sales-orders");
  });

  it("work queue, team & targets, system health; a failed widget doesn't blank the others", async () => {
    vi.stubGlobal("fetch", vi.fn(() => ok(home())));
    render(<SalesMarketingDashboardClient />);
    await waitFor(() => expect(screen.getByText("Overdue enquiry follow-ups")).toBeTruthy());
    expect(screen.getByRole("link", { name: /Overdue enquiry follow-ups/ }).getAttribute("href")).toBe("/sales-marketing/enquiries");
    expect(screen.queryByText("Quotations waiting for approval")).toBeNull();
    expect(screen.getByText("1 other check(s) are clear.")).toBeTruthy();
    expect(screen.getByText(/Not available to you\. You can't see Enquiries\./)).toBeTruthy();
    expect(screen.getByText("This report took too long.")).toBeTruthy();
    expect(screen.getByText("Asha")).toBeTruthy();
    expect(screen.getByText("Asha · Booked value · Nov 2026")).toBeTruthy();
    expect(screen.getByText("42.5%")).toBeTruthy();
    expect(screen.getByText(/Stale — Calculated more than 36 hours ago/)).toBeTruthy();
  });

  it("without Analytics access the KPI tiles link only to the lists; all clear when nothing is waiting", async () => {
    vi.stubGlobal("fetch", vi.fn(() => ok(home({ canOpenAnalytics: false, queue: [{ key: "x", label: "Quotations waiting for approval", count: 0, tone: "amber", href: "/q", hint: "h" }] }))));
    render(<SalesMarketingDashboardClient />);
    await waitFor(() => expect(screen.getByText(/All clear/)).toBeTruthy());
    expect(screen.queryByRole("link", { name: "Report" })).toBeNull();
  });

  it("changes the period and shows API errors with retry", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "PERMISSION_DENIED", message: "No access to this module." } }), { status: 403 }))
      .mockImplementation(() => ok(home()));
    vi.stubGlobal("fetch", fetchMock);
    render(<SalesMarketingDashboardClient />);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("No access to this module."));
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getByText("₹1,25,000")).toBeTruthy());
    fireEvent.change(screen.getByLabelText("Period"), { target: { value: "last_quarter" } });
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => String(u).includes("/home?preset=last_quarter"))).toBe(true));
  });
});
