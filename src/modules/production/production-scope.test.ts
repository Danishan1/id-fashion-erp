import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  lot: { count: vi.fn() },
  productionOrder: { count: vi.fn() },
}));
vi.mock("@/core/db/client", () => ({ prisma: mockPrisma }));
vi.mock("@/core/rbac/PermissionService", () => ({
  PermissionService: { can: vi.fn(), getAllowedBranchIds: vi.fn() },
}));
vi.mock("./production.repository", () => ({
  LotRepository: { findAnyById: vi.fn() },
  ProductionOrderRepository: { findAnyById: vi.fn() },
}));

const { PermissionService } = await import("@/core/rbac/PermissionService");
const { LotRepository, ProductionOrderRepository } = await import("./production.repository");
const {
  getProductionRecordScope,
  assignedLotWhere,
  assignedProductionOrderWhere,
  assertLotInScope,
  assertProductionOrderInScope,
} = await import("./production-scope");

const actor = { companyId: "co-1", userId: "user-1" };

beforeEach(() => {
  vi.mocked(PermissionService.can).mockReset().mockResolvedValue(false);
  vi.mocked(PermissionService.getAllowedBranchIds).mockReset().mockResolvedValue(null);
  mockPrisma.user.findUnique.mockReset().mockResolvedValue({ employeeId: "emp-1" });
  mockPrisma.lot.count.mockReset();
  mockPrisma.productionOrder.count.mockReset();
  vi.mocked(LotRepository.findAnyById).mockReset().mockResolvedValue({ id: "lot-1", branchId: "b-1" } as never);
  vi.mocked(ProductionOrderRepository.findAnyById).mockReset().mockResolvedValue({ id: "po-1", branchId: "b-1" } as never);
});

describe("getProductionRecordScope", () => {
  it("is ALL for a production.view_all holder", async () => {
    vi.mocked(PermissionService.can).mockResolvedValue(true);
    expect(await getProductionRecordScope("user-1")).toEqual({ mode: "ALL" });
    expect(PermissionService.can).toHaveBeenCalledWith("user-1", "production", "view_all");
  });

  it("is ASSIGNED to the user's linked employee otherwise", async () => {
    expect(await getProductionRecordScope("user-1")).toEqual({ mode: "ASSIGNED", employeeId: "emp-1" });
  });

  it("is ASSIGNED with no employee for an unlinked login", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ employeeId: null });
    expect(await getProductionRecordScope("user-1")).toEqual({ mode: "ASSIGNED", employeeId: null });
  });
});

describe("where fragments", () => {
  it("add nothing for ALL", () => {
    expect(assignedLotWhere({ mode: "ALL" })).toEqual({});
    expect(assignedProductionOrderWhere({ mode: "ALL" })).toEqual({});
  });

  it("require one of my non-cancelled assignments", () => {
    expect(assignedProductionOrderWhere({ mode: "ASSIGNED", employeeId: "emp-1" })).toEqual({
      lots: {
        some: {
          jobOrders: { some: { assignments: { some: { employeeId: "emp-1", status: { not: "CANCELLED" } } } } },
        },
      },
    });
  });

  it("match nothing when there is no linked employee", () => {
    expect(assignedLotWhere({ mode: "ASSIGNED", employeeId: null })).toEqual({ id: "00000000-0000-0000-0000-000000000000" });
  });
});

describe("read guards", () => {
  it("refuse a lot without my assignment as not found", async () => {
    mockPrisma.lot.count.mockResolvedValue(0);
    await expect(assertLotInScope(actor, "lot-1")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("allow a lot with my assignment", async () => {
    mockPrisma.lot.count.mockResolvedValue(1);
    await expect(assertLotInScope(actor, "lot-1")).resolves.toMatchObject({ id: "lot-1" });
  });

  it("refuse a production order without my assignment as not found", async () => {
    mockPrisma.productionOrder.count.mockResolvedValue(0);
    await expect(assertProductionOrderInScope(actor, "po-1")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("skip the assignment check for a view_all holder", async () => {
    vi.mocked(PermissionService.can).mockResolvedValue(true);
    await expect(assertProductionOrderInScope(actor, "po-1")).resolves.toMatchObject({ id: "po-1" });
    expect(mockPrisma.productionOrder.count).not.toHaveBeenCalled();
  });
});
