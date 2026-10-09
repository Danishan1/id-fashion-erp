// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }), usePathname: () => "/crm", useSearchParams: () => new URLSearchParams() }));

const { ActivityComposer } = await import("./ActivityComposer");
const { ActivityRows } = await import("./ActivityList");
const { ActivityPanel } = await import("./ActivityPanel");
const { ActivityDetail } = await import("./ActivityDetail");
const { DueStateBadge, formatDue } = await import("./ActivityBadges");
const { ACTIVITY_TYPE_KEYS, ACTIVITY_TYPES, ACTIVITY_PRIORITY_KEYS, ACTIVITY_PRIORITIES, REMINDER_OPTIONS } = await import("@/modules/crm/activities/activity-registry");

const ID = "6f1c2f1e-1f2a-4b1a-9d1a-2b3c4d5e6f70";
const OPP = "7f1c2f1e-1f2a-4b1a-9d1a-2b3c4d5e6f71";
const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
const meta = {
  types: ACTIVITY_TYPE_KEYS.map((key) => ({ key, ...ACTIVITY_TYPES[key] })),
  statuses: [],
  priorities: ACTIVITY_PRIORITY_KEYS.map((key) => ({ key, ...ACTIVITY_PRIORITIES[key] })),
  reminders: REMINDER_OPTIONS,
  outcomes: { activity_call_outcome: ["Connected", "No answer"], activity_meeting_outcome: [] },
};
const users = [
  { id: "u1", fullName: "Me Myself" },
  { id: "u2", fullName: "Sales Executive" },
];
const parent = { entityType: "OPPORTUNITY" as const, entityId: OPP, label: "ABC Textiles — Winter Order" };
const activity = (over: Record<string, unknown> = {}) => ({
  id: ID,
  type: "TASK",
  typeLabel: "Task",
  subject: "Follow up for quotation",
  description: null,
  status: "PENDING",
  priority: "HIGH",
  entityType: "OPPORTUNITY",
  entityId: OPP,
  assignedToUserId: "u2",
  assignedTo: { id: "u2", fullName: "Sales Executive", status: "ACTIVE" },
  createdBy: { id: "u1", fullName: "Me Myself" },
  createdByUserId: "u1",
  dueAt: "2026-10-10T05:30:00.000Z",
  allDay: false,
  endAt: null,
  end: null,
  due: { date: "2026-10-10", time: "11:00" },
  dueState: "OVERDUE",
  originalDueAt: "2026-10-10T05:30:00.000Z",
  rescheduleCount: 0,
  reminderOffsetMinutes: 30,
  reminderAt: "2026-10-10T05:00:00.000Z",
  reminderState: "PENDING",
  reminderSentAt: null,
  outcome: null,
  direction: null,
  durationMinutes: null,
  location: null,
  completedAt: null,
  completedByName: null,
  updatedByName: null,
  source: "MANUAL",
  metadata: {},
  version: 3,
  createdAt: "2026-10-05T05:30:00.000Z",
  updatedAt: "2026-10-05T05:30:00.000Z",
  links: [{ entityType: "OPPORTUNITY", entityId: OPP, isPrimary: true, label: "OPP-1 — Winter Order", href: `/crm/opportunities/${OPP}`, archived: false }],
  primary: { entityType: "OPPORTUNITY", entityId: OPP, isPrimary: true, label: "OPP-1 — Winter Order", href: `/crm/opportunities/${OPP}`, archived: false },
  permissions: { edit: true, complete: true, reopen: false, delete: true },
  ...over,
});
const calls = (f: ReturnType<typeof vi.fn>) => f.mock.calls as unknown as [string, RequestInit?][];

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("activity UI", () => {
  it("formats due dates and states", () => {
    expect(formatDue({ date: "2026-10-10", time: "11:00" }, "12:00")).toBe("10 Oct 2026, 11:00–12:00");
    expect(formatDue(null)).toBe("No due date");
    render(<DueStateBadge state="OVERDUE" />);
    expect(screen.getByText("Overdue")).toBeTruthy();
  });

  it("creates a task from a record with the record pre-filled, assignee, due date/time, reminder and priority", async () => {
    const fetchMock = vi.fn(() => json({ data: activity() }, 201));
    vi.stubGlobal("fetch", fetchMock);
    const onSaved = vi.fn();
    render(<ActivityComposer meta={meta as never} users={users} currentUserId="u1" parent={parent} onClose={vi.fn()} onSaved={onSaved} />);
    expect(screen.queryByLabelText(/Related to/)).toBeNull(); // record comes from the page
    fireEvent.change(screen.getByLabelText(/Subject/), { target: { value: "Follow up for quotation" } });
    fireEvent.change(screen.getByLabelText(/Due date/), { target: { value: "2026-10-10" } });
    fireEvent.change(screen.getByLabelText(/Due time/), { target: { value: "11:00" } });
    fireEvent.change(screen.getByLabelText(/Reminder/), { target: { value: "30" } });
    fireEvent.change(screen.getByLabelText(/Assigned to/), { target: { value: "u2" } });
    fireEvent.change(screen.getByLabelText(/Priority/), { target: { value: "HIGH" } });
    fireEvent.click(screen.getByRole("button", { name: "Add task" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const [url, init] = calls(fetchMock)[0];
    expect(url).toBe("/api/v1/crm/activities");
    expect(JSON.parse(String(init!.body))).toMatchObject({ type: "TASK", mode: "schedule", entityType: "OPPORTUNITY", entityId: OPP, subject: "Follow up for quotation", dueDate: "2026-10-10", dueTime: "11:00", reminderMinutes: "30", assignedToUserId: "u2", priority: "HIGH" });
  });

  it("logs a call with outcome suggestions, and shows server field errors", async () => {
    const fetchMock = vi.fn(() => json({ error: { code: "VALIDATION_ERROR", message: "A logged activity can't be in the future.", details: { fieldErrors: { occurredDate: "Choose a past date." } } } }, 400));
    vi.stubGlobal("fetch", fetchMock);
    render(<ActivityComposer meta={meta as never} users={users} currentUserId="u1" parent={parent} initialType="CALL" initialMode="log" onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.getByRole("radio", { name: "Call" }).getAttribute("aria-checked")).toBe("true");
    expect(document.querySelectorAll("#activity-outcome-options option")).toHaveLength(2);
    fireEvent.change(screen.getByLabelText(/Subject/), { target: { value: "Called ABC" } });
    fireEvent.change(screen.getByLabelText(/Outcome/), { target: { value: "Connected" } });
    fireEvent.click(screen.getByRole("button", { name: "Log call" }));
    expect(await screen.findByText("Choose a past date.")).toBeTruthy();
    expect(JSON.parse(String(calls(fetchMock)[0][1]!.body))).toMatchObject({ type: "CALL", mode: "log", outcome: "Connected", direction: "OUTBOUND" });
    // Messages can only be logged: no schedule option
    fireEvent.click(screen.getByRole("radio", { name: "WhatsApp" }));
    expect(screen.queryByRole("radiogroup", { name: "Schedule or log" })).toBeNull();
  });

  it("asks for the related record when opened from the activity list", () => {
    render(<ActivityComposer meta={meta as never} users={users} currentUserId="u1" onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.getByLabelText(/Related to/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Subject/), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Add task" }));
    expect(screen.getByRole("alert").textContent).toMatch(/Choose the record/);
  });

  it("completes an open task with one tick and shows overdue / priority", async () => {
    const fetchMock = vi.fn(() => json({ data: activity({ status: "COMPLETED" }) }));
    vi.stubGlobal("fetch", fetchMock);
    const onChanged = vi.fn();
    render(<ActivityRows rows={[activity() as never]} canEdit onOpen={vi.fn()} onChanged={onChanged} />);
    expect(screen.getByText("Overdue")).toBeTruthy();
    expect(screen.getByText("High")).toBeTruthy();
    expect(screen.getByRole("link", { name: "OPP-1 — Winter Order" })).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Complete Follow up for quotation"));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(calls(fetchMock)[0][0]).toBe(`/api/v1/crm/activities/${ID}/complete`);
    expect(JSON.parse(String(calls(fetchMock)[0][1]!.body))).toEqual({ version: 3 });
  });

  it("record panel loads open activities for the record, switches tabs and offers quick adds", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.startsWith("/api/v1/crm/activities/meta")) return json({ data: meta });
      if (url.startsWith("/api/v1/users")) return json({ data: users });
      return json({ data: url.includes("state=closed") ? [activity({ id: "c1", subject: "Called them", status: "COMPLETED", dueState: "COMPLETED", permissions: { edit: false, complete: false, reopen: true, delete: false } })] : [activity()] });
    });
    vi.stubGlobal("fetch", fetchMock);
    const onAddNote = vi.fn();
    render(<ActivityPanel parent={parent} canCreate canEdit currentUserId="u1" onAddNote={onAddNote} />);
    expect(await screen.findByText("Follow up for quotation")).toBeTruthy();
    const first = calls(fetchMock).map(([u]) => u).find((u) => u.startsWith("/api/v1/crm/activities?"))!;
    expect(first).toContain(`entityType=OPPORTUNITY&entityId=${OPP}`);
    expect(first).toContain("state=open");
    fireEvent.click(screen.getByRole("tab", { name: "Completed" }));
    expect(await screen.findByText("Called them")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "+ Note" }));
    expect(onAddNote).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "+ Task" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "+ Log call" })).toBeTruthy();
  });

  it("detail reschedules with a reason and shows the original due date afterwards", async () => {
    let current = activity();
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url.startsWith("/api/v1/crm/events")) return json({ data: [], meta: { totalPages: 1 } });
      if (url.endsWith("/reschedule")) {
        current = activity({ due: { date: "2026-10-12", time: "15:00" }, dueState: "UPCOMING", rescheduleCount: 1, version: 4 });
        return json({ data: current, init });
      }
      return json({ data: current });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ActivityDetail activityId={ID} meta={meta as never} users={users} canEdit />);
    expect(await screen.findByRole("heading", { name: "Follow up for quotation" })).toBeTruthy();
    expect(screen.getByText(/30 minutes before/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reschedule" }));
    fireEvent.change(screen.getByLabelText(/New date/), { target: { value: "2026-10-12" } });
    fireEvent.change(screen.getByLabelText(/^Time/), { target: { value: "15:00" } });
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: "Buyer travelling" } });
    const form = screen.getByLabelText(/New date/).closest("form")!;
    fireEvent.click(within(form).getByRole("button", { name: "Reschedule" }));
    await screen.findByText(/Rescheduled 1×/);
    const [, init] = calls(fetchMock).find(([u]) => u.endsWith("/reschedule"))!;
    expect(JSON.parse(String(init!.body))).toEqual({ version: 3, dueDate: "2026-10-12", dueTime: "15:00", reason: "Buyer travelling" });
  });

  it("detail hides edit actions for completed activities and offers Reopen", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => (url.startsWith("/api/v1/crm/events") ? json({ data: [], meta: { totalPages: 1 } }) : json({ data: activity({ status: "COMPLETED", dueState: "COMPLETED", completedAt: "2026-10-10T06:00:00.000Z", completedByName: "Sales Executive", outcome: "Sent", permissions: { edit: false, complete: false, reopen: true, delete: false } }) }))));
    render(<ActivityDetail activityId={ID} meta={meta as never} users={users} canEdit />);
    expect(await screen.findByRole("button", { name: "Reopen" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Mark complete" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
    expect(screen.getByText("Sent")).toBeTruthy();
  });
});
