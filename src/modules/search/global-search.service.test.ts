import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/rbac/PermissionService", () => ({
  PermissionService: { getViewableModules: vi.fn() },
}));
vi.mock("@/modules/sales-orders/sales-order.repository", () => ({
  SalesOrderRepository: { searchTop: vi.fn() },
}));
vi.mock("@/modules/purchasing/purchase-order.repository", () => ({
  PurchaseOrderRepository: { searchTop: vi.fn() },
}));
vi.mock("@/modules/inventory/material-request.repository", () => ({
  MaterialRequestRepository: { searchTop: vi.fn() },
}));
vi.mock("@/modules/production/production.repository", () => ({
  ProductionOrderRepository: { searchTop: vi.fn() },
}));
vi.mock("@/modules/sampling/sample.repository", () => ({
  SampleRequestRepository: { searchTop: vi.fn() },
}));
vi.mock("@/modules/buyer-enquiries/buyer-enquiry.repository", () => ({
  BuyerEnquiryRepository: { searchTop: vi.fn() },
}));
vi.mock("@/modules/customers/customer.repository", () => ({
  CustomerRepository: { searchTop: vi.fn() },
}));
vi.mock("@/modules/suppliers/supplier.repository", () => ({
  SupplierRepository: { searchTop: vi.fn() },
}));
vi.mock("@/modules/products/product.repository", () => ({
  ProductRepository: { searchTopStyles: vi.fn(), searchTopMaterials: vi.fn() },
}));

const { PermissionService } = await import("@/core/rbac/PermissionService");
const { SalesOrderRepository } = await import("@/modules/sales-orders/sales-order.repository");
const { PurchaseOrderRepository } = await import("@/modules/purchasing/purchase-order.repository");
const { MaterialRequestRepository } = await import("@/modules/inventory/material-request.repository");
const { ProductionOrderRepository } = await import("@/modules/production/production.repository");
const { SampleRequestRepository } = await import("@/modules/sampling/sample.repository");
const { BuyerEnquiryRepository } = await import("@/modules/buyer-enquiries/buyer-enquiry.repository");
const { CustomerRepository } = await import("@/modules/customers/customer.repository");
const { SupplierRepository } = await import("@/modules/suppliers/supplier.repository");
const { ProductRepository } = await import("@/modules/products/product.repository");
const { searchGlobal } = await import("./global-search.service");

const actor = { userId: "user-1", companyId: "co-1" };

const ALL_REPO_MOCKS = [
  SalesOrderRepository.searchTop,
  PurchaseOrderRepository.searchTop,
  MaterialRequestRepository.searchTop,
  ProductionOrderRepository.searchTop,
  SampleRequestRepository.searchTop,
  BuyerEnquiryRepository.searchTop,
  CustomerRepository.searchTop,
  SupplierRepository.searchTop,
  ProductRepository.searchTopStyles,
  ProductRepository.searchTopMaterials,
];

beforeEach(() => {
  vi.mocked(PermissionService.getViewableModules).mockReset().mockResolvedValue("all");
  for (const fn of ALL_REPO_MOCKS) {
    vi.mocked(fn).mockReset().mockResolvedValue([]);
  }
});

describe("searchGlobal — query-length gating", () => {
  it("returns no groups and queries nothing for a below-minimum-length term", async () => {
    const result = await searchGlobal(actor, "o");

    expect(result).toEqual({ groups: [] });
    for (const fn of ALL_REPO_MOCKS) expect(fn).not.toHaveBeenCalled();
  });

  it("returns no groups for an empty or whitespace-only term", async () => {
    expect(await searchGlobal(actor, "")).toEqual({ groups: [] });
    expect(await searchGlobal(actor, "   ")).toEqual({ groups: [] });
    for (const fn of ALL_REPO_MOCKS) expect(fn).not.toHaveBeenCalled();
  });
});

describe("searchGlobal — tenant isolation", () => {
  it("passes the acting user's own companyId — and only that companyId — into every entity query", async () => {
    await searchGlobal({ userId: "user-1", companyId: "co-42" }, "0012");

    for (const fn of ALL_REPO_MOCKS) {
      expect(fn).toHaveBeenCalledWith("co-42", "0012", 5);
    }
  });

  it("uses a different actor's companyId on a separate call — no cross-tenant leakage via shared state", async () => {
    await searchGlobal({ userId: "user-1", companyId: "tenant-a" }, "test");
    await searchGlobal({ userId: "user-2", companyId: "tenant-b" }, "test");

    const calls = vi.mocked(SalesOrderRepository.searchTop).mock.calls;
    expect(calls[0][0]).toBe("tenant-a");
    expect(calls[1][0]).toBe("tenant-b");
  });
});

describe("searchGlobal — RBAC permission filtering", () => {
  it("skips a module's query entirely (never queried, not filtered after the fact) when the user cannot view it", async () => {
    vi.mocked(PermissionService.getViewableModules).mockResolvedValue(new Set(["sales_orders", "masters_core"]));

    await searchGlobal(actor, "test");

    expect(SalesOrderRepository.searchTop).toHaveBeenCalled();
    expect(CustomerRepository.searchTop).toHaveBeenCalled();
    expect(SupplierRepository.searchTop).toHaveBeenCalled();
    expect(ProductRepository.searchTopStyles).toHaveBeenCalled();
    expect(ProductRepository.searchTopMaterials).toHaveBeenCalled();

    expect(PurchaseOrderRepository.searchTop).not.toHaveBeenCalled();
    expect(MaterialRequestRepository.searchTop).not.toHaveBeenCalled();
    expect(ProductionOrderRepository.searchTop).not.toHaveBeenCalled();
    expect(SampleRequestRepository.searchTop).not.toHaveBeenCalled();
    expect(BuyerEnquiryRepository.searchTop).not.toHaveBeenCalled();
  });

  it("returns zero groups and queries nothing when the user has no viewable modules at all (e.g. suspended)", async () => {
    vi.mocked(PermissionService.getViewableModules).mockResolvedValue(new Set());

    const result = await searchGlobal(actor, "test");

    expect(result.groups).toEqual([]);
    for (const fn of ALL_REPO_MOCKS) expect(fn).not.toHaveBeenCalled();
  });

  it("queries every group when the viewer is unrestricted ('all', e.g. a platform admin)", async () => {
    vi.mocked(PermissionService.getViewableModules).mockResolvedValue("all");

    await searchGlobal(actor, "test");

    for (const fn of ALL_REPO_MOCKS) expect(fn).toHaveBeenCalled();
  });

  it("passes the per-entity result cap of 5 to every query", async () => {
    await searchGlobal(actor, "test");
    for (const fn of ALL_REPO_MOCKS) {
      expect(fn).toHaveBeenCalledWith(expect.any(String), "test", 5);
    }
  });
});

describe("searchGlobal — result shaping", () => {
  it("shapes a Sales Order hit with the customer's name as secondary info and the correct href", async () => {
    vi.mocked(SalesOrderRepository.searchTop).mockResolvedValue([
      { id: "so-1", orderNumber: "ORD-2026-00012", customer: { name: "Acme Garments" } },
    ] as never);

    const result = await searchGlobal(actor, "0012");

    const group = result.groups.find((g) => g.label === "Sales Orders");
    expect(group?.items).toEqual([
      { id: "so-1", primary: "ORD-2026-00012", secondary: "Acme Garments", href: "/sales-orders/so-1" },
    ]);
  });

  it("falls back from customer to prospectName for a Buyer Enquiry with no linked customer", async () => {
    vi.mocked(BuyerEnquiryRepository.searchTop).mockResolvedValue([
      { id: "be-1", enquiryNumber: "ENQ-2026-00003", customer: null, prospectName: "Some Prospect Ltd" },
    ] as never);

    const result = await searchGlobal(actor, "test");

    const group = result.groups.find((g) => g.label === "Buyer Enquiries");
    expect(group?.items[0]).toEqual({
      id: "be-1",
      primary: "ENQ-2026-00003",
      secondary: "Some Prospect Ltd",
      href: "/buyer-enquiries/be-1",
    });
  });

  it("falls back from department to warehouse for a Material Request with no department set", async () => {
    vi.mocked(MaterialRequestRepository.searchTop).mockResolvedValue([
      { id: "mr-1", requestNumber: "MR-2026-00007", department: null, warehouse: { name: "Fabric Store" } },
    ] as never);

    const result = await searchGlobal(actor, "test");

    const group = result.groups.find((g) => g.label === "Material Requests");
    expect(group?.items[0]?.secondary).toBe("Fabric Store");
  });

  it("uses styleCode as the secondary label for both Products/Styles and Raw Materials", async () => {
    vi.mocked(ProductRepository.searchTopStyles).mockResolvedValue([
      { id: "p-1", styleName: "V-Neck T-Shirt", styleCode: "ST-00010" },
    ] as never);
    vi.mocked(ProductRepository.searchTopMaterials).mockResolvedValue([
      { id: "m-1", styleName: "Cotton Fabric", styleCode: "MAT-00003" },
    ] as never);

    const result = await searchGlobal(actor, "test");

    expect(result.groups.find((g) => g.label === "Products / Styles")?.items[0]).toEqual({
      id: "p-1",
      primary: "V-Neck T-Shirt",
      secondary: "ST-00010",
      href: "/masters/products/p-1",
    });
    expect(result.groups.find((g) => g.label === "Raw Materials")?.items[0]).toEqual({
      id: "m-1",
      primary: "Cotton Fabric",
      secondary: "MAT-00003",
      href: "/masters/materials/m-1",
    });
  });

  it("omits a group from the response entirely when its query returns zero matches", async () => {
    vi.mocked(SalesOrderRepository.searchTop).mockResolvedValue([
      { id: "so-1", orderNumber: "ORD-2026-00012", customer: null },
    ] as never);

    const result = await searchGlobal(actor, "test");

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].label).toBe("Sales Orders");
  });
});

describe("searchGlobal — overall result cap", () => {
  it("caps the combined result at 20 across groups, dropping lower-priority groups once the budget is used up", async () => {
    const makeOrderRows = (prefix: string, count: number) =>
      Array.from({ length: count }, (_, i) => ({ id: `${prefix}-${i}`, orderNumber: `${prefix}-${i}`, customer: null }));

    // Five entity types each return their max-5 rows = 25 raw matches, over the 20 overall cap.
    vi.mocked(SalesOrderRepository.searchTop).mockResolvedValue(makeOrderRows("SO", 5) as never);
    vi.mocked(PurchaseOrderRepository.searchTop).mockResolvedValue(
      makeOrderRows("PO", 5).map(({ id, orderNumber }) => ({ id, orderNumber, supplier: null })) as never
    );
    vi.mocked(SampleRequestRepository.searchTop).mockResolvedValue(
      makeOrderRows("SAM", 5).map(({ id, orderNumber }) => ({ id, requestNumber: orderNumber, customer: null })) as never
    );
    vi.mocked(BuyerEnquiryRepository.searchTop).mockResolvedValue(
      makeOrderRows("ENQ", 5).map(({ id, orderNumber }) => ({
        id,
        enquiryNumber: orderNumber,
        customer: null,
        prospectName: null,
      })) as never
    );
    vi.mocked(MaterialRequestRepository.searchTop).mockResolvedValue(
      makeOrderRows("MR", 5).map(({ id, orderNumber }) => ({
        id,
        requestNumber: orderNumber,
        department: null,
        warehouse: null,
      })) as never
    );

    const result = await searchGlobal(actor, "test");

    const totalItems = result.groups.reduce((sum, g) => sum + g.items.length, 0);
    expect(totalItems).toBe(20);
    // Declaration/priority order: Sales Orders, Purchase Orders, Sample Requests,
    // Buyer Enquiries, then Material Requests — the first four (5 each = 20)
    // are included whole; Material Requests is dropped entirely rather than
    // truncated mid-group once the budget is exhausted.
    expect(result.groups.map((g) => g.label)).toEqual([
      "Sales Orders",
      "Purchase Orders",
      "Sample Requests",
      "Buyer Enquiries",
    ]);
  });

  it("still queries every viewable module even when an earlier group's results will fill the overall cap", async () => {
    const makeOrderRows = (prefix: string, count: number) =>
      Array.from({ length: count }, (_, i) => ({ id: `${prefix}-${i}`, orderNumber: `${prefix}-${i}`, customer: null }));
    vi.mocked(SalesOrderRepository.searchTop).mockResolvedValue(makeOrderRows("SO", 5) as never);

    await searchGlobal(actor, "test");

    // Fan-out runs every enabled group in parallel regardless of budget —
    // the cap is only applied once all results are back, not by skipping
    // later groups' queries pre-emptively.
    for (const fn of ALL_REPO_MOCKS) expect(fn).toHaveBeenCalled();
  });
});
