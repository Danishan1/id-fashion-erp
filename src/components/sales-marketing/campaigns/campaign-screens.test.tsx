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
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn(), back: vi.fn() }) }));
// The CRM task panel has its own tests; here it only has to be placed with the campaign as its record.
const panel = vi.fn();
vi.mock("@/components/crm/activities/ActivityPanel", () => ({ ActivityPanel: (p: unknown) => (panel(p), <div>activity panel</div>) }));

const { CampaignDetailClient } = await import("./CampaignDetailClient");
const { CampaignLinkPanel } = await import("./CampaignLinkPanel");
const { CampaignCalendarClient } = await import("./CampaignCalendarClient");
type View = Parameters<typeof CampaignDetailClient>[0]["initial"];

const ok = (data: unknown) => Promise.resolve(new Response(JSON.stringify({ data }), { status: 200 }));
const can = (extra: Partial<View["can"]> = {}): View["can"] => ({
  edit: true,
  editPlan: false,
  requestPlanChange: true,
  submit: false,
  returnToDraft: false,
  approve: false,
  sendBack: false,
  activate: false,
  pause: true,
  resume: false,
  complete: true,
  cancel: true,
  delete: false,
  metrics: true,
  linkExpenses: true,
  activities: true,
  createActivities: true,
  editActivities: true,
  ...extra,
});
const view = (extra: Partial<View> = {}): View => ({
  id: "c1",
  code: "FAIR26",
  name: "Trade fair",
  description: null,
  status: "ACTIVE",
  statusHelp: "Running.",
  statusReason: null,
  type: { id: "t", name: "Trade fair / exhibition" },
  objective: { id: "o", name: "Lead generation" },
  owner: { id: "u1", fullName: "Asha" },
  department: null,
  salesChannel: null,
  parent: null,
  children: [],
  priority: "HIGH",
  plannedStartDate: "2026-11-01",
  plannedEndDate: "2026-11-30",
  actualStartDate: "2026-11-02",
  actualEndDate: null,
  plannedBudget: 80000,
  budgetNotes: null,
  currencyCode: "INR",
  approvedRevisionNumber: 2,
  version: 3,
  createdBy: "Prep",
  createdAt: "2026-10-20T10:00:00.000Z",
  updatedBy: "Prep",
  updatedAt: "2026-11-02T10:00:00.000Z",
  revisions: [
    { id: "r2", revisionNumber: 2, status: "APPROVED", plannedStartDate: "2026-11-01", plannedEndDate: "2026-11-30", plannedBudget: 80000, budgetNotes: null, reason: "Bigger stand", autoApproved: false, requestedBy: "Asha", requestedAt: "2026-10-25T10:00:00.000Z", decidedBy: "Appr", decidedAt: "2026-10-26T10:00:00.000Z", decisionComment: null },
  ],
  metrics: [
    { id: "m1", source: "SYSTEM", systemKey: "LEADS", label: "Leads", unit: "COUNT", target: 10, actual: 4, documents: 4, percentOfTarget: 40, provenance: "CRM leads with this campaign.", notes: null },
    { id: "m2", source: "MANUAL", systemKey: null, label: "Booth visitors", unit: "COUNT", target: 300, actual: 240, documents: null, percentOfTarget: 80, provenance: "Entered manually by Asha (as of 2026-11-03).", notes: null },
  ],
  budget: { planned: 80000, actual: 30000, pending: 12000, remaining: 50000, expenses: [{ id: "e1", number: "EXP-1", date: "2026-11-02", description: "Stand", supplier: null, amount: 30000, tax: 5400, status: "APPROVED", counts: true }] },
  links: { leads: [], enquiries: [], quotations: null, orders: [] },
  progress: { total: 2, done: 0, overdue: 1, milestones: 1, milestonesDone: 0 },
  milestones: [{ id: "a1", subject: "Catalogue approved", status: "PENDING", dueDate: "2026-11-01", overdue: true, completedAt: null, assignee: "Asha" }],
  history: [{ id: "h1", type: "REVISION_APPROVED", comment: null, metadata: { revision: 2 }, at: "2026-10-26T10:00:00.000Z", by: "Appr" }],
  warnings: ["1 overdue activity."],
  can: can(),
  ...extra,
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  panel.mockClear();
});

describe("Campaign screens", () => {
  it("detail: metrics marked measured vs manual, budget planned / actual / pending / remaining, CRM task panel on the campaign", () => {
    render(<CampaignDetailClient initial={view()} currentUserId="u1" />);
    expect(screen.getAllByText("Measured").length).toBe(1);
    expect(screen.getAllByText("Manual").length).toBe(1);
    expect(screen.getByText(/Entered manually by Asha/)).toBeTruthy();
    expect(screen.getByText("₹50,000.00")).toBeTruthy();
    expect(screen.getByText("₹12,000.00")).toBeTruthy();
    expect(screen.getByText(/◆ Catalogue approved/)).toBeTruthy();
    expect(panel).toHaveBeenCalledWith(expect.objectContaining({ parent: expect.objectContaining({ entityType: "CAMPAIGN", entityId: "c1" }) }));
    expect(screen.getByText("No access.")).toBeTruthy(); // quotations not visible to this user
    expect(screen.getByText(/Plan change approved/)).toBeTruthy();
  });

  it("pause asks for a reason and posts the action; the fresh campaign replaces the view", async () => {
    const fetchMock = vi.fn(() => ok(view({ status: "PAUSED", statusReason: "Stand delayed", can: can({ pause: false, resume: true }) })));
    vi.stubGlobal("fetch", fetchMock);
    render(<CampaignDetailClient initial={view()} currentUserId="u1" />);
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: "Stand delayed" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Pause" }).at(-1)!);
    await waitFor(() => expect(screen.getByText(/Reason: Stand delayed/)).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/sales-marketing/campaigns/c1/pause", expect.objectContaining({ method: "POST", body: JSON.stringify({ reason: "Stand delayed" }) }));
  });

  it("without CRM access the activities section explains why it is empty", () => {
    render(<CampaignDetailClient initial={view({ can: can({ activities: false }) })} currentUserId="u1" />);
    expect(screen.getByText(/you need CRM access/)).toBeTruthy();
    expect(panel).not.toHaveBeenCalled();
  });

  it("link panel: shows the campaign; on an order a reason is required", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => (url.includes("options") ? ok([{ id: "c1", code: "FAIR26", name: "Trade fair", status: "ACTIVE" }]) : ok({ campaignId: "c1", campaign: "Trade fair (FAIR26)", history: [] }))));
    render(<CampaignLinkPanel docType="order" id="o1" canChange />);
    await waitFor(() => expect(screen.getByRole("link", { name: "Trade fair (FAIR26)" }).getAttribute("href")).toBe("/sales-marketing/campaigns/c1"));
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    expect((screen.getByLabelText(/Reason/) as HTMLTextAreaElement).required).toBe(true);
  });

  it("calendar: planned and actual bars and a milestone marker for the month", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        url.includes("/calendar")
          ? ok({
              month: "2026-11",
              start: "2026-11-01",
              end: "2026-11-30",
              campaigns: [{ id: "c1", code: "FAIR26", name: "Trade fair", status: "ACTIVE", owner: "Asha", type: "Fair", plannedStartDate: "2026-11-05", plannedEndDate: "2026-11-20", actualStartDate: "2026-11-06", actualEndDate: null }],
              activities: [{ id: "a1", campaignId: "c1", subject: "Catalogue approved", type: "TASK", status: "PENDING", dueDate: "2026-11-04", overdue: false, milestone: true }],
              activitiesHidden: false,
            })
          : ok([])
      )
    );
    render(<CampaignCalendarClient initialMonth="2026-11" today="2026-11-10" />);
    await waitFor(() => expect(screen.getByTitle("Planned 2026-11-05 → 2026-11-20")).toBeTruthy());
    expect(screen.getByTitle("Actual 2026-11-06 → running")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Milestone Catalogue approved" }).getAttribute("href")).toBe("/crm/activities/a1");
  });
});
