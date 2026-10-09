// @vitest-environment jsdom
import { cleanup, createEvent, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }), usePathname: () => "/crm/calendar", useSearchParams: () => new URLSearchParams("view=week&date=2026-10-15") }));
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }));
vi.mock("@/components/ui/Toast", () => ({ toast: toasts }));

const { CalendarClient } = await import("./CalendarClient");

const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
const meta = { statuses: [], actions: [], reminders: [], appointmentTypes: ["Product demo"], cancelReasons: [], noShowReasons: [], outcomes: [], defaultTimeZone: "Asia/Kolkata", defaultDurationMinutes: 60, canViewAll: true };
const appt = {
  id: "a1",
  type: "APPOINTMENT",
  title: "Product Demo",
  status: "CONFIRMED",
  statusLabel: "Confirmed",
  timezone: "Asia/Kolkata",
  startAt: "2026-10-15T05:30:00.000Z",
  endAt: "2026-10-15T06:30:00.000Z",
  version: 3,
  assignedTo: { id: "u1", fullName: "Ravi Rep" },
  relations: { contact: { label: "Rahul Sharma" }, company: { label: "ABC Textiles" }, opportunity: null, lead: null },
  allowed: { actions: ["reschedule", "complete", "cancel", "no_show"], edit: true, assign: true },
  createdAt: "2026-10-01T00:00:00.000Z",
};

let reschedule: () => Promise<Response>;
let fetchMock: ReturnType<typeof vi.fn>;
const calls = () => fetchMock.mock.calls as [string, RequestInit?][];
const posts = () => calls().filter(([u, i]) => u.endsWith("/reschedule") && i?.method === "POST");

beforeEach(() => {
  reschedule = () => json({ data: { ...appt, status: "RESCHEDULED", startAt: "2026-10-16T08:30:00.000Z", endAt: "2026-10-16T09:30:00.000Z", version: 4 } });
  fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (url === "/api/v1/crm/appointments/meta") return json({ data: meta });
    if (url === "/api/v1/users") return json({ data: [{ id: "u1", fullName: "Ravi Rep", status: "ACTIVE" }] });
    if (url.startsWith("/api/v1/crm/preferences")) return json({ data: {} });
    if (url.startsWith("/api/v1/crm/appointments/calendar")) return json({ data: [appt], truncated: false });
    if (url.endsWith("/reschedule") && init?.method === "POST") return reschedule();
    return json({ data: [] });
  });
  vi.stubGlobal("fetch", fetchMock);
  for (const t of Object.values(toasts)) t.mockReset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const renderCalendar = () => render(<CalendarClient currentUserId="u1" permissions={{ create: true, edit: true, viewAll: true }} />);
const dayCol = (d: string) => screen.getByRole("region", { name: `Appointments on ${d}` });
const dragTo = (d: string, clientY: number) => {
  const data: Record<string, string> = {};
  const dataTransfer = { setData: (k: string, v: string) => (data[k] = v), getData: (k: string) => data[k] ?? "", dropEffect: "", effectAllowed: "" };
  const card = screen.getByRole("button", { name: /Product Demo/ });
  const start = createEvent.dragStart(card, { dataTransfer });
  Object.defineProperty(start, "clientY", { value: 0 });
  fireEvent(card, start);
  fireEvent.dragOver(dayCol(d), { dataTransfer });
  const drop = createEvent.drop(dayCol(d), { dataTransfer });
  Object.defineProperty(drop, "clientY", { value: clientY });
  fireEvent(dayCol(d), drop);
};

describe("calendar page", () => {
  it("loads only the visible week for My calendar in the business zone", async () => {
    renderCalendar();
    await screen.findByRole("button", { name: /Product Demo/ }, { timeout: 3000 });
    expect(within(dayCol("2026-10-15")).getByRole("button", { name: /Product Demo/ })).toBeTruthy();
    const [url] = calls().find(([u]) => u.startsWith("/api/v1/crm/appointments/calendar"))!;
    const qs = new URL(url, "http://x").searchParams;
    expect(qs.get("from")).toBe("2026-10-11T18:30:00.000Z"); // Mon 12 Oct 00:00 IST
    expect(qs.get("to")).toBe("2026-10-18T18:30:00.000Z");
    expect(qs.get("mine")).toBe("true");
    expect(screen.getByRole("heading", { name: /12 Oct.*18 Oct 2026/ })).toBeTruthy();
  });

  it("drags through the reschedule API in the appointment's zone and keeps the move on success", async () => {
    renderCalendar();
    await screen.findByRole("button", { name: /Product Demo/ }, { timeout: 3000 });
    expect(within(dayCol("2026-10-15")).getByRole("button", { name: /Product Demo/ })).toBeTruthy();
    dragTo("2026-10-16", 14 * 48);
    // Optimistic: already in the new column.
    expect(within(dayCol("2026-10-16")).getByRole("button", { name: /Product Demo/ })).toBeTruthy();
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(JSON.parse(String(posts()[0][1]!.body))).toEqual({ version: 3, startDate: "2026-10-16", startTime: "14:00", endDate: "", endTime: "15:00" });
    await waitFor(() => expect(toasts.success).toHaveBeenCalledWith('Rescheduled "Product Demo".'));
  });

  it("puts the appointment back when the server refuses", async () => {
    reschedule = () => json({ error: { code: "INVALID_STATE_TRANSITION", message: "This appointment is completed and can't be rescheduled." } }, 409);
    renderCalendar();
    await screen.findByRole("button", { name: /Product Demo/ }, { timeout: 3000 });
    expect(within(dayCol("2026-10-15")).getByRole("button", { name: /Product Demo/ })).toBeTruthy();
    dragTo("2026-10-17", 9 * 48);
    await waitFor(() => expect(toasts.error).toHaveBeenCalledWith("This appointment is completed and can't be rescheduled."));
    expect(within(dayCol("2026-10-15")).getByRole("button", { name: /Product Demo/ })).toBeTruthy();
    expect(within(dayCol("2026-10-17")).queryByRole("button", { name: /Product Demo/ })).toBeNull();
  });

  it("asks before moving into a busy slot: keep rolls back, move anyway resends with allowConflict", async () => {
    let n = 0;
    reschedule = () => {
      n++;
      return n <= 2
        ? json({ error: { code: "CRM_APPOINTMENT_CONFLICT", message: "The selected employee already has an appointment during this time.", details: { conflicts: [{ id: "b", title: "Existing Meeting", startAt: "2026-10-16T08:30:00.000Z", endAt: "2026-10-16T09:00:00.000Z" }] } } }, 409)
        : json({ data: { ...appt, startAt: "2026-10-16T08:30:00.000Z", endAt: "2026-10-16T09:30:00.000Z", version: 4 } });
    };
    renderCalendar();
    await screen.findByRole("button", { name: /Product Demo/ }, { timeout: 3000 });
    expect(within(dayCol("2026-10-15")).getByRole("button", { name: /Product Demo/ })).toBeTruthy();
    dragTo("2026-10-16", 14 * 48);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Existing Meeting/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Keep current time" }));
    expect(within(dayCol("2026-10-15")).getByRole("button", { name: /Product Demo/ })).toBeTruthy();

    dragTo("2026-10-16", 14 * 48);
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Move anyway" }));
    await waitFor(() => expect(posts()).toHaveLength(3));
    expect(JSON.parse(String(posts()[2][1]!.body)).allowConflict).toBe(true);
  });

  it("switches views and remembers the choice", async () => {
    renderCalendar();
    await screen.findByRole("button", { name: /Product Demo/ }, { timeout: 3000 });
    expect(within(dayCol("2026-10-15")).getByRole("button", { name: /Product Demo/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "month" }));
    expect(await screen.findByRole("grid", { name: "Month" })).toBeTruthy();
    await waitFor(() => expect(calls().some(([u]) => u.startsWith("/api/v1/crm/appointments/calendar") && u.includes("from=2026-09-27T18%3A30"))).toBe(true));
    fireEvent.click(screen.getByRole("tab", { name: "day" }));
    expect(screen.getAllByRole("region")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("heading", { name: /Friday, 16 October 2026/ })).toBeTruthy();
  });
});
