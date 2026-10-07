import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { CRM_PREFERENCE_KEYS, CRM_PREFERENCES, isCrmPreferenceKey } from "@/modules/crm/preferences/crm-preference-registry";

const m = vi.hoisted(() => ({
  requireSession: vi.fn(),
  assert: vi.fn(),
  svc: { getPreferences: vi.fn(), setPreference: vi.fn(), deletePreference: vi.fn() },
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
vi.mock("@/modules/crm/preferences/crm-preferences.service", () => m.svc);

const list = await import("./route");
const one = await import("./[key]/route");
const ACTOR = { companyId: "co-1", userId: "user-1", branchId: null };
const ctx = <P,>(params: P) => ({ params: Promise.resolve(params) });

beforeEach(() => {
  m.requireSession.mockReset().mockResolvedValue({ user: { id: "user-1", companyId: "co-1", defaultBranchId: null } });
  m.assert.mockReset().mockResolvedValue(undefined);
  for (const fn of Object.values(m.svc)) fn.mockReset().mockResolvedValue({ ok: true });
});

describe("CRM preference routes", () => {
  it("reads the signed-in user's preferences under a prefix with crm.view", async () => {
    m.svc.getPreferences.mockResolvedValue({ "opportunities.mode": "board" });
    const res = await list.GET(new NextRequest("http://x/api/v1/crm/preferences?prefix=opportunities."), ctx({}));
    expect(await res.json()).toEqual({ data: { "opportunities.mode": "board" } });
    expect(m.svc.getPreferences).toHaveBeenCalledWith(ACTOR, "opportunities.");
    expect(m.assert.mock.calls.at(-1)!.slice(1)).toEqual(["crm", "view"]);
  });

  it("saves and resets one key for the signed-in user only", async () => {
    await one.PUT(new NextRequest("http://x", { method: "PUT", body: JSON.stringify({ value: ["company"], userId: "someone-else" }) }), ctx({ key: "opportunities.board.cardFields" }));
    expect(m.svc.setPreference).toHaveBeenCalledWith(ACTOR, "opportunities.board.cardFields", ["company"]);
    const del = await one.DELETE(new NextRequest("http://x", { method: "DELETE" }), ctx({ key: "opportunities.mode" }));
    expect(del.status).toBe(200);
    expect(m.svc.deletePreference).toHaveBeenCalledWith(ACTOR, "opportunities.mode");
  });

  it("is refused without CRM access", async () => {
    const { BusinessRuleError } = await import("@/core/errors/BusinessRuleError");
    m.assert.mockRejectedValue(new BusinessRuleError("PERMISSION_DENIED", "No"));
    const res = await list.GET(new NextRequest("http://x/api/v1/crm/preferences"), ctx({}));
    expect(res.status).toBe(403);
    expect(m.svc.getPreferences).not.toHaveBeenCalled();
  });
});

describe("CRM preference registry", () => {
  it("knows only its own keys", () => {
    expect(CRM_PREFERENCE_KEYS).toEqual(expect.arrayContaining(["opportunities.list.columns", "opportunities.list.defaultViewId", "opportunities.board.cardFields", "opportunities.board.pipelineId", "opportunities.mode"]));
    expect(isCrmPreferenceKey("opportunities.mode")).toBe(true);
    expect(isCrmPreferenceKey("toString")).toBe(false);
    expect(isCrmPreferenceKey("__proto__")).toBe(false);
  });

  it("validates each value's shape", () => {
    expect(CRM_PREFERENCES["opportunities.board.cardFields"].safeParse(["company", "cf:fabric_type"]).success).toBe(true);
    expect(CRM_PREFERENCES["opportunities.board.cardFields"].safeParse(["<script>"]).success).toBe(false);
    expect(CRM_PREFERENCES["opportunities.board.cardFields"].safeParse(Array.from({ length: 21 }, (_, i) => `f${i}`)).success).toBe(false);
    expect(CRM_PREFERENCES["opportunities.mode"].safeParse("board").success).toBe(true);
    expect(CRM_PREFERENCES["opportunities.mode"].safeParse("kanban").success).toBe(false);
    expect(CRM_PREFERENCES["opportunities.list.defaultViewId"].safeParse(null).success).toBe(true);
    expect(CRM_PREFERENCES["opportunities.board.pipelineId"].safeParse("x").success).toBe(false);
  });
});
