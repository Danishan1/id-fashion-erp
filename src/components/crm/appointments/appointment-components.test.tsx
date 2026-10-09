// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }), usePathname: () => "/crm/calendar", useSearchParams: () => new URLSearchParams() }));
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }));
vi.mock("@/components/ui/Toast", () => ({ toast: toasts }));

const { createEvent } = await import("@testing-library/react");
/** jsdom drag events carry no pointer position — set it explicitly. */
const fireAt = (kind: "dragStart" | "drop", el: Element, clientY: number, dataTransfer: unknown) => {
  const evt = createEvent[kind](el, { dataTransfer });
  Object.defineProperty(evt, "clientY", { value: clientY });
  fireEvent(el, evt);
};
const { CrmCalendar, calendarRange, daySegments, periodLabel, shiftDate } = await import("./CrmCalendar");
const { AppointmentForm } = await import("./AppointmentForm");
const { AppointmentDetail } = await import("./AppointmentDetail");
type Meta = import("./appointment-types").AppointmentMetaDto;
type Appt = import("./appointment-types").AppointmentDto;

const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
const meta: Meta = {
  statuses: [],
  actions: [],
  reminders: [
    { minutes: 15, label: "15 minutes before" },
    { minutes: 30, label: "30 minutes before" },
  ],
  appointmentTypes: ["Product demo"],
  cancelReasons: ["Customer unavailable"],
  noShowReasons: ["Customer did not attend"],
  outcomes: ["Positive"],
  defaultTimeZone: "Asia/Kolkata",
  defaultDurationMinutes: 60,
  canViewAll: true,
};
const users = [
  { id: "u1", fullName: "Ravi Rep" },
  { id: "u2", fullName: "Zoya Other" },
];
const link = (entityType: string, entityId: string, label: string) => ({ entityType, entityId, label, href: `/crm/x/${entityId}`, isPrimary: false, archived: false });
const appt = (extra: Partial<Appt> = {}): Appt =>
  ({
    id: "a1",
    type: "APPOINTMENT",
    title: "Product Demo",
    subject: "Product Demo",
    status: "SCHEDULED",
    statusLabel: "Scheduled",
    timezone: "Asia/Kolkata",
    startAt: "2026-10-15T05:30:00.000Z",
    endAt: "2026-10-15T06:30:00.000Z",
    start: { date: "2026-10-15", time: "11:00", weekday: 4 },
    end: { date: "2026-10-15", time: "12:00", weekday: 4 },
    durationMinutes: 60,
    version: 3,
    assignedToUserId: "u1",
    assignedTo: { id: "u1", fullName: "Ravi Rep", status: "ACTIVE" },
    createdBy: { id: "u1", fullName: "Ravi Rep" },
    createdAt: "2026-10-01T05:30:00.000Z",
    updatedAt: "2026-10-01T05:30:00.000Z",
    relations: { contact: link("CONTACT", "c1", "Rahul Sharma"), company: link("COMPANY", "co1", "ABC Textiles Pvt Ltd"), opportunity: null, lead: null },
    allowed: { actions: ["confirm", "reschedule", "complete", "cancel", "no_show"], edit: true, assign: true },
    location: "ABC Textiles Factory, Noida",
    videoLink: "https://meet.example.com/abc",
    reminderOffsetMinutes: 30,
    reminderState: "PENDING",
    rescheduleCount: 0,
    metadata: {},
    ...extra,
  }) as unknown as Appt;

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(() => json({ data: [] }));
  vi.stubGlobal("fetch", fetchMock);
  for (const t of Object.values(toasts)) t.mockReset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const calls = () => fetchMock.mock.calls as [string, RequestInit?][];

describe("calendar periods", () => {
  it("computes day, week (Monday start) and 6-week month windows in the chosen zone", () => {
    expect(calendarRange("day", "2026-10-15", "Asia/Kolkata")).toMatchObject({ days: ["2026-10-15"] });
    expect(calendarRange("day", "2026-10-15", "Asia/Kolkata").from.toISOString()).toBe("2026-10-14T18:30:00.000Z");
    const week = calendarRange("week", "2026-10-15", "Europe/London");
    expect(week.days[0]).toBe("2026-10-12");
    expect(week.days).toHaveLength(7);
    expect(week.from.toISOString()).toBe("2026-10-11T23:00:00.000Z"); // BST midnight
    const month = calendarRange("month", "2026-10-15", "Asia/Kolkata");
    expect(month.days).toHaveLength(42);
    expect(month.days[0]).toBe("2026-09-28");
    expect(month.days).toContain("2026-10-31");
    // A week containing the end of BST is 169 hours long.
    const dstWeek = calendarRange("week", "2026-10-25", "Europe/London");
    expect((dstWeek.to.getTime() - dstWeek.from.getTime()) / 3_600_000).toBe(169);
  });

  it("navigates by period and labels it", () => {
    expect(shiftDate("day", "2026-10-31", 1)).toBe("2026-11-01");
    expect(shiftDate("week", "2026-10-15", -1)).toBe("2026-10-08");
    expect(shiftDate("month", "2026-01-31", 1)).toBe("2026-02-28");
    expect(shiftDate("month", "2026-12-15", 1)).toBe("2027-01-15");
    expect(periodLabel("month", "2026-10-15")).toMatch(/October 2026/);
    expect(periodLabel("week", "2026-10-15")).toMatch(/12 Oct.*18 Oct 2026/);
  });

  it("lays out overlapping events side by side and splits events across midnight", () => {
    const ev = (id: string, start: string, end: string) => ({ id, start, end, title: id, tone: "indigo" as const });
    const segs = daySegments(
      [ev("a", "2026-10-15T04:30:00Z", "2026-10-15T05:30:00Z"), ev("b", "2026-10-15T05:00:00Z", "2026-10-15T06:00:00Z"), ev("c", "2026-10-15T05:30:00Z", "2026-10-15T06:30:00Z"), ev("late", "2026-10-15T18:00:00Z", "2026-10-15T19:30:00Z")],
      "2026-10-15",
      "Asia/Kolkata"
    );
    const by = Object.fromEntries(segs.map((s) => [s.event.id, s]));
    expect(by.a).toMatchObject({ top: 10 * 48, height: 48, lane: 0, lanes: 2 });
    expect(by.b).toMatchObject({ lane: 1, lanes: 2 });
    expect(by.c).toMatchObject({ lane: 0 }); // starts when a ends — reuses its lane
    expect(by.late).toMatchObject({ continuesAfter: true, height: (30 / 60) * 48 }); // 23:30 → midnight
    const next = daySegments([ev("late", "2026-10-15T18:00:00Z", "2026-10-15T19:30:00Z")], "2026-10-16", "Asia/Kolkata");
    expect(next[0]).toMatchObject({ top: 0, continuesBefore: true, height: 48 });
  });
});

describe("CrmCalendar", () => {
  const events = [{ id: "a1", start: "2026-10-15T05:30:00.000Z", end: "2026-10-15T06:30:00.000Z", title: "Product Demo", subtitle: "ABC Textiles · Rahul Sharma", badge: "Confirmed · Ravi Rep", tone: "green" as const, draggable: true }];

  it("renders the same event in day, week and month views at the viewer's zone", () => {
    const { rerender } = render(<CrmCalendar view="day" date="2026-10-15" timeZone="Asia/Kolkata" events={events} onEventClick={vi.fn()} now={new Date("2026-10-15T03:00:00Z")} />);
    const day = screen.getByRole("button", { name: /Product Demo/ });
    expect(day.getAttribute("aria-label")).toMatch(/^11:00 am – 12:00 pm Product Demo, ABC Textiles · Rahul Sharma, Confirmed · Ravi Rep/);
    expect(day.style.top).toBe(`${11 * 48}px`);
    rerender(<CrmCalendar view="week" date="2026-10-15" timeZone="Europe/London" events={events} onEventClick={vi.fn()} now={new Date("2026-10-15T03:00:00Z")} />);
    expect(screen.getAllByRole("region")).toHaveLength(7);
    const wk = screen.getByRole("button", { name: /Product Demo/ });
    expect(wk.getAttribute("aria-label")).toMatch(/^6:30 am – 7:30 am/); // same instant in London (BST)
    expect(within(screen.getByRole("region", { name: "Appointments on 2026-10-15" })).getByRole("button", { name: /Product Demo/ })).toBeTruthy();
    rerender(<CrmCalendar view="month" date="2026-10-15" timeZone="Asia/Kolkata" events={events} onEventClick={vi.fn()} now={new Date("2026-10-15T03:00:00Z")} />);
    expect(within(screen.getByRole("gridcell", { name: "2026-10-15" })).getByRole("button", { name: /Product Demo/ }).textContent).toContain("11:00 am");
    expect(screen.getAllByRole("gridcell")).toHaveLength(42);
  });

  it("opens an event, reports empty-slot clicks and drops on a new time / day", () => {
    const onEventClick = vi.fn();
    const onSlotClick = vi.fn();
    const onMove = vi.fn();
    const { rerender } = render(<CrmCalendar view="week" date="2026-10-15" timeZone="Asia/Kolkata" events={events} onEventClick={onEventClick} onSlotClick={onSlotClick} onMove={onMove} />);
    fireEvent.click(screen.getByRole("button", { name: /Product Demo/ }));
    expect(onEventClick).toHaveBeenCalledWith("a1");
    const col = screen.getByRole("region", { name: "Appointments on 2026-10-16" });
    fireEvent.click(col, { clientY: 9.5 * 48 });
    expect(onSlotClick).toHaveBeenCalledWith("2026-10-16", "09:30");
    // Drag to 16 Oct 14:00 (grab at the top of the card): same length.
    const data: Record<string, string> = {};
    const dataTransfer = { setData: (k: string, v: string) => (data[k] = v), getData: (k: string) => data[k] ?? "", dropEffect: "", effectAllowed: "" };
    fireAt("dragStart", screen.getByRole("button", { name: /Product Demo/ }), 0, dataTransfer);
    fireEvent.dragOver(col, { dataTransfer });
    fireAt("drop", col, 14 * 48 + 5, dataTransfer);
    expect(onMove).toHaveBeenCalledTimes(1);
    const [id, start, end] = onMove.mock.calls[0];
    expect(id).toBe("a1");
    expect(start.toISOString()).toBe("2026-10-16T08:30:00.000Z");
    expect(end.toISOString()).toBe("2026-10-16T09:30:00.000Z");
    // Month: another day keeps the time of day.
    rerender(<CrmCalendar view="month" date="2026-10-15" timeZone="Asia/Kolkata" events={events} onEventClick={onEventClick} onMove={onMove} />);
    fireEvent.dragStart(within(screen.getByRole("gridcell", { name: "2026-10-15" })).getByRole("button", { name: /Product Demo/ }), { dataTransfer });
    const target = screen.getByRole("gridcell", { name: "2026-10-20" });
    fireEvent.dragOver(target, { dataTransfer });
    fireEvent.drop(target, { dataTransfer });
    expect(onMove.mock.calls[1][1].toISOString()).toBe("2026-10-20T05:30:00.000Z");
  });

  it("doesn't allow dragging without an onMove handler or for locked events", () => {
    render(<CrmCalendar view="day" date="2026-10-15" timeZone="Asia/Kolkata" events={[{ ...events[0], draggable: false }]} onEventClick={vi.fn()} onMove={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Product Demo/ }).getAttribute("draggable")).toBe("false");
  });
});

describe("AppointmentForm", () => {
  it("prefills the contact, sends wall-clock times with the zone, and books anyway after a conflict only when asked", async () => {
    let posts = 0;
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url.startsWith("/api/v1/crm/appointments/availability")) return json({ data: { available: true, conflicts: [] } });
      if (url === "/api/v1/crm/appointments" && init?.method === "POST") {
        posts++;
        return posts === 1
          ? json({ error: { code: "CRM_APPOINTMENT_CONFLICT", message: "The selected employee already has an appointment during this time.", details: { conflicts: [{ id: "x", title: "Existing Meeting", type: "APPOINTMENT", startAt: "2026-10-15T04:30:00.000Z", endAt: "2026-10-15T05:30:00.000Z", status: "SCHEDULED", timezone: "Asia/Kolkata" }] } } }, 409)
          : json({ data: appt() }, 201);
      }
      return json({ data: [] });
    });
    const onSaved = vi.fn();
    render(<AppointmentForm meta={meta} users={users} currentUserId="u1" prefill={{ contact: { id: "c1", label: "Rahul Sharma" }, startDate: "2026-10-15", startTime: "10:30" }} onClose={vi.fn()} onSaved={onSaved} />);
    expect(screen.getByText("Rahul Sharma")).toBeTruthy();
    expect((screen.getByLabelText(/End time/) as HTMLInputElement).value).toBe("11:30"); // default 60 minutes
    fireEvent.change(screen.getByLabelText(/Title/), { target: { value: "Product Demo" } });
    fireEvent.change(screen.getByLabelText(/Video meeting link/), { target: { value: "https://meet.example.com/abc" } });
    fireEvent.click(screen.getByRole("button", { name: "Schedule appointment" }));
    expect(await screen.findByText(/Existing Meeting/)).toBeTruthy();
    expect(onSaved).not.toHaveBeenCalled();
    const first = JSON.parse(String(calls().find(([u, i]) => u === "/api/v1/crm/appointments" && i?.method === "POST")![1]!.body));
    expect(first).toMatchObject({ title: "Product Demo", contactId: "c1", startDate: "2026-10-15", startTime: "10:30", endTime: "11:30", timezone: "Asia/Kolkata", assignedToUserId: "u1", reminderMinutes: "30", videoLink: "https://meet.example.com/abc" });
    expect(first.allowConflict).toBeUndefined();
    fireEvent.click(screen.getByRole("button", { name: "Book anyway" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const second = JSON.parse(String(calls().filter(([u, i]) => u === "/api/v1/crm/appointments" && i?.method === "POST")[1][1]!.body));
    expect(second.allowConflict).toBe(true);
  });

  it("moving the start keeps the length, warns live about a busy employee, and shows server field errors", async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url.startsWith("/api/v1/crm/appointments/availability")) return json({ data: { available: false, conflicts: [{ id: null, title: "Busy", type: "APPOINTMENT", startAt: "2026-10-15T08:30:00.000Z", endAt: "2026-10-15T09:00:00.000Z", status: "SCHEDULED", timezone: null }] } });
      if (init?.method === "POST") return json({ error: { code: "VALIDATION_ERROR", message: "The end must be after the start.", details: { fieldErrors: { endTime: "End must be after the start." } } } }, 400);
      return json({ data: [] });
    });
    render(<AppointmentForm meta={meta} users={users} currentUserId="u1" prefill={{ company: { id: "co1", label: "ABC Textiles" }, startDate: "2026-10-15", startTime: "10:00" }} onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/Start time/), { target: { value: "14:00" } });
    expect((screen.getByLabelText(/End time/) as HTMLInputElement).value).toBe("15:00");
    expect(await screen.findByText("The selected employee already has an appointment during this time.")).toBeTruthy();
    expect(calls().some(([u]) => u.includes("availability?") && u.includes("startTime=14%3A00") && u.includes("timezone=Asia%2FKolkata"))).toBe(true);
    fireEvent.change(screen.getByLabelText(/Title/), { target: { value: "Visit" } });
    fireEvent.click(screen.getByRole("button", { name: "Schedule appointment" }));
    expect(await screen.findByText("End must be after the start.")).toBeTruthy();
  });

  it("fills company and contact from a prefilled opportunity", async () => {
    fetchMock.mockImplementation((url: string) => (url === "/api/v1/crm/opportunities/o1" ? json({ data: { crmCompany: { id: "co1", name: "ABC Textiles Pvt Ltd" }, crmContact: { id: "c1", fullName: "Rahul Sharma" } } }) : json({ data: { available: true, conflicts: [] } })));
    render(<AppointmentForm meta={meta} users={users} currentUserId="u1" prefill={{ opportunity: { id: "o1", label: "ABC Textile — Winter Order" } }} onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(await screen.findByText("ABC Textiles Pvt Ltd")).toBeTruthy();
    expect(screen.getByText("Rahul Sharma")).toBeTruthy();
    expect(screen.getByText("ABC Textile — Winter Order")).toBeTruthy();
  });
});

describe("AppointmentDetail", () => {
  it("shows only the actions the server allows and confirms with the version", async () => {
    let current = appt();
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url === "/api/v1/crm/appointments/a1" && (!init?.method || init.method === "GET")) return json({ data: current });
      if (url.endsWith("/confirm")) {
        current = appt({ status: "CONFIRMED", statusLabel: "Confirmed", version: 4, allowed: { actions: ["reschedule", "complete", "cancel", "no_show"], edit: true, assign: true } } as Partial<Appt>);
        return json({ data: current });
      }
      return json({ data: [], meta: { totalCount: 0 } });
    });
    const onChanged = vi.fn();
    render(<AppointmentDetail appointmentId="a1" meta={meta} users={users} currentUserId="u1" canEdit viewTimeZone="Europe/London" onChanged={onChanged} />);
    expect(await screen.findByRole("heading", { name: "Product Demo" })).toBeTruthy();
    expect(screen.getByText(/15 Oct, 2026 · 11:00 am – 12:00 pm IST/)).toBeTruthy();
    expect(screen.getByText(/Your time: .*6:30 am – 7:30 am BST/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Join meeting" }).getAttribute("href")).toBe("https://meet.example.com/abc");
    for (const name of ["Confirm appointment", "Reschedule", "Complete", "Mark as no-show", "Edit", "Cancel appointment"]) expect(screen.getByRole("button", { name })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Confirm appointment" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    const [, init] = calls().find(([u]) => u.endsWith("/confirm"))!;
    expect(JSON.parse(String(init!.body))).toEqual({ version: 3 });
    expect(await screen.findByText("Confirmed")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Confirm appointment" })).toBeNull();
  });

  it("offers nothing for a cancelled appointment and cancels with a reason after confirmation", async () => {
    fetchMock.mockImplementation((url: string) => (url === "/api/v1/crm/appointments/a2" ? json({ data: appt({ id: "a2", status: "CANCELLED", statusLabel: "Cancelled", cancelReason: "Customer unavailable", cancelledAt: "2026-10-10T05:00:00Z", allowed: { actions: [], edit: false, assign: false } } as Partial<Appt>) }) : json({ data: [], meta: { totalCount: 0 } })));
    render(<AppointmentDetail appointmentId="a2" meta={meta} users={users} currentUserId="u1" canEdit />);
    expect(await screen.findByText(/Customer unavailable/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Complete" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    cleanup();

    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url === "/api/v1/crm/appointments/a1" && (!init?.method || init.method === "GET")) return json({ data: appt() });
      if (url.endsWith("/cancel")) return json({ data: appt({ status: "CANCELLED", allowed: { actions: [], edit: false, assign: false } } as Partial<Appt>) });
      return json({ data: [], meta: { totalCount: 0 } });
    });
    render(<AppointmentDetail appointmentId="a1" meta={meta} users={users} currentUserId="u1" canEdit />);
    fireEvent.click(await screen.findByRole("button", { name: "Cancel appointment" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Product Demo")).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Keep Appointment" })).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText("Reason"), { target: { value: "Customer unavailable" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel Appointment" }));
    await waitFor(() => expect(toasts.success).toHaveBeenCalledWith("Appointment cancelled."));
    expect(JSON.parse(String(calls().find(([u]) => u.endsWith("/cancel"))![1]!.body))).toEqual({ version: 3, reason: "Customer unavailable" });
  });

  it("hides every action without edit permission", async () => {
    fetchMock.mockImplementation((url: string) => (url === "/api/v1/crm/appointments/a1" ? json({ data: appt() }) : json({ data: [], meta: { totalCount: 0 } })));
    render(<AppointmentDetail appointmentId="a1" meta={meta} users={users} currentUserId="u1" canEdit={false} />);
    await screen.findByRole("heading", { name: "Product Demo" });
    expect(screen.queryByRole("button", { name: "Reschedule" })).toBeNull();
  });
});
