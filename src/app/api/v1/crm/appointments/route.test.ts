import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const m = vi.hoisted(() => ({ requireSession: vi.fn(), assert: vi.fn(), svc: {} as Record<string, ReturnType<typeof vi.fn>>, deleteActivity: vi.fn() }));
const FNS = ["createAppointment", "listAppointments", "calendarAppointments", "checkAvailability", "getAppointmentMeta", "getAppointment", "updateAppointment", "confirmAppointment", "rescheduleAppointment", "cancelAppointment", "completeAppointment", "markNoShow", "assignAppointment"];
for (const k of FNS) m.svc[k] = vi.fn();

vi.mock("@/lib/api-route", async () => {
  const { toErrorResponse } = await import("@/core/errors/BusinessRuleError");
  return {
    requireSession: m.requireSession,
    handleApiError: (error: unknown) => {
      const { status, body } = toErrorResponse(error);
      return Response.json(body, { status });
    },
  };
});
vi.mock("@/core/rbac/PermissionService", () => ({ PermissionService: { assert: m.assert } }));
vi.mock("@/modules/crm/appointments/crm-appointments.service", () => m.svc);
vi.mock("@/modules/crm/activities/crm-activities.service", () => ({ deleteActivity: m.deleteActivity }));

const r = {
  list: await import("./route"),
  calendar: await import("./calendar/route"),
  availability: await import("./availability/route"),
  meta: await import("./meta/route"),
  one: await import("./[id]/route"),
  confirm: await import("./[id]/confirm/route"),
  reschedule: await import("./[id]/reschedule/route"),
  cancel: await import("./[id]/cancel/route"),
  complete: await import("./[id]/complete/route"),
  noShow: await import("./[id]/no-show/route"),
  assign: await import("./[id]/assign/route"),
};
const ID = "6f1c2f1e-1f2a-4b1a-9d1a-2b3c4d5e6f70";
const U = "7f1c2f1e-1f2a-4b1a-9d1a-2b3c4d5e6f71";
const ACTOR = { companyId: "co-1", userId: "user-1", branchId: null };
const ctx = <P,>(params: P) => ({ params: Promise.resolve(params) });
const post = (b: unknown) => new NextRequest("http://x", { method: "POST", body: JSON.stringify(b) });
const lastPerm = () => m.assert.mock.calls.at(-1)!.slice(1);

beforeEach(() => {
  m.requireSession.mockReset().mockResolvedValue({ user: { id: "user-1", companyId: "co-1", defaultBranchId: null } });
  m.assert.mockReset().mockResolvedValue(undefined);
  for (const fn of [...Object.values(m.svc), m.deleteActivity]) fn.mockReset().mockResolvedValue({ ok: true });
  m.svc.listAppointments.mockResolvedValue({ data: [], totalCount: 0 });
  m.svc.calendarAppointments.mockResolvedValue({ data: [], truncated: false });
});

describe("CRM appointment routes", () => {
  it("list / calendar / availability / meta need crm.view and pass filters through", async () => {
    await r.list.GET(new NextRequest(`http://x/api/v1/crm/appointments?contactId=${ID}&statuses=SCHEDULED,CONFIRMED&when=upcoming&sortBy=startAt&search=demo`), ctx({}));
    expect(lastPerm()).toEqual(["crm", "view"]);
    const [actor, filter, sort, page] = m.svc.listAppointments.mock.calls[0];
    expect(actor).toEqual(ACTOR);
    expect(filter).toMatchObject({ contactId: ID, statuses: ["SCHEDULED", "CONFIRMED"], when: "upcoming" });
    expect(sort).toEqual({ sortBy: "startAt", sortOrder: "asc" });
    expect(page).toMatchObject({ search: "demo" });

    await r.calendar.GET(new NextRequest(`http://x/api/v1/crm/appointments/calendar?from=2026-10-01T00:00:00%2B05:30&to=2026-11-01T00:00:00%2B05:30&assignedToUserIds=${U}&search=x`), ctx({}));
    expect(m.svc.calendarAppointments).toHaveBeenCalledWith(ACTOR, expect.objectContaining({ from: "2026-10-01T00:00:00+05:30", assignedToUserIds: [U] }), "x");
    expect(lastPerm()).toEqual(["crm", "view"]);

    await r.availability.GET(new NextRequest(`http://x/api/v1/crm/appointments/availability?assignedToUserId=${U}&startAt=a&endAt=b`), ctx({}));
    expect(m.svc.checkAvailability).toHaveBeenCalledWith(ACTOR, { assignedToUserId: U, startAt: "a", endAt: "b" });
    await r.meta.GET(new NextRequest("http://x"), ctx({}));
    expect(m.svc.getAppointmentMeta).toHaveBeenCalledWith(ACTOR);
  });

  it("rejects a calendar window over 62 days and bad filters with 400", async () => {
    const res = await r.calendar.GET(new NextRequest("http://x/api/v1/crm/appointments/calendar?from=2026-01-01T00:00:00Z&to=2026-06-01T00:00:00Z"), ctx({}));
    expect(res.status).toBe(400);
    expect((await r.list.GET(new NextRequest("http://x/api/v1/crm/appointments?statuses=DONE"), ctx({}))).status).toBe(400);
  });

  it("create needs crm.create; edits and every lifecycle action need crm.edit", async () => {
    const created = await r.list.POST(post({ title: "Demo" }), ctx({}));
    expect(created.status).toBe(201);
    expect(lastPerm()).toEqual(["crm", "create"]);
    const cases: [() => Promise<Response>, string, unknown[]][] = [
      [() => r.one.PATCH(new NextRequest("http://x", { method: "PATCH", body: JSON.stringify({ version: 1 }) }), ctx({ id: ID })), "updateAppointment", [ACTOR, ID, { version: 1 }]],
      [() => r.one.PUT(new NextRequest("http://x", { method: "PUT", body: JSON.stringify({ version: 2 }) }), ctx({ id: ID })), "updateAppointment", [ACTOR, ID, { version: 2 }]],
      [() => r.confirm.POST(post({ version: 1 }), ctx({ id: ID })), "confirmAppointment", [ACTOR, ID, { version: 1 }]],
      [() => r.reschedule.POST(post({ startDate: "2026-10-17" }), ctx({ id: ID })), "rescheduleAppointment", [ACTOR, ID, { startDate: "2026-10-17" }]],
      [() => r.cancel.POST(post({ reason: "Other" }), ctx({ id: ID })), "cancelAppointment", [ACTOR, ID, { reason: "Other" }]],
      [() => r.complete.POST(post({ outcome: "Positive" }), ctx({ id: ID })), "completeAppointment", [ACTOR, ID, { outcome: "Positive" }]],
      [() => r.noShow.POST(post({}), ctx({ id: ID })), "markNoShow", [ACTOR, ID, {}]],
      [() => r.assign.POST(post({ assignedToUserId: U }), ctx({ id: ID })), "assignAppointment", [ACTOR, ID, { assignedToUserId: U }]],
    ];
    for (const [call, fn, args] of cases) {
      m.assert.mockClear();
      expect((await call()).status).toBe(200);
      expect(m.svc[fn]).toHaveBeenLastCalledWith(...args);
      expect(lastPerm()).toEqual(["crm", "edit"]);
    }
    await r.one.DELETE(new NextRequest("http://x", { method: "DELETE" }), ctx({ id: ID }));
    expect(m.svc.getAppointment).toHaveBeenCalledWith(ACTOR, ID); // must be an appointment the caller can see
    expect(m.deleteActivity).toHaveBeenCalledWith(ACTOR, ID);
  });

  it("maps a busy employee to 409 with the conflicts, and refuses without permission", async () => {
    const { BusinessRuleError } = await import("@/core/errors/BusinessRuleError");
    m.svc.createAppointment.mockRejectedValue(new BusinessRuleError("CRM_APPOINTMENT_CONFLICT", "The selected employee already has an appointment during this time.", { conflicts: [{ id: ID }] }));
    const res = await r.list.POST(post({}), ctx({}));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: "CRM_APPOINTMENT_CONFLICT", details: { conflicts: [{ id: ID }] } } });
    m.assert.mockRejectedValue(new BusinessRuleError("PERMISSION_DENIED", "No"));
    expect((await r.cancel.POST(post({}), ctx({ id: ID }))).status).toBe(403);
    expect(m.svc.cancelAppointment).not.toHaveBeenCalled();
  });
});
