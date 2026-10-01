import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { requireSessionMock, assertMock, listMock, getMock, scopeMock, accessMock } = vi.hoisted(() => ({
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
vi.mock("@/modules/crm/crm-entity-access", () => ({ assertCrmEntityAccess: accessMock }));

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
      expect.objectContaining({ page: 2, skip: 20, take: 20, sortOrder: "desc" })
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

  it("returns 404 for a record timeline the caller cannot see", async () => {
    const { BusinessRuleError } = await import("@/core/errors/BusinessRuleError");
    accessMock.mockRejectedValueOnce(new BusinessRuleError("NOT_FOUND", "Lead not found."));
    const res = await listGET(new NextRequest(`http://x/api/v1/crm/events?entityType=LEAD&entityId=${ID}`), { params: Promise.resolve({}) });
    expect(res.status).toBe(404);
    expect(listMock).not.toHaveBeenCalled();
  });

  it("limits the company-wide feed to the caller's own actions without crm.view_all", async () => {
    scopeMock.mockResolvedValue({ mode: "OWN", userId: "user-1" });
    await listGET(new NextRequest("http://x/api/v1/crm/events"), { params: Promise.resolve({}) });
    expect(listMock).toHaveBeenCalledWith("co-1", expect.objectContaining({ actorUserId: "user-1" }), expect.anything());
  });

  it("hides another user's event on a record the caller cannot see", async () => {
    const { BusinessRuleError } = await import("@/core/errors/BusinessRuleError");
    scopeMock.mockResolvedValue({ mode: "OWN", userId: "user-1" });
    accessMock.mockRejectedValueOnce(new BusinessRuleError("NOT_FOUND", "Lead not found."));
    const res = await detailGET(new NextRequest("http://x/api/v1/crm/events/ev-1"), { params: Promise.resolve({ id: "ev-1" }) });
    expect(res.status).toBe(404);
  });
});
