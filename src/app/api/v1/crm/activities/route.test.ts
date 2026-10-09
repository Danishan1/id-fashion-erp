import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const m = vi.hoisted(() => ({
  requireSession: vi.fn(),
  assert: vi.fn(),
  svc: {} as Record<string, ReturnType<typeof vi.fn>>,
  listCrmEvents: vi.fn(),
}));
for (const k of ["listActivities", "createActivity", "getActivity", "updateActivity", "deleteActivity", "completeActivity", "reopenActivity", "cancelActivity", "rescheduleActivity", "assignActivity", "bulkActivityAction", "getActivityMeta", "myTaskCounts", "loadActivity"]) m.svc[k] = vi.fn();

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
vi.mock("@/modules/crm/activities/crm-activities.service", () => m.svc);
vi.mock("@/modules/crm/core/crm-events.service", () => ({ listCrmEvents: m.listCrmEvents }));

const r = {
  list: await import("./route"),
  meta: await import("./meta/route"),
  counts: await import("./my-counts/route"),
  bulk: await import("./bulk/route"),
  one: await import("./[id]/route"),
  history: await import("./[id]/history/route"),
  complete: await import("./[id]/complete/route"),
  reopen: await import("./[id]/reopen/route"),
  cancel: await import("./[id]/cancel/route"),
  reschedule: await import("./[id]/reschedule/route"),
  assign: await import("./[id]/assign/route"),
};

const ID = "6f1c2f1e-1f2a-4b1a-9d1a-2b3c4d5e6f70";
const U = "7f1c2f1e-1f2a-4b1a-9d1a-2b3c4d5e6f71";
const ACTOR = { companyId: "co-1", userId: "user-1", branchId: null };
const ctx = <P,>(params: P) => ({ params: Promise.resolve(params) });
const req = (method: string, body?: unknown, url = "http://x") => new NextRequest(url, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const lastPerm = () => m.assert.mock.calls.at(-1)!.slice(1);

beforeEach(() => {
  m.requireSession.mockReset().mockResolvedValue({ user: { id: "user-1", companyId: "co-1", defaultBranchId: null } });
  m.assert.mockReset().mockResolvedValue(undefined);
  for (const fn of Object.values(m.svc)) fn.mockReset().mockResolvedValue({ id: ID });
  m.svc.listActivities.mockResolvedValue({ data: [{ id: ID }], totalCount: 1 });
  m.listCrmEvents.mockReset().mockResolvedValue({ data: [], totalCount: 0 });
});

describe("CRM activity routes", () => {
  it("GET /activities needs crm.view and passes filters, sort and paging (related-record query included)", async () => {
    const res = await r.list.GET(req("GET", undefined, `http://x/api/v1/crm/activities?entityType=OPPORTUNITY&entityId=${ID}&due=overdue&types=TASK,CALL&sortBy=dueAt&sortOrder=desc&page=2&pageSize=10`), ctx({}));
    expect(lastPerm()).toEqual(["crm", "view"]);
    expect(m.svc.listActivities).toHaveBeenCalledWith(ACTOR, expect.objectContaining({ entityType: "OPPORTUNITY", entityId: ID, due: "overdue", types: ["TASK", "CALL"] }), { sortBy: "dueAt", sortOrder: "desc" }, expect.objectContaining({ skip: 10, take: 10 }));
    expect((await res.json()).meta).toMatchObject({ page: 2, totalCount: 1 });
  });

  it("rejects invalid filters and sort fields with 400", async () => {
    expect((await r.list.GET(req("GET", undefined, "http://x/api/v1/crm/activities?due=someday"), ctx({}))).status).toBe(400);
    expect((await r.list.GET(req("GET", undefined, "http://x/api/v1/crm/activities?sortBy=password"), ctx({}))).status).toBe(400);
    expect((await r.list.GET(req("GET", undefined, `http://x/api/v1/crm/activities?entityId=${ID}`), ctx({}))).status).toBe(400);
    expect(m.svc.listActivities).not.toHaveBeenCalled();
  });

  it("POST /activities needs crm.create and returns 201", async () => {
    const res = await r.list.POST(req("POST", { type: "TASK" }), ctx({}));
    expect(res.status).toBe(201);
    expect(lastPerm()).toEqual(["crm", "create"]);
    expect(m.svc.createActivity).toHaveBeenCalledWith(ACTOR, { type: "TASK" });
  });

  it("detail and history need crm.view; edits and actions need crm.edit", async () => {
    await r.one.GET(req("GET"), ctx({ id: ID }));
    expect(lastPerm()).toEqual(["crm", "view"]);
    await r.history.GET(req("GET"), ctx({ id: ID }));
    expect(m.svc.loadActivity).toHaveBeenCalledWith(ACTOR, ID);
    expect(m.listCrmEvents).toHaveBeenCalledWith("co-1", { entityType: "ACTIVITY", entityId: ID }, expect.anything());
    const cases: [() => Promise<Response>, string, unknown[]][] = [
      [() => r.one.PATCH(req("PATCH", { version: 1 }), ctx({ id: ID })), "updateActivity", [ACTOR, ID, { version: 1 }]],
      [() => r.one.PUT(req("PUT", { version: 2 }), ctx({ id: ID })), "updateActivity", [ACTOR, ID, { version: 2 }]],
      [() => r.complete.POST(req("POST", { outcome: "Done" }), ctx({ id: ID })), "completeActivity", [ACTOR, ID, { outcome: "Done" }]],
      [() => r.complete.POST(req("POST"), ctx({ id: ID })), "completeActivity", [ACTOR, ID, {}]],
      [() => r.reopen.POST(req("POST", {}), ctx({ id: ID })), "reopenActivity", [ACTOR, ID, {}]],
      [() => r.cancel.POST(req("POST", { reason: "x" }), ctx({ id: ID })), "cancelActivity", [ACTOR, ID, { reason: "x" }]],
      [() => r.reschedule.POST(req("POST", { dueDate: "2026-10-12" }), ctx({ id: ID })), "rescheduleActivity", [ACTOR, ID, { dueDate: "2026-10-12" }]],
      [() => r.assign.POST(req("POST", { assignedToUserId: U }), ctx({ id: ID })), "assignActivity", [ACTOR, ID, { assignedToUserId: U }]],
      [() => r.bulk.POST(req("POST", { action: "complete", ids: [ID] }), ctx({})), "bulkActivityAction", [ACTOR, { action: "complete", ids: [ID] }]],
    ];
    for (const [call, fn, args] of cases) {
      await call();
      expect(m.svc[fn]).toHaveBeenLastCalledWith(...args);
      expect(lastPerm()).toEqual(["crm", "edit"]);
    }
    const del = await r.one.DELETE(req("DELETE"), ctx({ id: ID }));
    expect(await del.json()).toEqual({ data: { id: ID, deleted: true } });
    expect(lastPerm()).toEqual(["crm", "edit"]);
  });

  it("meta and My Tasks counts need crm.view", async () => {
    await r.meta.GET(req("GET"), ctx({}));
    expect(lastPerm()).toEqual(["crm", "view"]);
    await r.counts.GET(req("GET"), ctx({}));
    expect(m.svc.myTaskCounts).toHaveBeenCalledWith(ACTOR);
  });

  it("maps service errors: 404 not visible, 409 stale version, 422 state, 403 permission", async () => {
    const { BusinessRuleError } = await import("@/core/errors/BusinessRuleError");
    m.svc.getActivity.mockRejectedValueOnce(new BusinessRuleError("NOT_FOUND", "Activity not found."));
    expect((await r.one.GET(req("GET"), ctx({ id: ID }))).status).toBe(404);
    m.svc.rescheduleActivity.mockRejectedValueOnce(new BusinessRuleError("RECORD_VERSION_CONFLICT", "stale"));
    expect((await r.reschedule.POST(req("POST", {}), ctx({ id: ID }))).status).toBe(409);
    m.svc.deleteActivity.mockRejectedValueOnce(new BusinessRuleError("PERMISSION_DENIED", "Only the creator"));
    expect((await r.one.DELETE(req("DELETE"), ctx({ id: ID }))).status).toBe(403);
    m.assert.mockRejectedValueOnce(new BusinessRuleError("PERMISSION_DENIED", "No CRM access"));
    expect((await r.list.POST(req("POST", {}), ctx({}))).status).toBe(403);
    expect(m.svc.createActivity).not.toHaveBeenCalled();
  });
});
