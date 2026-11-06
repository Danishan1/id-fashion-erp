import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  requireSession: vi.fn(),
  assert: vi.fn(),
  getSalesMarketingOverview: vi.fn(),
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
vi.mock("@/modules/sales-marketing/sales-marketing-overview.service", () => ({ getSalesMarketingOverview: m.getSalesMarketingOverview }));

const { GET } = await import("./route");

beforeEach(() => {
  vi.clearAllMocks();
  m.requireSession.mockResolvedValue({ user: { id: "u1", companyId: "c1" } });
  m.assert.mockResolvedValue(undefined);
});

describe("GET /api/v1/sales-marketing/overview", () => {
  it("needs a session", async () => {
    const { BusinessRuleError } = await import("@/core/errors/BusinessRuleError");
    m.requireSession.mockRejectedValue(new BusinessRuleError("PERMISSION_DENIED", "Sign in required."));
    const res = await GET();
    expect(res.status).toBe(403);
    expect(m.getSalesMarketingOverview).not.toHaveBeenCalled();
  });

  it("needs sales_marketing.view", async () => {
    const { BusinessRuleError } = await import("@/core/errors/BusinessRuleError");
    m.assert.mockRejectedValue(new BusinessRuleError("PERMISSION_DENIED", "No access."));
    const res = await GET();
    expect(res.status).toBe(403);
    expect(m.assert).toHaveBeenCalledWith("u1", "sales_marketing", "view");
    expect(m.getSalesMarketingOverview).not.toHaveBeenCalled();
  });

  it("returns 403 MODULE_NOT_ENABLED when the package is turned off", async () => {
    const { BusinessRuleError } = await import("@/core/errors/BusinessRuleError");
    m.assert.mockRejectedValue(new BusinessRuleError("MODULE_NOT_ENABLED", "Not enabled."));
    const res = await GET();
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("MODULE_NOT_ENABLED");
  });

  it("returns the overview for the caller's company", async () => {
    m.getSalesMarketingOverview.mockResolvedValue({ sections: [], connectedSources: [] });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(m.getSalesMarketingOverview).toHaveBeenCalledWith({ companyId: "c1", userId: "u1" });
    expect((await res.json()).data).toEqual({ sections: [], connectedSources: [] });
  });
});
