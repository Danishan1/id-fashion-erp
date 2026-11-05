// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }));

const { ForecastClient } = await import("./ForecastClient");
const { ScenarioComparison } = await import("./ScenarioComparison");

const row = (extra: Record<string, unknown> = {}) => ({
  key: "u1",
  name: "Asha",
  actual: 1000,
  pipeline: { state: "CURRENT", weightedPipeline: 4150, unweightedPipeline: 7500, items: 5, forecast: 5150, overdueItems: 1, overdueWeighted: 400 },
  trend: { available: false, reason: "Not enough history", value: null, basis: [] },
  comparison: { target: 10000, gap: -4850, percent: 51.5, stillNeeded: 9000, coverage: 0.46 },
  targetId: "t1",
  ...extra,
});
const view = {
  period: { type: "MONTH", start: "2026-11-01", end: "2026-11-30", label: "Nov 2026" },
  progress: { state: "CURRENT", totalDays: 30, elapsedDays: 3, remainingDays: 27 },
  settings: { probabilityApproved: 30, probabilityIssued: 50, probabilityAccepted: 90, trendLookback: 3, staleDays: 60 },
  viewAll: false,
  company: null,
  me: row(),
  reps: [row()],
  teams: [],
  territories: [],
  items: [
    { source: "QUOTATION", id: "q1", number: "QUO-1", label: "Tees", customer: "Zenith", status: "ISSUED", value: 1000, adjustedProbability: 50, probabilitySource: "QUOTATION_DEFAULT", adjustedDate: "2026-11-03", weighted: 500, overdue: false, stale: false, inPeriod: true, rep: "Asha", territory: null, href: "/sales-marketing/quotations/q1" },
    { source: "OPPORTUNITY", id: "o5", number: "OPP-5", label: "Late", customer: "X", status: "OPEN", value: 1000, adjustedProbability: 40, probabilitySource: "OPPORTUNITY", adjustedDate: "2026-10-31", weighted: 400, overdue: true, stale: true, inPeriod: false, rep: "Asha", territory: null, href: null },
  ],
  excluded: [{ source: "OPPORTUNITY", id: "o3", number: "OPP-3", label: "No date", value: 500, reason: "NO_DATE", reasonLabel: "No expected close date", rep: "Asha" }],
  warnings: [{ key: "overdue", severity: "warning", message: "1 open item has an expected date in the past." }],
  chart: [
    { start: "2026-10-01", label: "Oct 2026", actual: 800, target: 900, forecast: null, snapshotForecast: 1000, current: false },
    { start: "2026-11-01", label: "Nov 2026", actual: 1000, target: 10000, forecast: 5150, snapshotForecast: null, current: true },
  ],
  calculatedAt: "2026-11-03T10:00:00.000Z",
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Forecast page", () => {
  it("keeps actual, pipeline, forecast and target apart, shows warnings, the items counted and the ones left out", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: view }), { status: 200 })));
    render(<ForecastClient fiscalStartMonth={4} today="2026-11-03" initial={{ periodType: "MONTH", periodStart: "2026-11-01" }} canSnapshot />);
    await waitFor(() => expect(screen.getByText(/You · Nov 2026/)).toBeTruthy());
    const overview = screen.getByRole("region", { name: "Forecast overview" });
    expect(within(overview).getByText("Booked so far (actual)")).toBeTruthy();
    expect(within(overview).getAllByText("₹5,150.00").length).toBeGreaterThan(0);
    expect(within(overview).getByText("Forecast = 51.5% of target")).toBeTruthy();
    expect(within(overview).getByText(/A forecast is an estimate, not an order or revenue/)).toBeTruthy();
    expect(screen.getByText("1 open item has an expected date in the past.")).toBeTruthy();
    // Counted in the period: only the in-period quotation.
    const pipeline = screen.getByRole("region", { name: "Pipeline" });
    expect(within(pipeline).getByRole("link", { name: "QUO-1" })).toBeTruthy();
    expect(within(pipeline).queryByText("OPP-5")).toBeNull();
    fireEvent.change(within(pipeline).getByLabelText("Show"), { target: { value: "all" } });
    expect(within(pipeline).getByText("OPP-5")).toBeTruthy();
    expect(within(pipeline).getByText("Overdue")).toBeTruthy();
    fireEvent.change(within(pipeline).getByLabelText("Show"), { target: { value: "excluded" } });
    expect(within(pipeline).getByText("No expected close date")).toBeTruthy();
    // Chart has a table view.
    fireEvent.click(screen.getByRole("button", { name: "Show table" }));
    expect(screen.getByText("Nov 2026 (selected)")).toBeTruthy();
  });

  it("saves a snapshot", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) =>
      init?.method === "POST" ? new Response(JSON.stringify({ data: { id: "s1" } }), { status: 201 }) : new Response(JSON.stringify({ data: view }), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<ForecastClient fiscalStartMonth={4} today="2026-11-03" initial={{ periodType: "MONTH", periodStart: "2026-11-01" }} canSnapshot />);
    fireEvent.click(await screen.findByRole("button", { name: "Save snapshot" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Note/), { target: { value: "start of month" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save snapshot" }));
    await waitFor(() => expect(screen.getByRole("link", { name: "Open snapshot" }).getAttribute("href")).toBe("/sales-marketing/forecast/snapshots/s1"));
    expect(JSON.parse(String(fetchMock.mock.calls.find((c) => c[1]?.method === "POST")![1]!.body))).toEqual({ periodType: "MONTH", periodStart: "2026-11-01", note: "start of month" });
  });
});

describe("Scenario comparison", () => {
  it("marks the result hypothetical and shows the difference", () => {
    const c = (key: string, name: string) => ({ key, name, baseline: { forecast: 5150, weightedPipeline: 4150, trend: null }, scenario: { forecast: 3075, weightedPipeline: 2075, trend: null }, difference: -2075, differencePercent: -40.3, target: 10000 });
    render(<ScenarioComparison c={{ period: { label: "Nov 2026" }, calculatedAt: "x", company: null, me: c("u1", "Asha"), reps: [c("u1", "Asha")], teams: [], territories: [] }} />);
    expect(screen.getByText("Hypothetical")).toBeTruthy();
    expect(screen.getByText("-40.3%")).toBeTruthy();
    expect(screen.getByText(/nothing in CRM, quotations, orders or targets is changed/)).toBeTruthy();
  });
});
