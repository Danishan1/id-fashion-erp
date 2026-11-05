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
vi.mock("@/modules/sales-marketing/commissions/commission-plan.service", () => ({
  createPlan: m.svc,
  listPlans: m.svc,
  getPlan: m.svc,
  updatePlanHeader: m.svc,
  setPlanActive: m.svc,
  startNewVersion: m.svc,
  saveDraftVersion: m.svc,
  versionAction: m.svc,
  addAssignment: m.svc,
  endAssignment: m.svc,
  removeAssignment: m.svc,
}));
vi.mock("@/modules/sales-marketing/commissions/incentive-plan.service", () => ({ createIncentivePlan: m.svc, listIncentivePlans: m.svc, getIncentivePlan: m.svc, updateIncentivePlan: m.svc, incentivePlanAction: m.svc }));
vi.mock("@/modules/sales-marketing/commissions/commission-statement.service", () => ({ listStatements: m.svc, calculateStatements: m.svc, getStatement: m.svc, addAdjustment: m.svc, removeAdjustment: m.svc, statementAction: m.svc }));
vi.mock("@/modules/sales-marketing/channels/sales-channel.service", () => ({
  createChannel: m.svc,
  listChannels: m.svc,
  updateChannel: m.svc,
  setChannelActive: m.svc,
  listChannelOptions: vi.fn(async () => [{ id: "ch", code: "EX", name: "Export" }]),
  listAgentOptions: vi.fn(async () => [{ id: "ag", code: "A1", name: "Agent", commissionPercent: "2" }]),
  getDocumentChannel: m.svc,
  setDocumentChannel: m.svc,
}));

const plans = await import("./plans/route");
const versionAct = await import("./plans/[id]/versions/[versionId]/[action]/route");
const assignments = await import("./plans/[id]/assignments/route");
const calc = await import("./statements/calculate/route");
const stmtAct = await import("./statements/[id]/[action]/route");
const adj = await import("./statements/[id]/adjustments/route");
const statementsList = await import("./statements/route");
const incentiveAct = await import("./incentives/[id]/[action]/route");
const channels = await import("../channels/route");
const channelStatus = await import("../channels/[id]/status/route");
const options = await import("../channels/options/route");
const orderChannel = await import("../performance/orders/[id]/channel/route");
const quoteChannel = await import("../quotations/[id]/channel/route");

const ctx = <P,>(params: P) => ({ params: Promise.resolve(params) });
const req = (url = "/x", init?: RequestInit) => new NextRequest(new URL(url, "http://localhost"), init as never);
const actor = { companyId: "c1", userId: "u1", branchId: null };
const post = (body: unknown) => req("/x", { method: "POST", body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  m.requireSession.mockResolvedValue({ user: { id: "u1", companyId: "c1", defaultBranchId: null } });
  m.assert.mockResolvedValue(undefined);
  m.svc.mockResolvedValue({ id: "x" });
});

describe("Commission API routes", () => {
  it("plans: list needs view, create needs edit (201); version actions pass the action through to the service", async () => {
    await plans.GET(req("/x?status=all&payeeType=REP"), ctx({}));
    expect(m.assert).toHaveBeenLastCalledWith("u1", "sales_commissions", "view");
    expect(m.svc).toHaveBeenLastCalledWith(actor, { status: "all", payeeType: "REP" });
    expect((await plans.POST(post({ code: "P" }), ctx({}))).status).toBe(201);
    expect(m.assert).toHaveBeenLastCalledWith("u1", "sales_commissions", "edit");
    await versionAct.POST(post({ reason: "no" }), ctx({ id: "p1", versionId: "v1", action: "send-back" }));
    expect(m.svc).toHaveBeenLastCalledWith(actor, "p1", "v1", "send-back", { reason: "no" });
    await versionAct.POST(req("/x", { method: "POST" }), ctx({ id: "p1", versionId: "v1", action: "approve" }));
    expect(m.svc).toHaveBeenLastCalledWith(actor, "p1", "v1", "approve", {});
    expect((await assignments.POST(post({ userId: "u2" }), ctx({ id: "p1" }))).status).toBe(201);
  });

  it("statements: calculate and adjust need create; actions go to the service; errors map to statuses", async () => {
    await calc.POST(post({ month: "2026-10" }), ctx({}));
    expect(m.assert).toHaveBeenLastCalledWith("u1", "sales_commissions", "create");
    expect(m.svc).toHaveBeenLastCalledWith(actor, { month: "2026-10" });
    expect((await adj.POST(post({ amount: 10, reason: "abc" }), ctx({ id: "s1" }))).status).toBe(201);
    await statementsList.GET(req("/x?month=2026-10"), ctx({}));
    expect(m.svc).toHaveBeenLastCalledWith(actor, { month: "2026-10" });
    const { BusinessRuleError } = await import("@/core/errors/BusinessRuleError");
    m.svc.mockRejectedValueOnce(new BusinessRuleError("SELF_APPROVAL_NOT_ALLOWED", "no"));
    expect((await stmtAct.POST(post({}), ctx({ id: "s1", action: "approve" }))).status).toBe(403);
    m.svc.mockRejectedValueOnce(new BusinessRuleError("INVALID_STATE_TRANSITION", "no"));
    expect((await incentiveAct.POST(post({}), ctx({ id: "i1", action: "retire" }))).status).toBe(409);
  });

  it("channels: managed with sales_marketing_settings.edit; options carry no commission %; order channel needs sales_orders.view", async () => {
    expect((await channels.POST(post({ code: "EX", name: "Export" }), ctx({}))).status).toBe(201);
    expect(m.assert).toHaveBeenLastCalledWith("u1", "sales_marketing_settings", "edit");
    await channelStatus.PATCH(req("/x", { method: "PATCH", body: JSON.stringify({ isActive: false }) }), ctx({ id: "ch" }));
    expect(m.svc).toHaveBeenLastCalledWith(actor, "ch", false);
    expect((await channelStatus.PATCH(req("/x", { method: "PATCH", body: JSON.stringify({ isActive: "no" }) }), ctx({ id: "ch" }))).status).toBe(400);
    const opts = await (await options.GET(req(), ctx({}))).json();
    expect(opts.data.agents).toEqual([{ id: "ag", code: "A1", name: "Agent" }]);
    await orderChannel.GET(req(), ctx({ id: "o1" }));
    expect(m.assert).toHaveBeenCalledWith("u1", "sales_performance", "view");
    expect(m.assert).toHaveBeenLastCalledWith("u1", "sales_orders", "view");
    expect(m.svc).toHaveBeenLastCalledWith(actor, "SALES_ORDER", "o1");
    await quoteChannel.PATCH(req("/x", { method: "PATCH", body: JSON.stringify({ salesChannelId: "ch" }) }), ctx({ id: "q1" }));
    expect(m.svc).toHaveBeenLastCalledWith(actor, "QUOTATION", "q1", { salesChannelId: "ch" });
  });
});
