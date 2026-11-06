import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const m = vi.hoisted(() => ({
  requireSession: vi.fn(),
  assert: vi.fn(),
  list: vi.fn(),
  create: vi.fn(),
  stage: vi.fn(),
  assign: vi.fn(),
}));

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
vi.mock("@/modules/sales-marketing/enquiries/sales-enquiry.service", () => ({
  listSalesEnquiries: m.list,
  createSalesEnquiry: m.create,
  changeSalesEnquiryStage: m.stage,
  assignSalesEnquiry: m.assign,
}));

const list = await import("./route");
const stage = await import("./[id]/stage/route");
const ctx = <P,>(params: P) => ({ params: Promise.resolve(params) });
const req = (url: string, init?: RequestInit) => new NextRequest(new URL(url, "http://localhost"), init as never);

beforeEach(() => {
  vi.clearAllMocks();
  m.requireSession.mockResolvedValue({ user: { id: "u1", companyId: "c1", defaultBranchId: "b1" } });
  m.assert.mockResolvedValue(undefined);
  m.list.mockResolvedValue({ data: [{ id: "e1" }], totalCount: 1 });
  m.create.mockResolvedValue({ id: "e2" });
  m.stage.mockResolvedValue({ id: "e1", salesStage: "QUALIFIED" });
});

describe("Sales enquiry API routes", () => {
  it("GET needs sales_marketing.view and passes filters, sort and paging", async () => {
    const res = await list.GET(req("/api/v1/sales-marketing/enquiries?view=closed&stage=LOST&owner=me&overdue=1&page=2&pageSize=10&search=knit&sortBy=priority&sortOrder=asc&junk=1"), ctx({}));
    expect(res.status).toBe(200);
    expect(m.assert).toHaveBeenCalledWith("u1", "sales_marketing", "view");
    const [actor, filter, sort, page] = m.list.mock.calls[0];
    expect(actor).toEqual({ companyId: "c1", userId: "u1", branchId: "b1" });
    expect(filter).toEqual({ view: "closed", stage: "LOST", owner: "me", overdue: "1" });
    expect(sort).toEqual({ sortBy: "priority", sortOrder: "asc" });
    expect(page).toEqual({ skip: 10, take: 10, search: "knit" });
    expect((await res.json()).meta).toMatchObject({ page: 2, pageSize: 10, totalCount: 1 });
  });

  it("rejects an unknown sort field", async () => {
    const res = await list.GET(req("/api/v1/sales-marketing/enquiries?sortBy=passwordHash"), ctx({}));
    expect(res.status).toBe(400);
    expect(m.list).not.toHaveBeenCalled();
  });

  it("POST needs sales_marketing.create", async () => {
    const res = await list.POST(req("/api/v1/sales-marketing/enquiries", { method: "POST", body: JSON.stringify({ a: 1 }) }), ctx({}));
    expect(res.status).toBe(201);
    expect(m.assert).toHaveBeenCalledWith("u1", "sales_marketing", "create");
  });

  it("stage change needs sales_marketing.edit; denied users never reach the service", async () => {
    const { BusinessRuleError } = await import("@/core/errors/BusinessRuleError");
    m.assert.mockRejectedValue(new BusinessRuleError("PERMISSION_DENIED", "No access."));
    const res = await stage.POST(req("/x", { method: "POST", body: JSON.stringify({ stage: "QUALIFIED" }) }), ctx({ id: "e1" }));
    expect(res.status).toBe(403);
    expect(m.assert).toHaveBeenCalledWith("u1", "sales_marketing", "edit");
    expect(m.stage).not.toHaveBeenCalled();
  });

  it("maps service state errors to 409", async () => {
    const { BusinessRuleError } = await import("@/core/errors/BusinessRuleError");
    m.stage.mockRejectedValue(new BusinessRuleError("INVALID_STATE_TRANSITION", "Nope."));
    const res = await stage.POST(req("/x", { method: "POST", body: JSON.stringify({ stage: "QUALIFIED" }) }), ctx({ id: "e1" }));
    expect(res.status).toBe(409);
    expect(m.stage).toHaveBeenCalledWith({ companyId: "c1", userId: "u1", branchId: "b1" }, "e1", { stage: "QUALIFIED" });
  });
});
