import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  getViewableModules: vi.fn(),
  getAllowedBranchIds: vi.fn(),
  customerCount: vi.fn(),
  enquiryCount: vi.fn(),
  salesOrderCount: vi.fn(),
}));

vi.mock("@/core/rbac/PermissionService", () => ({
  PermissionService: { getViewableModules: m.getViewableModules, getAllowedBranchIds: m.getAllowedBranchIds },
}));
vi.mock("@/core/db/client", () => ({
  prisma: {
    customer: { count: m.customerCount },
    buyerEnquiry: { count: m.enquiryCount },
    salesOrder: { count: m.salesOrderCount },
  },
}));

const { getSalesMarketingOverview } = await import("./sales-marketing-overview.service");
const { SALES_MARKETING_SECTIONS } = await import("./sales-marketing-sections");
const actor = { companyId: "c1", userId: "u1" };

beforeEach(() => {
  vi.clearAllMocks();
  m.getAllowedBranchIds.mockResolvedValue(null);
});

describe("getSalesMarketingOverview", () => {
  it("returns the module map and no data sources when the viewer can see no related module", async () => {
    m.getViewableModules.mockResolvedValue(new Set(["sales_marketing"]));
    const result = await getSalesMarketingOverview(actor);
    expect(result.connectedSources).toEqual([]);
    expect(result.sections).toEqual([...SALES_MARKETING_SECTIONS]);
    expect(m.customerCount).not.toHaveBeenCalled();
    expect(m.salesOrderCount).not.toHaveBeenCalled();
  });

  it("counts only modules the viewer can view, scoped to the company", async () => {
    m.getViewableModules.mockResolvedValue(new Set(["sales_marketing", "masters_core", "buyer_enquiries", "crm"]));
    m.customerCount.mockResolvedValue(12);
    m.enquiryCount.mockResolvedValue(3);
    const result = await getSalesMarketingOverview(actor);
    expect(result.connectedSources.map((s) => s.key)).toEqual(["customers", "buyerEnquiries", "crm"]);
    expect(m.customerCount).toHaveBeenCalledWith({ where: { companyId: "c1", isActive: true, deletedAt: null } });
    expect(m.enquiryCount).toHaveBeenCalledWith({ where: { companyId: "c1", status: { in: ["OPEN", "PARTIALLY_CONVERTED"] } } });
    expect(result.connectedSources[0].metrics).toEqual([{ label: "Active customers", value: 12 }]);
    // CRM is linked, never counted here (its own visibility rules apply on /crm).
    expect(result.connectedSources[2].metrics).toEqual([]);
  });

  it("applies the viewer's branch restriction to Sales Orders, like the Sales Orders list", async () => {
    m.getViewableModules.mockResolvedValue(new Set(["sales_orders"]));
    m.getAllowedBranchIds.mockResolvedValue(new Set(["b1"]));
    m.salesOrderCount.mockResolvedValueOnce(2).mockResolvedValueOnce(5);
    const result = await getSalesMarketingOverview(actor);
    expect(m.salesOrderCount).toHaveBeenNthCalledWith(1, { where: { companyId: "c1", branchId: { in: ["b1"] }, status: "DRAFT" } });
    expect(m.salesOrderCount).toHaveBeenNthCalledWith(2, {
      where: { companyId: "c1", branchId: { in: ["b1"] }, status: { in: ["CONFIRMED", "IN_PRODUCTION", "PARTIALLY_DISPATCHED"] } },
    });
    expect(result.connectedSources[0].metrics).toEqual([
      { label: "Draft", value: 2 },
      { label: "Confirmed, not yet shipped", value: 5 },
    ]);
  });
});

describe("SALES_MARKETING_SECTIONS", () => {
  it("has unique keys, and a link exactly when a section is available", () => {
    const keys = SALES_MARKETING_SECTIONS.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const s of SALES_MARKETING_SECTIONS) {
      expect(Boolean(s.href)).toBe(s.status === "AVAILABLE");
    }
  });
});
