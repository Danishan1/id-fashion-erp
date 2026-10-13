// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => "/crm", useSearchParams: () => new URLSearchParams() }));

const { CrmDashboardClient, CustomizePanel } = await import("./CrmDashboardClient");
const { ColumnChart } = await import("./DashboardCharts");
const { QuickActions } = await import("./QuickActions");
const { DEFAULT_DASHBOARD_LAYOUT, resolveDashboardLayout } = await import("@/modules/crm/dashboard/dashboard-registry");

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const allPerms = { create: true, edit: true, viewAll: true, settings: true, settingsEdit: true };

function dashboard(over: Record<string, unknown> = {}) {
  return {
    generatedAt: "2026-10-13T10:00:00.000Z",
    timeZone: "Asia/Kolkata",
    filters: { range: { key: "30d", from: "2026-09-14", to: "2026-10-13", label: "Last 30 days", days: 30 }, owner: "all", pipelineId: "p1", pipelineName: "Sales" },
    viewer: { viewAll: true, settingsView: true },
    widgets: {
      kpis: {
        status: "ok",
        data: {
          cards: [
            { key: "activeLeads", label: "Active leads", value: 42, scope: "now", hint: "Open-status leads, not archived", href: "/crm/leads?view=list&statusKinds=OPEN" },
            { key: "openPipelineValue", label: "Open pipeline value", value: null, money: [{ currencyCode: "INR", total: 1500 }, { currencyCode: "USD", total: 20 }], scope: "now", hint: "Estimated value", href: "/crm/opportunities?view=list&statuses=OPEN" },
            { key: "overdueTasks", label: "Overdue tasks", value: 3, scope: "now", hint: "Past due", href: "/crm/activities?view=overdue", tone: "warning" },
          ],
        },
      },
      pipeline: { status: "error", message: "This section couldn't be loaded. Try refreshing." },
      ...over,
    },
  };
}

function mockFetch(handler: (url: string, init?: RequestInit) => unknown) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const body = handler(url, init);
      return new Response(JSON.stringify(body ?? { data: {} }), { status: 200, headers: { "Content-Type": "application/json" } });
    })
  );
  return calls;
}

describe("CRM dashboard", () => {
  it("shows KPIs with their period labels and drill-down links, and isolates a failed widget", async () => {
    mockFetch((url) => (url.startsWith("/api/v1/crm/dashboard") ? { data: dashboard() } : { data: url.startsWith("/api/v1/users") ? [] : {} }));
    render(<CrmDashboardClient permissions={allPerms} currentUserId="u1" userName="Asha Rao" />);
    const active = await screen.findByRole("link", { name: /Active leads/ });
    expect(active.getAttribute("href")).toBe("/crm/leads?view=list&statusKinds=OPEN");
    expect(within(active).getByText("42")).toBeTruthy();
    expect(within(active).getByText("Now")).toBeTruthy();
    // Money stays per currency (never summed across currencies).
    expect(screen.getByText("INR 1,500.00")).toBeTruthy();
    expect(screen.getByText("USD 20.00")).toBeTruthy();
    expect(within(screen.getByRole("link", { name: /Overdue tasks/ })).getByLabelText("needs attention")).toBeTruthy();
    // The failed pipeline widget shows its own error with a retry; the rest still renders.
    const alert = screen.getAllByRole("alert").find((a) => a.textContent?.includes("couldn't be loaded"))!;
    expect(within(alert).getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(screen.getByText(/Good (morning|afternoon|evening), Asha/)).toBeTruthy();
  });

  it("applies filters to one request for every visible widget and never shows an older answer over a newer one", async () => {
    let release: (() => void) | null = null;
    const calls = mockFetch((url) => {
      if (!url.startsWith("/api/v1/crm/dashboard")) return { data: url.startsWith("/api/v1/users") ? [{ id: "u2", fullName: "Ravi" }] : {} };
      return { data: dashboard() };
    });
    // Make the FIRST dashboard request slow and return stale numbers.
    const realFetch = globalThis.fetch as unknown as (url: string, init?: RequestInit) => Promise<Response>;
    let first = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.startsWith("/api/v1/crm/dashboard") && first) {
          first = false;
          await new Promise<void>((r) => (release = r));
          calls.push({ url, init });
          const stale = dashboard({ kpis: { status: "ok", data: { cards: [{ key: "activeLeads", label: "Active leads", value: 999, scope: "now", hint: "", href: "/x" }] } } });
          return new Response(JSON.stringify({ data: stale }), { status: 200 });
        }
        return realFetch(url, init);
      })
    );
    render(<CrmDashboardClient permissions={allPerms} currentUserId="u1" userName={null} />);
    const period = await screen.findByLabelText(/Period/);
    // The first (default-range) request is in flight before the user changes the period.
    await waitFor(() => expect(release).not.toBeNull());
    fireEvent.change(period, { target: { value: "7d" } });
    await screen.findByText("42");
    await act(async () => release?.());
    expect(screen.queryByText("999")).toBeNull();
    const dashCalls = calls.filter((c) => c.url.startsWith("/api/v1/crm/dashboard"));
    const latest = new URL(dashCalls.find((c) => c.url.includes("range=7d"))!.url, "http://x");
    expect(latest.searchParams.get("widgets")!.split(",")).toEqual(["kpis", "pipeline", "myWork", "leads", "attention", "activity", "automation"]);
    // The preset is remembered as the user's default.
    await waitFor(() => expect(calls.some((c) => c.url === "/api/v1/crm/preferences/dashboard.filters" && c.init?.method === "PUT")).toBe(true), { timeout: 2000 });
    // Owner choices for a view_all user include other people.
    expect(within(screen.getByLabelText(/Owner/)).getByRole("option", { name: "Ravi" })).toBeTruthy();
  });

  it("custom range: invalid order is flagged and not requested", async () => {
    const calls = mockFetch((url) => (url.startsWith("/api/v1/crm/dashboard") ? { data: dashboard() } : { data: {} }));
    render(<CrmDashboardClient permissions={{ ...allPerms, viewAll: false }} currentUserId="u1" userName={null} />);
    fireEvent.change(await screen.findByLabelText(/Period/), { target: { value: "custom" } });
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-10-20" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-10-01" } });
    expect(await screen.findByText(/start date on or before the end date/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Refresh" }) as HTMLButtonElement).disabled).toBe(true);
    // Without view_all there is no list of other owners.
    expect(within(screen.getByLabelText(/Owner/)).getAllByRole("option").map((o) => o.textContent)).toEqual(["All my records", "Owned by me"]);
    await new Promise((r) => setTimeout(r, 500));
    expect(calls.some((c) => c.url.includes("from=2026-10-20") && c.url.includes("to=2026-10-01"))).toBe(false);
  });

  it("customise: hide, reorder, resize, reset — saved as the user's layout", () => {
    const onChange = vi.fn();
    const { container } = render(<CustomizePanel layout={DEFAULT_DASHBOARD_LAYOUT} onChange={onChange} onClose={() => {}} />);
    fireEvent.click(container.querySelector("#show-pipeline")!);
    expect(onChange.mock.calls[0][0].widgets.find((w: { key: string }) => w.key === "pipeline").visible).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Move My work up" }));
    expect(onChange.mock.calls[1][0].widgets.map((w: { key: string }) => w.key).slice(0, 3)).toEqual(["kpis", "myWork", "pipeline"]);
    fireEvent.change(screen.getByLabelText("Width of Leads"), { target: { value: "full" } });
    expect(onChange.mock.calls[2][0].widgets.find((w: { key: string }) => w.key === "leads").size).toBe("full");
    fireEvent.click(screen.getByRole("button", { name: "Reset to default" }));
    expect(onChange.mock.calls[3][0]).toEqual(DEFAULT_DASHBOARD_LAYOUT);
    expect((screen.getByRole("button", { name: "Move Key figures up" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("stored layouts survive catalogue changes (unknown keys dropped, new widgets added)", () => {
    expect(resolveDashboardLayout({ widgets: [{ key: "kpis", visible: false, size: "half" }] }).widgets.map((w) => w.key)).toEqual(["kpis", "pipeline", "myWork", "leads", "attention", "activity", "automation", "quickActions"]);
    expect(resolveDashboardLayout({ widgets: [{ key: "bogus", visible: true, size: "half" }] })).toEqual(DEFAULT_DASHBOARD_LAYOUT);
    expect(resolveDashboardLayout(null)).toEqual(DEFAULT_DASHBOARD_LAYOUT);
  });

  it("column chart: tooltip on focus, table view, empty period", () => {
    const { rerender } = render(
      <ColumnChart title="Won and lost" unit="day" points={[{ bucket: "2026-10-12", values: [2, 1] }, { bucket: "2026-10-13", values: [0, 3] }]} series={[{ name: "Won", color: "blue" }, { name: "Lost", color: "orange" }]} />
    );
    expect(screen.getByRole("img").getAttribute("aria-label")).toContain("Won: 2, Lost: 4");
    fireEvent.focus(screen.getByLabelText("2026-10-13: Won 0, Lost 3"));
    expect(screen.getByRole("status").textContent).toContain("Lost3");
    fireEvent.click(screen.getByRole("button", { name: "Show as table" }));
    const rows = screen.getAllByRole("row");
    expect(rows).toHaveLength(3);
    expect(rows[2].textContent).toBe("2026-10-1303");
    rerender(<ColumnChart title="New leads" unit="day" points={[{ bucket: "2026-10-13", values: [0] }]} series={[{ name: "New leads", color: "blue" }]} />);
  });

  it("quick actions only offer what the user may do", () => {
    const { rerender } = render(<QuickActions permissions={allPerms} currentUserId="u1" onChanged={() => {}} />);
    expect(screen.getByRole("link", { name: "Create workflow" }).getAttribute("href")).toBe("/crm/workflows?new=1");
    expect(screen.getByRole("button", { name: "Log a call" })).toBeTruthy();
    rerender(<QuickActions permissions={{ ...allPerms, settingsEdit: false }} currentUserId="u1" onChanged={() => {}} />);
    expect(screen.queryByRole("link", { name: "Create workflow" })).toBeNull();
    rerender(<QuickActions permissions={{ create: false, edit: false, viewAll: false, settings: false, settingsEdit: false }} currentUserId="u1" onChanged={() => {}} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText(/can view the CRM but not add records/)).toBeTruthy();
  });

  it("a whole-request failure shows the reason with a retry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.startsWith("/api/v1/crm/dashboard")
          ? new Response(JSON.stringify({ message: "You can only see your own records.", error: { code: "PERMISSION_DENIED", message: "x" } }), { status: 403 })
          : new Response(JSON.stringify({ data: {} }), { status: 200 })
      )
    );
    render(<CrmDashboardClient permissions={allPerms} currentUserId="u1" userName={null} />);
    expect(await screen.findByText("You can only see your own records.")).toBeTruthy();
  });
});
