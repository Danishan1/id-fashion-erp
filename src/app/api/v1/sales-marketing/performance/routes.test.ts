import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const m = vi.hoisted(() => ({ requireSession: vi.fn(), assert: vi.fn(), assertAny: vi.fn(), svc: vi.fn() }));

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
vi.mock("@/core/rbac/PermissionService", () => ({ PermissionService: { assert: m.assert, assertAny: m.assertAny } }));
vi.mock("@/modules/sales-marketing/performance/territory.service", () => ({
  createTerritory: m.svc,
  listTerritories: vi.fn(async () => ({ data: [], total: 0 })),
  listTerritoryOptions: m.svc,
  searchCustomersForTerritory: m.svc,
  getTerritory: m.svc,
  updateTerritory: m.svc,
  territoryAction: m.svc,
  addAssignment: m.svc,
  endAssignment: m.svc,
  removeAssignment: m.svc,
  assignCustomers: m.svc,
  removeCustomer: m.svc,
}));
vi.mock("@/modules/sales-marketing/performance/target.service", () => ({
  createTarget: m.svc,
  listTargets: vi.fn(async () => ({ data: [], truncated: false, calculatedAt: "x" })),
  getTarget: m.svc,
  archiveTarget: m.svc,
  startNewRevision: m.svc,
  saveDraftRevision: m.svc,
  revisionAction: m.svc,
}));
vi.mock("@/modules/sales-marketing/performance/performance-board.service", () => ({ getPerformanceBoard: m.svc, listCreditedDocuments: m.svc }));
vi.mock("@/modules/sales-marketing/performance/sales-credit.service", () => ({ getSalesCredit: m.svc, changeSalesCredit: m.svc }));
vi.mock("@/modules/sales-marketing/enquiries/sales-enquiry.service", () => ({ listEligibleOwners: m.svc }));

const territories = await import("./territories/route");
const territoryActions = await import("./territories/[id]/actions/[action]/route");
const assignments = await import("./territories/[id]/assignments/[assignmentId]/route");
const targets = await import("./targets/route");
const revisionActions = await import("./targets/[id]/revisions/[revisionId]/[action]/route");
const board = await import("./board/route");
const documents = await import("./documents/route");
const credit = await import("./orders/[id]/credit/route");
const ctx = <P,>(params: P) => ({ params: Promise.resolve(params) });
const req = (url = "/x", init?: RequestInit) => new NextRequest(new URL(url, "http://localhost"), init as never);
const actor = { companyId: "c1", userId: "u1", branchId: null };

beforeEach(() => {
  vi.clearAllMocks();
  m.requireSession.mockResolvedValue({ user: { id: "u1", companyId: "c1", defaultBranchId: null } });
  m.assert.mockResolvedValue(undefined);
  m.svc.mockResolvedValue({ id: "x" });
});

describe("Sales performance API routes", () => {
  it("territories: list needs view, create needs edit", async () => {
    expect((await territories.GET(req("/x?status=all"), ctx({}))).status).toBe(200);
    expect(m.assert).toHaveBeenLastCalledWith("u1", "sales_performance", "view");
    const res = await territories.POST(req("/x", { method: "POST", body: JSON.stringify({ code: "N", name: "North" }) }), ctx({}));
    expect(res.status).toBe(201);
    expect(m.assert).toHaveBeenLastCalledWith("u1", "sales_performance", "edit");
    expect(m.svc).toHaveBeenCalledWith(actor, { code: "N", name: "North" });
  });

  it("territory actions and assignment changes need edit and pass the ids through", async () => {
    await territoryActions.POST(req("/x", { method: "POST" }), ctx({ id: "t1", action: "deactivate" }));
    expect(m.svc).toHaveBeenLastCalledWith(actor, "t1", "deactivate");
    await assignments.PATCH(req("/x", { method: "PATCH", body: JSON.stringify({ endDate: "2026-11-30" }) }), ctx({ id: "t1", assignmentId: "a1" }));
    expect(m.svc).toHaveBeenLastCalledWith(actor, "t1", "a1", { endDate: "2026-11-30" });
    await assignments.DELETE(req("/x", { method: "DELETE" }), ctx({ id: "t1", assignmentId: "a1" }));
    expect(m.assert).toHaveBeenLastCalledWith("u1", "sales_performance", "edit");
  });

  it("targets: filters go to the service; create needs create", async () => {
    const res = await targets.GET(req("/x?periodType=MONTH&periodStart=2026-11-01&metric=BOOKED_ORDER_VALUE"), ctx({}));
    expect(res.status).toBe(200);
    expect((await res.json()).truncated).toBe(false);
    await targets.POST(req("/x", { method: "POST", body: JSON.stringify({ scope: "REP" }) }), ctx({}));
    expect(m.assert).toHaveBeenLastCalledWith("u1", "sales_performance", "create");
  });

  it("revision actions reach the service (which checks approve / reject / edit itself); a refused one maps to its status", async () => {
    await revisionActions.POST(req("/x", { method: "POST", body: JSON.stringify({ comment: "ok" }) }), ctx({ id: "t1", revisionId: "r1", action: "approve" }));
    expect(m.svc).toHaveBeenLastCalledWith(actor, "t1", "r1", "approve", { comment: "ok" });
    const { BusinessRuleError } = await import("@/core/errors/BusinessRuleError");
    m.svc.mockRejectedValueOnce(new BusinessRuleError("SELF_APPROVAL_NOT_ALLOWED", "Someone else must approve it."));
    const res = await revisionActions.POST(req("/x", { method: "POST" }), ctx({ id: "t1", revisionId: "r1", action: "approve" }));
    expect(res.status).toBe(403);
  });

  it("board and documents read the query string", async () => {
    await board.GET(req("/x?metric=INVOICED_VALUE&periodType=QUARTER&periodStart=2026-10-01"), ctx({}));
    expect(m.svc).toHaveBeenLastCalledWith(actor, { metric: "INVOICED_VALUE", periodType: "QUARTER", periodStart: "2026-10-01" });
    await documents.GET(req("/x?metric=BOOKED_ORDER_VALUE&repId=r9"), ctx({}));
    expect(m.svc).toHaveBeenLastCalledWith(actor, expect.objectContaining({ metric: "BOOKED_ORDER_VALUE", repId: "r9", territoryId: "" }));
  });

  it("order credit: reading needs sales_orders.view too; changing needs edit", async () => {
    await credit.GET(req(), ctx({ id: "o1" }));
    expect(m.assert).toHaveBeenCalledWith("u1", "sales_orders", "view");
    await credit.PATCH(req("/x", { method: "PATCH", body: JSON.stringify({ salesRepUserId: "u2", reason: "moved" }) }), ctx({ id: "o1" }));
    expect(m.assert).toHaveBeenLastCalledWith("u1", "sales_performance", "edit");
    m.assert.mockRejectedValueOnce(Object.assign(new (await import("@/core/errors/BusinessRuleError")).BusinessRuleError("PERMISSION_DENIED", "no"), {}));
    expect((await credit.PATCH(req("/x", { method: "PATCH", body: "{}" }), ctx({ id: "o1" }))).status).toBe(403);
  });
});
