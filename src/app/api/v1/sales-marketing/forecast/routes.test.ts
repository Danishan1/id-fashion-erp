import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const m = vi.hoisted(() => ({ requireSession: vi.fn(), assert: vi.fn(), svc: vi.fn() }));

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
vi.mock("@/core/rbac/PermissionService", () => ({ PermissionService: { assert: m.assert, assertAny: vi.fn() } }));
vi.mock("@/modules/sales-marketing/forecast/forecast.service", () => ({ getForecast: m.svc }));
vi.mock("@/modules/sales-marketing/forecast/forecast-snapshot.service", () => ({ createManualSnapshot: m.svc, listSnapshots: vi.fn(async () => ({ data: [] })), getSnapshot: m.svc, getAccuracySummary: m.svc }));
vi.mock("@/modules/sales-marketing/forecast/forecast-scenario.service", () => ({ createScenario: m.svc, listScenarios: m.svc, previewScenario: m.svc, getScenario: m.svc, updateScenario: m.svc, archiveScenario: m.svc }));

const forecast = await import("./route");
const snapshots = await import("./snapshots/route");
const accuracy = await import("./accuracy/route");
const scenarios = await import("./scenarios/route");
const preview = await import("./scenarios/preview/route");
const scenario = await import("./scenarios/[id]/route");
const archive = await import("./scenarios/[id]/archive/route");
const ctx = <P,>(params: P) => ({ params: Promise.resolve(params) });
const req = (url = "/x", init?: RequestInit) => new NextRequest(new URL(url, "http://localhost"), init as never);
const actor = { companyId: "c1", userId: "u1", branchId: null };

beforeEach(() => {
  vi.clearAllMocks();
  m.requireSession.mockResolvedValue({ user: { id: "u1", companyId: "c1", defaultBranchId: null } });
  m.assert.mockResolvedValue(undefined);
  m.svc.mockResolvedValue({ id: "x" });
});

describe("Forecast API routes", () => {
  it("forecast and accuracy need sales_performance.view and read the period from the query", async () => {
    await forecast.GET(req("/x?periodType=QUARTER&periodStart=2026-10-01"), ctx({}));
    expect(m.assert).toHaveBeenLastCalledWith("u1", "sales_performance", "view");
    expect(m.svc).toHaveBeenLastCalledWith(actor, { periodType: "QUARTER", periodStart: "2026-10-01" });
    await accuracy.GET(req("/x?periodType=YEAR"), ctx({}));
    expect(m.svc).toHaveBeenLastCalledWith(actor, { periodType: "YEAR" });
  });

  it("saving a snapshot or a scenario needs create; editing / archiving a scenario needs edit; preview only view", async () => {
    expect((await snapshots.POST(req("/x", { method: "POST", body: JSON.stringify({ periodType: "MONTH" }) }), ctx({}))).status).toBe(201);
    expect(m.assert).toHaveBeenLastCalledWith("u1", "sales_performance", "create");
    expect((await scenarios.POST(req("/x", { method: "POST", body: "{}" }), ctx({}))).status).toBe(201);
    expect(m.assert).toHaveBeenLastCalledWith("u1", "sales_performance", "create");
    await scenario.PATCH(req("/x", { method: "PATCH", body: JSON.stringify({ version: 1 }) }), ctx({ id: "s1" }));
    expect(m.assert).toHaveBeenLastCalledWith("u1", "sales_performance", "edit");
    expect(m.svc).toHaveBeenLastCalledWith(actor, "s1", { version: 1 });
    await archive.POST(req("/x", { method: "POST" }), ctx({ id: "s1" }));
    expect(m.assert).toHaveBeenLastCalledWith("u1", "sales_performance", "edit");
    await preview.POST(req("/x", { method: "POST", body: JSON.stringify({ assumptions: {} }) }), ctx({}));
    expect(m.assert).toHaveBeenLastCalledWith("u1", "sales_performance", "view");
  });

  it("a refused permission maps to 403", async () => {
    const { BusinessRuleError } = await import("@/core/errors/BusinessRuleError");
    m.assert.mockRejectedValueOnce(new BusinessRuleError("PERMISSION_DENIED", "no"));
    expect((await snapshots.POST(req("/x", { method: "POST", body: "{}" }), ctx({}))).status).toBe(403);
  });
});
