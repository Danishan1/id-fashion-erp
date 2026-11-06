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
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }) }));

const { TargetDetailClient } = await import("./TargetDetailClient");
const { PerformanceBoardClient } = await import("./PerformanceBoardClient");
const { SalesCreditPanel } = await import("./SalesCreditPanel");
type Detail = Parameters<typeof TargetDetailClient>[0]["initial"];

const revision = (extra: Record<string, unknown> = {}) => ({
  id: "r1",
  revisionNumber: 1,
  status: "PENDING_APPROVAL",
  targetValue: 200000,
  notes: null,
  version: 2,
  createdBy: "Asha",
  createdAt: "2026-11-01T10:00:00.000Z",
  updatedBy: "Asha",
  submittedBy: "Asha",
  submittedAt: "2026-11-01T10:00:00.000Z",
  approvedBy: null,
  approvedAt: null,
  approvedAfterPeriodStart: false,
  decisionComment: null,
  supersededAt: null,
  ...extra,
});
const detail = (extra: Partial<Detail> = {}): Detail => ({
  id: "t1",
  scope: "REP",
  scopeLabel: "Sales rep",
  userId: "u2",
  territoryId: null,
  subject: "Ravi",
  metric: "BOOKED_ORDER_VALUE",
  metricLabel: "Booked order value",
  metricDefinition: "Order value before GST.",
  dateBasis: "Order date",
  unit: "CURRENCY",
  periodType: "MONTH",
  periodLabel: "Nov 2026",
  periodStart: "2026-11-01",
  periodEnd: "2026-11-30",
  archived: false,
  archivedAt: null,
  archivedBy: null,
  archiveReason: null,
  periodEnded: false,
  progress: { state: "CURRENT", totalDays: 30, elapsedDays: 3, remainingDays: 27 },
  attainment: { target: null, actual: 15000, gap: null, percent: null, expectedToDate: null, pace: null },
  documents: 2,
  calculatedAt: "2026-11-03T10:00:00.000Z",
  canApprove: false,
  revisions: [revision()] as Detail["revisions"],
  events: [],
  ...extra,
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Target detail", () => {
  it("never shows a pending value as the target, and tells the preparer someone else must approve", () => {
    render(<TargetDetailClient initial={detail()} perms={{ edit: true, approve: true, reject: true }} />);
    expect(screen.getByText("Not approved yet")).toBeTruthy();
    expect(screen.getByText("₹15,000.00")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.getByText(/someone else must approve it/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Send back" })).toBeTruthy();
  });

  it("an approver approves through the API and sees the approved figures", async () => {
    const approved = detail({
      canApprove: false,
      attainment: { target: 200000, actual: 15000, gap: 185000, percent: 7.5, expectedToDate: 20000, pace: "BEHIND" },
      revisions: [revision({ status: "APPROVED", approvedBy: "Meera", approvedAt: "2026-11-03T10:00:00.000Z" })] as Detail["revisions"],
    });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: approved }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<TargetDetailClient initial={detail({ canApprove: true })} perms={{ edit: false, approve: true, reject: false }} />);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(screen.getAllByText("₹2,00,000.00").length).toBeGreaterThan(0));
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/sales-marketing/performance/targets/t1/revisions/r1/approve", expect.objectContaining({ method: "POST" }));
    expect(screen.getByText("7.5%")).toBeTruthy();
    expect(screen.getByText("Behind pace")).toBeTruthy();
    expect(screen.getByText("₹1,85,000.00 to go")).toBeTruthy();
    // No open revision any more → "Change target" would need edit permission.
    expect(screen.queryByRole("button", { name: "Change target" })).toBeNull();
  });

  it("an ended period can't be changed", () => {
    render(<TargetDetailClient initial={detail({ periodEnded: true, revisions: [revision({ status: "APPROVED" })] as Detail["revisions"] })} perms={{ edit: true, approve: true, reject: true }} />);
    expect(screen.queryByRole("button", { name: "Change target" })).toBeNull();
    expect(screen.getByText(/past targets can't be changed/)).toBeTruthy();
  });
});

describe("Performance board", () => {
  const row = (extra: Record<string, unknown>) => ({ target: null, actual: 0, gap: null, percent: null, expectedToDate: null, pace: null, documents: 0, targetId: null, rank: 1, ...extra });
  const board = {
    metric: "BOOKED_ORDER_VALUE",
    metricLabel: "Booked order value",
    metricDefinition: "Order value before GST.",
    dateBasis: "Order date",
    unit: "CURRENCY",
    period: { type: "MONTH", start: "2026-11-01", end: "2026-11-30", label: "Nov 2026" },
    progress: { state: "CURRENT", totalDays: 30, elapsedDays: 3, remainingDays: 27 },
    viewAll: false,
    me: row({ userId: "u1", name: "Asha", actual: 1100, target: 1000, percent: 110, gap: -100, pace: "AHEAD", documents: 2, targetId: "t1" }),
    reps: [row({ userId: "u1", name: "Asha", isMe: true, actual: 1100, target: 1000, percent: 110, gap: -100, pace: "AHEAD", documents: 2, targetId: "t1" }), row({ userId: "u2", name: "Ravi", isMe: false, rank: 2 })],
    teams: [],
    territories: [],
    company: null,
    calculatedAt: "2026-11-03T10:00:00.000Z",
  };

  it("shows my figures and the ranking, and drills into the documents behind a number", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.startsWith("/api/v1/sales-marketing/performance/board")) return new Response(JSON.stringify({ data: board }), { status: 200 });
      return new Response(
        JSON.stringify({
          data: {
            label: "Asha",
            unit: "CURRENCY",
            truncated: false,
            reason: null,
            documents: [
              { id: "o1", kind: "SALES_ORDER", number: "ORD-1", date: "2026-11-02", customer: "Zenith", rep: "Asha", territory: null, value: 1000, status: "CONFIRMED", href: "/sales-orders/o1" },
              { id: "o2", kind: "SALES_ORDER", number: "ORD-2", date: "2026-11-03", customer: "Zenith", rep: "Asha", territory: null, value: 100, status: "ON_HOLD", href: "/sales-orders/o2" },
            ],
          },
        }),
        { status: 200 }
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<PerformanceBoardClient fiscalStartMonth={4} today="2026-11-03" initial={{ metric: "BOOKED_ORDER_VALUE", periodType: "MONTH", periodStart: "2026-11-01" }} />);
    await waitFor(() => expect(screen.getByText("Me · Nov 2026")).toBeTruthy());
    expect(screen.getAllByText("110%").length).toBeGreaterThan(0);
    expect(screen.getByText("₹100.00 over")).toBeTruthy();
    expect(screen.getByText("No teams in your view. Teams come from the CRM reporting tree (Employees → reporting lines).")).toBeTruthy();
    expect(screen.getByRole("button", { name: "0 docs" }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "2 docs" }));
    await waitFor(() => expect(screen.getByText("ORD-2")).toBeTruthy());
    expect(fetchMock).toHaveBeenLastCalledWith(expect.stringContaining("repId=u1"), expect.anything());
    expect(screen.getByRole("link", { name: "ORD-1" }).getAttribute("href")).toBe("/sales-orders/o1");
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("₹1,100.00")).toBeTruthy(); // total of the documents = the board figure
  });
});

describe("Sales credit panel", () => {
  it("shows how the credit was set and changes it with a reason", async () => {
    const changed = { salesRepUserId: "u2", salesRep: "Ravi", salesTerritoryId: null, salesTerritory: null, source: "MANUAL", sourceLabel: "Changed by hand", changedAt: "2026-11-03T10:00:00.000Z", changedBy: "Meera", reason: "Ravi handles this buyer", history: [] };
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/reps")) return new Response(JSON.stringify({ data: [{ id: "u1", fullName: "Asha" }, { id: "u2", fullName: "Ravi" }] }), { status: 200 });
      if (url.endsWith("/territories/options")) return new Response(JSON.stringify({ data: [] }), { status: 200 });
      return new Response(JSON.stringify({ data: changed }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(
      <SalesCreditPanel
        orderId="o1"
        canChange
        initial={{ salesRepUserId: "u1", salesRep: "Asha", salesTerritoryId: null, salesTerritory: null, source: "QUOTATION_OWNER", sourceLabel: "Quotation owner", changedAt: null, changedBy: null, reason: null, history: [] }}
      />
    );
    expect(screen.getByText(/Set automatically — quotation owner/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    fireEvent.change(await screen.findByLabelText(/Reason/), { target: { value: "Ravi handles this buyer" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByText(/Changed by Meera/)).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/sales-marketing/performance/orders/o1/credit", expect.objectContaining({ method: "PATCH" }));
  });
});
