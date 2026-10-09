import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const m = vi.hoisted(() => ({ requireSession: vi.fn(), assert: vi.fn(), getLeadBoard: vi.fn() }));
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
vi.mock("@/modules/crm/leads/lead-board.service", () => ({ getLeadBoard: m.getLeadBoard }));

const route = await import("./route");
const ctx = { params: Promise.resolve({}) };

beforeEach(() => {
  m.requireSession.mockReset().mockResolvedValue({ user: { id: "user-1", companyId: "co-1", defaultBranchId: null } });
  m.assert.mockReset().mockResolvedValue(undefined);
  m.getLeadBoard.mockReset().mockResolvedValue({ statuses: [] });
});

describe("GET /api/v1/crm/leads/board", () => {
  it("passes every query param to the board service with crm.view", async () => {
    const res = await route.GET(new NextRequest("http://x/api/v1/crm/leads/board?perStatus=5&temperatures=HOT&search=asha"), ctx);
    expect(res.status).toBe(200);
    expect(m.getLeadBoard).toHaveBeenCalledWith({ companyId: "co-1", userId: "user-1", branchId: null }, { perStatus: "5", temperatures: "HOT", search: "asha" });
    expect(m.assert.mock.calls.at(-1)!.slice(1)).toEqual(["crm", "view"]);
  });

  it("is refused without CRM access", async () => {
    const { BusinessRuleError } = await import("@/core/errors/BusinessRuleError");
    m.assert.mockRejectedValue(new BusinessRuleError("PERMISSION_DENIED", "No"));
    expect((await route.GET(new NextRequest("http://x/api/v1/crm/leads/board"), ctx)).status).toBe(403);
    expect(m.getLeadBoard).not.toHaveBeenCalled();
  });
});
