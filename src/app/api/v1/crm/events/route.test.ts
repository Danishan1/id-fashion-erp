import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { requireSessionMock, assertMock, listMock, getMock, scopeMock, accessMock, mergedMock, companyScopeMock, activityIdsMock } = vi.hoisted(() => ({
  activityIdsMock: vi.fn(),
  mergedMock: vi.fn(),
  companyScopeMock: vi.fn(),
  requireSessionMock: vi.fn(),
  assertMock: vi.fn(),
  listMock: vi.fn(),
  getMock: vi.fn(),
  scopeMock: vi.fn(),
  accessMock: vi.fn(),
}));

vi.mock("@/lib/api-route", async () => {
  const { toErrorResponse } = await import("@/core/errors/BusinessRuleError");
  return {
    requireSession: requireSessionMock,
    handleApiError: (error: unknown) => {
      const { status, body } = toErrorResponse(error);
      return Response.json(body, { status });
    },
  };
});
vi.mock("@/core/rbac/PermissionService", () => ({ PermissionService: { assert: assertMock } }));
vi.mock("@/modules/crm/core/crm-events.service", () => ({ listCrmEvents: listMock, getCrmEventById: getMock }));
vi.mock("@/modules/crm/core/crm-visibility", () => ({ getCrmRecordScope: scopeMock }));
vi.mock("@/modules/crm/crm-entity-access", () => ({ assertCrmEntityAccess: accessMock, mergedContactIds: mergedMock, companyTimelineScope: companyScopeMock }));
vi.mock("@/modules/crm/activities/crm-activity.repository", () => ({ CrmActivityRepository: { linkedActivityIds: activityIdsMock } }));

const { GET: listGET } = await import("./route");
const { GET: detailGET } = await import("./[id]/route");

const ID = "6f1c2f1e-1f2a-4b1a-9d1a-2b3c4d5e6f70";

beforeEach(() => {
  requireSessionMock.mockReset().mockResolvedValue({ user: { id: "user-1", companyId: "co-1", defaultBranchId: null } });
  assertMock.mockReset().mockResolvedValue(undefined);
  listMock.mockReset().mockResolvedValue({ data: [{ id: "ev-1" }], totalCount: 41 });
  getMock.mockReset().mockResolvedValue({ id: "ev-1", entityType: "LEAD", entityId: ID, actor: { id: "someone-else" } });
  scopeMock.mockReset().mockResolvedValue({ mode: "ALL" });
  accessMock.mockReset().mockResolvedValue(undefined);
  mergedMock.mockReset().mockResolvedValue([]);
  companyScopeMock.mockReset().mockResolvedValue({ companyIds: [], contactIds: [], leadIds: [] });
  activityIdsMock.mockReset().mockResolvedValue([]);
});

describe("GET /api/v1/crm/events", () => {
  it("requires crm.view and passes company, filters and paging to the service", async () => {
    const res = await listGET(new NextRequest(`http://x/api/v1/crm/events?page=2&pageSize=20&eventType=lead.created&entityType=LEAD&entityId=${ID}&from=2026-10-01`), {
      params: Promise.resolve({}),
    });

    expect(assertMock).toHaveBeenCalledWith("user-1", "crm", "view");
    expect(listMock).toHaveBeenCalledWith(
      "co-1",
      expect.objectContaining({ eventType: "lead.created", entityType: "LEAD", entityId: ID, from: "2026-10-01" }),
      expect.objectContaining({ page: 2, skip: 20, take: 20, sortOrder: "desc" }),
      [],
      []
    );
    expect(await res.json()).toEqual({ data: [{ id: "ev-1" }], meta: { page: 2, pageSize: 20, totalCount: 41, totalPages: 3 } });
  });

  it("returns 400 for an invalid filter instead of querying", async () => {
    const res = await listGET(new NextRequest("http://x/api/v1/crm/events?from=yesterday"), { params: Promise.resolve({}) });
    expect(res.status).toBe(400);
    expect(listMock).not.toHaveBeenCalled();
  });
});

describe("GET /api/v1/crm/events/:id", () => {
  it("looks the event up within the caller's company", async () => {
    const res = await detailGET(new NextRequest("http://x/api/v1/crm/events/ev-1"), { params: Promise.resolve({ id: "ev-1" }) });
    expect(getMock).toHaveBeenCalledWith("co-1", "ev-1");
    expect(await res.json()).toEqual({ data: expect.objectContaining({ id: "ev-1" }) });
  });
});

describe("CRM event visibility", () => {
  it("checks access to the record when a record timeline is requested", async () => {
    await listGET(new NextRequest(`http://x/api/v1/crm/events?entityType=LEAD&entityId=${ID}`), { params: Promise.resolve({}) });
    expect(accessMock).toHaveBeenCalledWith(expect.objectContaining({ userId: "user-1", companyId: "co-1" }), "LEAD", ID);
  });

  it("includes contacts merged into a contact in its timeline", async () => {
    const MERGED = "7f1c2f1e-1f2a-4b1a-9d1a-2b3c4d5e6f71";
    mergedMock.mockResolvedValue([MERGED]);
    await listGET(new NextRequest(`http://x/api/v1/crm/events?entityType=CONTACT&entityId=${ID}`), { params: Promise.resolve({}) });
    expect(mergedMock).toHaveBeenCalledWith("co-1", ID);
    expect(listMock).toHaveBeenCalledWith("co-1", expect.objectContaining({ entityType: "CONTACT", entityId: ID }), expect.anything(), [MERGED], []);
  });

  it("returns 404 for a record timeline the caller cannot see", async () => {
    const { BusinessRuleError } = await import("@/core/errors/BusinessRuleError");
    accessMock.mockRejectedValueOnce(new BusinessRuleError("NOT_FOUND", "Lead not found."));
    const res = await listGET(new NextRequest(`http://x/api/v1/crm/events?entityType=LEAD&entityId=${ID}`), { params: Promise.resolve({}) });
    expect(res.status).toBe(404);
    expect(listMock).not.toHaveBeenCalled();
  });

  it("includes merged companies and, on request, the company's visible contacts and leads", async () => {
    const MERGED = "7f1c2f1e-1f2a-4b1a-9d1a-2b3c4d5e6f72";
    const CONTACT = "7f1c2f1e-1f2a-4b1a-9d1a-2b3c4d5e6f73";
    const LEAD = "7f1c2f1e-1f2a-4b1a-9d1a-2b3c4d5e6f74";
    companyScopeMock.mockResolvedValue({ companyIds: [MERGED], contactIds: [CONTACT], leadIds: [LEAD] });
    await listGET(new NextRequest(`http://x/api/v1/crm/events?entityType=COMPANY&entityId=${ID}&includeRelated=true`), { params: Promise.resolve({}) });
    expect(accessMock).toHaveBeenCalledWith(expect.anything(), "COMPANY", ID);
    expect(companyScopeMock).toHaveBeenCalledWith(expect.objectContaining({ companyId: "co-1" }), ID, true);
    expect(listMock).toHaveBeenCalledWith("co-1", expect.objectContaining({ entityType: "COMPANY", entityId: ID }), expect.anything(), [MERGED], [
      { entityType: "CONTACT", ids: [CONTACT] },
      { entityType: "LEAD", ids: [LEAD] },
    ]);
  });

  it("adds the events of activities linked to the record (Phase 09)", async () => {
    const ACT = "7f1c2f1e-1f2a-4b1a-9d1a-2b3c4d5e6f75";
    activityIdsMock.mockResolvedValue([ACT]);
    await listGET(new NextRequest(`http://x/api/v1/crm/events?entityType=OPPORTUNITY&entityId=${ID}`), { params: Promise.resolve({}) });
    expect(activityIdsMock).toHaveBeenCalledWith("co-1", "OPPORTUNITY", [ID]);
    expect(listMock).toHaveBeenCalledWith("co-1", expect.objectContaining({ entityType: "OPPORTUNITY", entityId: ID }), expect.anything(), [], [{ entityType: "ACTIVITY", ids: [ACT] }]);
  });

  it("an activity's own history is checked like any record and gets no extra scope", async () => {
    await listGET(new NextRequest(`http://x/api/v1/crm/events?entityType=ACTIVITY&entityId=${ID}`), { params: Promise.resolve({}) });
    expect(accessMock).toHaveBeenCalledWith(expect.anything(), "ACTIVITY", ID);
    expect(activityIdsMock).not.toHaveBeenCalled();
  });

  it("limits the company-wide feed to the caller's own actions without crm.view_all", async () => {
    scopeMock.mockResolvedValue({ mode: "OWN", userId: "user-1" });
    await listGET(new NextRequest("http://x/api/v1/crm/events"), { params: Promise.resolve({}) });
    expect(listMock).toHaveBeenCalledWith("co-1", expect.objectContaining({ actorUserId: "user-1" }), expect.anything(), [], []);
  });

  it("hides another user's event on a record the caller cannot see", async () => {
    const { BusinessRuleError } = await import("@/core/errors/BusinessRuleError");
    scopeMock.mockResolvedValue({ mode: "OWN", userId: "user-1" });
    accessMock.mockRejectedValueOnce(new BusinessRuleError("NOT_FOUND", "Lead not found."));
    const res = await detailGET(new NextRequest("http://x/api/v1/crm/events/ev-1"), { params: Promise.resolve({ id: "ev-1" }) });
    expect(res.status).toBe(404);
  });
});
