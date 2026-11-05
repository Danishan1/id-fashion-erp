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

const { SalesMarketingDashboardClient } = await import("./SalesMarketingDashboardClient");
const { SALES_MARKETING_SECTIONS } = await import("@/modules/sales-marketing/sales-marketing-sections");

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ok = (data: unknown) => Promise.resolve(new Response(JSON.stringify({ data }), { status: 200 }));
const metrics = {
  periodDays: 90,
  periodFrom: "2026-08-05",
  today: "2026-11-02",
  enquiries: { open: 7, overdueFollowUps: 2, awaitingQualification: 3, receivedInPeriod: 10, quotedInPeriod: 4, quotationRate: 40 },
  quotations: {
    byStatus: [
      { key: "DRAFT", label: "Draft", count: 2, value: 1000 },
      { key: "EXPIRED", label: "Expired (issued)", count: 1, value: 2500.5 },
    ],
    decisions: { accepted: 3, rejected: 1, winRate: 75 },
    conversion: { accepted: 3, converted: 2, rate: 66.67 },
    topCustomers: [{ customerId: "c1", name: "Zenith", accepted: 2, value: 12345.6 }],
  },
  orders: { count: 2, value: 9000 },
};
/** Overview for the dashboard URL, metrics for the KPI URL. */
const byUrl = (overview: unknown) => vi.fn((url: string) => (String(url).includes("/metrics") ? ok(metrics) : ok(overview)));

describe("SalesMarketingDashboardClient", () => {
  it("shows loading first, then real source figures, no fake KPIs, and the planned sections", async () => {
    vi.stubGlobal(
      "fetch",
      byUrl({
        sections: SALES_MARKETING_SECTIONS,
        connectedSources: [{ key: "customers", label: "Customers", description: "d", href: "/masters/customers", metrics: [{ label: "Active customers", value: 1234 }] }],
      })
    );
    render(<SalesMarketingDashboardClient />);
    expect(screen.getByRole("status").textContent).toContain("Loading");
    await waitFor(() => expect(screen.getByText("Active customers")).toBeTruthy());
    expect(screen.getByText("1,234")).toBeTruthy();
    // Real KPIs from the metrics API.
    await waitFor(() => expect(screen.getByText("Overdue follow-ups")).toBeTruthy());
    expect(screen.getByText("40%")).toBeTruthy();
    expect(screen.getByText("₹2,500.50")).toBeTruthy();
    expect(screen.getByText("75%")).toBeTruthy();
    expect(screen.getByText("66.7%")).toBeTruthy();
    expect(screen.getByText("Zenith")).toBeTruthy();
    expect(screen.queryByText("Not available yet")).toBeNull();
    expect(screen.getByText("Quotations & Proposals")).toBeTruthy();
    expect(screen.getAllByText(/Planned · Phase 12/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Planned · Phase (0[5-9]|1[01])/)).toBeNull();
    expect(screen.getByRole("link", { name: /Customers/ }).getAttribute("href")).toBe("/masters/customers");
  });

  it("explains an empty source list", async () => {
    vi.stubGlobal("fetch", byUrl({ sections: [], connectedSources: [] }));
    render(<SalesMarketingDashboardClient />);
    await waitFor(() => expect(screen.getByText("No related modules available")).toBeTruthy());
  });

  it("shows the API error and retries", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "PERMISSION_DENIED", message: "No access to this module." } }), { status: 403 }))
      .mockImplementation((url: string) => (String(url).includes("/metrics") ? ok(metrics) : ok({ sections: [], connectedSources: [] })));
    vi.stubGlobal("fetch", fetchMock);
    render(<SalesMarketingDashboardClient />);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("No access to this module."));
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getByText("No related modules available")).toBeTruthy());
    expect(fetchMock.mock.calls.filter(([u]) => String(u).includes("/overview")).length).toBe(2);
  });

  it("handles a network failure", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("offline"))));
    render(<SalesMarketingDashboardClient />);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Could not reach the server"));
  });

  it("switches the KPI period", async () => {
    const fetchMock = byUrl({ sections: [], connectedSources: [] });
    vi.stubGlobal("fetch", fetchMock);
    render(<SalesMarketingDashboardClient />);
    await waitFor(() => expect(screen.getByText("Win rate")).toBeTruthy());
    fireEvent.click(screen.getByRole("tab", { name: "12 months" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => String(u).includes("/metrics?days=365"))).toBe(true));
  });
});
