import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const m = vi.hoisted(() => ({ requireSession: vi.fn(), assert: vi.fn(), assertAny: vi.fn(), calc: vi.fn(), create: vi.fn(), action: vi.fn(), rule: vi.fn() }));

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
vi.mock("@/modules/sales-marketing/pricing/pricing.service", () => ({ calculatePrices: m.calc }));
vi.mock("@/modules/sales-marketing/pricing/price-list.service", () => ({
  createPriceList: m.create,
  listPriceLists: vi.fn(async () => ({ data: [], totalCount: 0 })),
  priceVersionAction: m.action,
  priceListAction: m.action,
  getPriceList: vi.fn(),
  updatePriceListHeader: vi.fn(),
  saveDraftVersion: vi.fn(),
  startNewVersion: vi.fn(),
}));
vi.mock("@/modules/sales-marketing/pricing/discount-rule.service", () => ({
  createDiscountRule: vi.fn(),
  listDiscountRules: vi.fn(async () => ({ data: [], totalCount: 0 })),
  discountRuleAction: m.rule,
  getDiscountRule: vi.fn(),
  updateDiscountRule: vi.fn(),
}));

const calc = await import("./calculate/route");
const lists = await import("./price-lists/route");
const versionActions = await import("./price-lists/[id]/versions/[versionId]/actions/[action]/route");
const listActions = await import("./price-lists/[id]/actions/[action]/route");
const ruleActions = await import("./discount-rules/[id]/actions/[action]/route");
const ctx = <P,>(params: P) => ({ params: Promise.resolve(params) });
const req = (init?: RequestInit) => new NextRequest(new URL("/x", "http://localhost"), init as never);

beforeEach(() => {
  vi.clearAllMocks();
  m.requireSession.mockResolvedValue({ user: { id: "u1", companyId: "c1", defaultBranchId: null } });
  m.assert.mockResolvedValue(undefined);
  m.assertAny.mockResolvedValue(undefined);
  m.calc.mockResolvedValue([]);
});

describe("Pricing API routes", () => {
  it("calculate accepts pricing viewers or quotation writers", async () => {
    const res = await calc.POST(req({ method: "POST", body: JSON.stringify({ lines: [] }) }), ctx({}));
    expect(res.status).toBe(200);
    expect(m.assertAny).toHaveBeenCalledWith("u1", [
      ["sales_pricing", "view"],
      ["sales_quotations", "create"],
      ["sales_quotations", "edit"],
    ]);
    expect(m.calc).toHaveBeenCalledWith(expect.objectContaining({ companyId: "c1", userId: "u1" }), { lines: [] });
  });

  it("lists need view, creating needs create; denied users never reach the service", async () => {
    await lists.GET(new NextRequest(new URL("/x?status=all", "http://localhost")), ctx({}));
    expect(m.assert).toHaveBeenLastCalledWith("u1", "sales_pricing", "view");
    await lists.POST(req({ method: "POST", body: "{}" }), ctx({}));
    expect(m.assert).toHaveBeenLastCalledWith("u1", "sales_pricing", "create");
    const { BusinessRuleError } = await import("@/core/errors/BusinessRuleError");
    m.assert.mockRejectedValue(new BusinessRuleError("PERMISSION_DENIED", "No."));
    m.create.mockClear();
    expect((await lists.POST(req({ method: "POST", body: "{}" }), ctx({}))).status).toBe(403);
    expect(m.create).not.toHaveBeenCalled();
  });

  it("version / list / rule actions pass the action through (the service checks its own permission)", async () => {
    await versionActions.POST(req({ method: "POST", body: JSON.stringify({ comment: "ok" }) }), ctx({ id: "pl", versionId: "v", action: "approve" }));
    expect(m.action).toHaveBeenCalledWith(expect.anything(), "pl", "v", "approve", { comment: "ok" });
    await listActions.POST(req({ method: "POST" }), ctx({ id: "pl", action: "deactivate" }));
    expect(m.assert).toHaveBeenLastCalledWith("u1", "sales_pricing", "edit");
    await ruleActions.POST(req({ method: "POST" }), ctx({ id: "r", action: "submit" }));
    expect(m.rule).toHaveBeenCalledWith(expect.anything(), "r", "submit", {});
  });
});
