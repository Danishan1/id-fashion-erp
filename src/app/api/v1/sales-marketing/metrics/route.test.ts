import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const m = vi.hoisted(() => ({ requireSession: vi.fn(), assertAny: vi.fn(), metrics: vi.fn(), reportBuild: vi.fn(), assertReport: vi.fn() }));
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
vi.mock("@/core/rbac/PermissionService", () => ({ PermissionService: { assertAny: m.assertAny, assert: vi.fn() } }));
vi.mock("@/modules/sales-marketing/sales-marketing-metrics.service", () => ({ getSalesMarketingMetrics: m.metrics }));
vi.mock("@/core/reports/permissions", () => ({ assertReportAccess: m.assertReport }));
vi.mock("@/modules/reports/all-reports", () => ({}));
vi.mock("@/modules/reports/registry", () => ({ getReportConfig: () => ({ category: "sales-marketing", buildDescriptor: m.reportBuild }) }));

const metricsRoute = await import("./route");
const reportRoute = await import("@/app/api/v1/reports/[category]/[report]/route");
const ctx = <P,>(params: P) => ({ params: Promise.resolve(params) });

beforeEach(() => {
  vi.clearAllMocks();
  m.requireSession.mockResolvedValue({ user: { id: "u1", companyId: "c1", name: "Asha", defaultBranchId: null } });
  m.metrics.mockResolvedValue({ periodDays: 30 });
  m.reportBuild.mockResolvedValue({ title: "x" });
});

describe("Sales & Marketing KPI and report routes", () => {
  it("metrics: needs Sales & Marketing or quotation view; passes the period", async () => {
    const res = await metricsRoute.GET(new NextRequest(new URL("/x?days=30", "http://localhost")), ctx({}));
    expect(res.status).toBe(200);
    expect(m.assertAny).toHaveBeenCalledWith("u1", [
      ["sales_marketing", "view"],
      ["sales_quotations", "view"],
    ]);
    expect(m.metrics).toHaveBeenCalledWith(expect.objectContaining({ companyId: "c1", userId: "u1" }), 30);
  });

  it("report routes hand the viewer to the report so it can apply record visibility", async () => {
    await reportRoute.GET(new NextRequest(new URL("/x?customerId=c9", "http://localhost")), ctx({ category: "sales-marketing", report: "quotation-register" }));
    expect(m.assertReport).toHaveBeenCalledWith("u1", "sales-marketing", "view");
    expect(m.reportBuild).toHaveBeenCalledWith("c1", "Asha", { customerId: "c9" }, { userId: "u1" });
  });
});
