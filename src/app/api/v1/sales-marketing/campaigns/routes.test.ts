import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const m = vi.hoisted(() => ({ requireSession: vi.fn(), assert: vi.fn(), assertAny: vi.fn(), svc: vi.fn(), get: vi.fn() }));

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
vi.mock("@/modules/sales-marketing/campaigns/campaign.service", () => ({ createCampaign: m.svc, listCampaigns: m.svc, updateCampaign: m.svc, deleteCampaign: m.svc, campaignAction: m.svc, requestPlanChange: m.svc, revisionAction: m.svc, listLinkableCampaigns: m.svc }));
vi.mock("@/modules/sales-marketing/campaigns/campaign-results.service", () => ({
  getCampaign: m.get,
  campaignOverview: m.svc,
  campaignCalendar: m.svc,
  addMetric: m.svc,
  updateMetric: m.svc,
  removeMetric: m.svc,
  recordManualResult: m.svc,
  linkExpense: m.svc,
  unlinkExpense: m.svc,
  searchLinkableExpenses: m.svc,
  addMilestone: m.svc,
}));
vi.mock("@/modules/sales-marketing/campaigns/campaign-lookup.service", () => ({ listCampaignLookups: m.svc, createCampaignLookup: m.svc, updateCampaignLookup: m.svc }));
vi.mock("@/modules/sales-marketing/campaigns/campaign-link.service", () => ({ getCampaignLink: m.svc, setCampaignLink: m.svc }));

const list = await import("./route");
const detail = await import("./[id]/route");
const action = await import("./[id]/[action]/route");
const lookups = await import("./lookups/route");
const links = await import("../campaign-links/[docType]/[id]/route");
const calendar = await import("./calendar/route");

const ctx = <P,>(params: P) => ({ params: Promise.resolve(params) });
const req = (url = "/x", init?: RequestInit) => new NextRequest(new URL(url, "http://localhost"), init as never);
const actor = { companyId: "c1", userId: "u1", branchId: null };

beforeEach(() => {
  vi.clearAllMocks();
  m.requireSession.mockResolvedValue({ user: { id: "u1", companyId: "c1", defaultBranchId: null } });
  m.assert.mockResolvedValue(undefined);
  m.svc.mockResolvedValue({ id: "x", replayed: false, data: [], total: 0 });
  m.get.mockResolvedValue({ id: "x", code: "C" });
});

describe("Campaign API routes", () => {
  it("list needs view and paginates; create needs create — a replayed idempotency key answers 200, a new one 201", async () => {
    const res = await list.GET(req("/x?status=ACTIVE&page=1&pageSize=10"), ctx({}));
    expect(m.assert).toHaveBeenLastCalledWith("u1", "marketing_campaigns", "view");
    expect((await res.json()).meta).toMatchObject({ page: 1, pageSize: 10 });
    expect((await list.POST(req("/x", { method: "POST", body: "{}" }), ctx({}))).status).toBe(201);
    expect(m.assert).toHaveBeenLastCalledWith("u1", "marketing_campaigns", "create");
    m.svc.mockResolvedValueOnce({ id: "x", replayed: true });
    expect((await list.POST(req("/x", { method: "POST", body: "{}" }), ctx({}))).status).toBe(200);
  });

  it("edit / lifecycle return the fresh detail; service errors map to status codes", async () => {
    await detail.PATCH(req("/x", { method: "PATCH", body: JSON.stringify({ version: 2 }) }), ctx({ id: "k" }));
    expect(m.assert).toHaveBeenLastCalledWith("u1", "marketing_campaigns", "edit");
    expect(m.svc).toHaveBeenLastCalledWith(actor, "k", { version: 2 });
    expect(m.get).toHaveBeenLastCalledWith(actor, "k");
    await action.POST(req("/x", { method: "POST" }), ctx({ id: "k", action: "activate" }));
    expect(m.svc).toHaveBeenLastCalledWith(actor, "k", "activate", {});
    const { BusinessRuleError } = await import("@/core/errors/BusinessRuleError");
    m.svc.mockRejectedValueOnce(new BusinessRuleError("SELF_APPROVAL_NOT_ALLOWED", "no"));
    expect((await action.POST(req("/x", { method: "POST", body: "{}" }), ctx({ id: "k", action: "approve" }))).status).toBe(403);
  });

  it("lists: read with campaigns or settings view, write with settings edit; calendar passes the month", async () => {
    await lookups.GET(req("/x?kind=TYPE"), ctx({}));
    expect(m.assertAny).toHaveBeenCalled();
    await lookups.POST(req("/x", { method: "POST", body: "{}" }), ctx({}));
    expect(m.assert).toHaveBeenLastCalledWith("u1", "sales_marketing_settings", "edit");
    await calendar.GET(req("/x?month=2026-11"), ctx({}));
    expect(m.svc).toHaveBeenLastCalledWith(actor, { month: "2026-11" });
  });

  it("campaign links: known record types only; an order needs sales_orders.view to read", async () => {
    await links.GET(req(), ctx({ docType: "order", id: "o1" }));
    expect(m.assert).toHaveBeenCalledWith("u1", "sales_orders", "view");
    expect(m.svc).toHaveBeenLastCalledWith(actor, "SALES_ORDER", "o1");
    await links.PATCH(req("/x", { method: "PATCH", body: JSON.stringify({ campaignId: "c" }) }), ctx({ docType: "lead", id: "l1" }));
    expect(m.svc).toHaveBeenLastCalledWith(actor, "LEAD", "l1", { campaignId: "c" });
    expect((await links.GET(req(), ctx({ docType: "invoice", id: "x" }))).status).toBe(404);
  });
});
