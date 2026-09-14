import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/core/rbac/PermissionService", () => ({
  PermissionService: { getAllowedBranchIds: vi.fn() },
}));
vi.mock("./warehouse.repository", () => ({
  WarehouseRepository: {
    findByCodeInBranch: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    findByIdWithLocations: vi.fn(),
  },
  WarehouseLocationRepository: {
    findMany: vi.fn(),
    findByCode: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    findByIdWithWarehouse: vi.fn(),
  },
}));

const { writeAuditLog } = await import("@/core/audit/AuditLogger");
const { PermissionService } = await import("@/core/rbac/PermissionService");
const { WarehouseRepository, WarehouseLocationRepository } = await import("./warehouse.repository");
const { createWarehouse, updateWarehouse, createWarehouseLocation, updateWarehouseLocation, listWarehouses, getWarehouseById } =
  await import("./warehouse.service");

const actor = { companyId: "co-1", branchId: "branch-1", userId: "user-1" };

beforeEach(() => {
  vi.mocked(writeAuditLog).mockReset();
  vi.mocked(PermissionService.getAllowedBranchIds).mockReset().mockResolvedValue(null);
  vi.mocked(WarehouseRepository.findByCodeInBranch).mockReset().mockResolvedValue(null);
  vi.mocked(WarehouseRepository.create)
    .mockReset()
    .mockResolvedValue({ id: "wh-1", code: "WH-NEW", name: "New Warehouse", type: ["FABRIC"] } as never);
  vi.mocked(WarehouseRepository.update).mockReset();
  vi.mocked(WarehouseRepository.findByIdWithLocations)
    .mockReset()
    .mockResolvedValue({ id: "wh-1", companyId: "co-1" } as never);
  vi.mocked(WarehouseLocationRepository.findMany).mockReset().mockResolvedValue([]);
  vi.mocked(WarehouseLocationRepository.findByCode).mockReset().mockResolvedValue(null);
  vi.mocked(WarehouseLocationRepository.create).mockReset().mockResolvedValue({ id: "loc-1" } as never);
  vi.mocked(WarehouseLocationRepository.update).mockReset().mockResolvedValue({ id: "loc-1" } as never);
  vi.mocked(WarehouseLocationRepository.findByIdWithWarehouse).mockReset();
  vi.mocked(WarehouseRepository.findMany).mockReset().mockResolvedValue([]);
  vi.mocked(WarehouseRepository.count).mockReset().mockResolvedValue(0);
});

describe("branch access enforcement (2026-09-15)", () => {
  const listQuery = { search: "", sortBy: "name", sortOrder: "asc" as const, page: 1, pageSize: 20, skip: 0, take: 20 };

  it("listWarehouses applies no branch filter for an unrestricted user", async () => {
    vi.mocked(PermissionService.getAllowedBranchIds).mockResolvedValue(null);

    await listWarehouses({ companyId: "co-1", userId: "user-1" }, listQuery);

    expect(WarehouseRepository.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: "co-1" }),
      expect.anything()
    );
    const whereArg = vi.mocked(WarehouseRepository.findMany).mock.calls[0][0];
    expect(whereArg).not.toHaveProperty("branchId");
  });

  it("listWarehouses adds a branchId IN filter for a branch-restricted user", async () => {
    vi.mocked(PermissionService.getAllowedBranchIds).mockResolvedValue(new Set(["branch-1"]));

    await listWarehouses({ companyId: "co-1", userId: "user-1" }, listQuery);

    expect(WarehouseRepository.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: "co-1", branchId: { in: ["branch-1"] } }),
      expect.anything()
    );
  });

  it("getWarehouseById succeeds for a warehouse inside the user's allowed branches", async () => {
    vi.mocked(WarehouseRepository.findByIdWithLocations).mockResolvedValue({ id: "wh-1", companyId: "co-1", branchId: "branch-1" } as never);
    vi.mocked(PermissionService.getAllowedBranchIds).mockResolvedValue(new Set(["branch-1"]));

    const result = await getWarehouseById({ companyId: "co-1", userId: "user-1" }, "wh-1");
    expect(result.id).toBe("wh-1");
  });

  it("getWarehouseById throws NOT_FOUND for a warehouse outside the user's allowed branches", async () => {
    vi.mocked(WarehouseRepository.findByIdWithLocations).mockResolvedValue({ id: "wh-1", companyId: "co-1", branchId: "branch-2" } as never);
    vi.mocked(PermissionService.getAllowedBranchIds).mockResolvedValue(new Set(["branch-1"]));

    await expect(getWarehouseById({ companyId: "co-1", userId: "user-1" }, "wh-1")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("createWarehouse is blocked when the actor's own branch isn't in their allowed set", async () => {
    vi.mocked(PermissionService.getAllowedBranchIds).mockResolvedValue(new Set(["some-other-branch"]));

    await expect(
      createWarehouse(actor, { code: "WH-NEW", name: "New Warehouse", type: ["FABRIC"], isActive: true })
    ).rejects.toMatchObject({ code: "BRANCH_ACCESS_DENIED" });
    expect(WarehouseRepository.create).not.toHaveBeenCalled();
  });
});

describe("createWarehouse — staged Storage Locations (2026-09-02)", () => {
  it("creates the warehouse with no nested locations write when none are staged", async () => {
    await createWarehouse(actor, { code: "WH-NEW", name: "New Warehouse", type: ["FABRIC"], isActive: true });

    expect(WarehouseRepository.create).toHaveBeenCalledWith(
      expect.not.objectContaining({ locations: expect.anything() })
    );
    expect(WarehouseLocationRepository.findMany).not.toHaveBeenCalled();
  });

  it("rejects duplicate location codes within the staged batch before writing anything", async () => {
    await expect(
      createWarehouse(actor, {
        code: "WH-NEW",
        name: "New Warehouse",
        type: ["FABRIC"],
        isActive: true,
        locations: [
          { code: "ROOM-A", zone: "", rack: "", bin: "", materialCategory: "" },
          { code: "room-a", zone: "", rack: "", bin: "", materialCategory: "" },
        ],
      })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    expect(WarehouseRepository.create).not.toHaveBeenCalled();
  });

  it("creates staged locations via one nested write, atomic with the warehouse row", async () => {
    await createWarehouse(actor, {
      code: "WH-NEW",
      name: "New Warehouse",
      type: ["FABRIC", "TRIMS"],
      isActive: true,
      locations: [{ code: "ROOM-A", zone: "Block 1", rack: "", bin: "", materialCategory: "FABRIC" }],
    });

    expect(WarehouseRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        type: ["FABRIC", "TRIMS"],
        locations: {
          createMany: {
            data: [{ code: "ROOM-A", zone: "Block 1", rack: null, bin: null, materialCategory: "FABRIC", materialCategoryOther: null }],
          },
        },
      })
    );
  });

  it("writes one audit-log CREATE entry for the warehouse and one per staged location", async () => {
    vi.mocked(WarehouseLocationRepository.findMany).mockResolvedValue([
      { id: "loc-1", code: "ROOM-A" },
      { id: "loc-2", code: "ROOM-B" },
    ] as never);

    await createWarehouse(actor, {
      code: "WH-NEW",
      name: "New Warehouse",
      type: ["FABRIC"],
      isActive: true,
      locations: [
        { code: "ROOM-A", zone: "", rack: "", bin: "", materialCategory: "" },
        { code: "ROOM-B", zone: "", rack: "", bin: "", materialCategory: "" },
      ],
    });

    expect(writeAuditLog).toHaveBeenCalledTimes(3);
    expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ tableName: "warehouses", recordId: "wh-1" }));
    expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ tableName: "warehouse_locations", recordId: "loc-1" }));
    expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ tableName: "warehouse_locations", recordId: "loc-2" }));
  });
});

describe("updateWarehouse — multi-select Type", () => {
  it("replaces the type array with Prisma's scalar-list `set` shape, not a bare assignment", async () => {
    vi.mocked(WarehouseRepository.findByIdWithLocations).mockResolvedValue({ id: "wh-1", type: ["FABRIC"] } as never);
    vi.mocked(WarehouseRepository.update).mockResolvedValue({ id: "wh-1", type: ["FABRIC", "TRIMS"] } as never);

    await updateWarehouse(actor, "wh-1", { type: ["FABRIC", "TRIMS"] });

    expect(WarehouseRepository.update).toHaveBeenCalledWith("wh-1", expect.objectContaining({ type: { set: ["FABRIC", "TRIMS"] } }));
  });
});

// A location's "Please specify" note (materialCategoryOther) is only ever
// meaningful for a location actually tagged OTHER — resolveMaterialCategoryOther
// forces it to null otherwise, so a stale note can never survive a re-tag
// even via a direct API call that bypasses the UI's own clear-on-change
// behavior (ChildFormModal.tsx).
describe("createWarehouseLocation / updateWarehouseLocation — materialCategoryOther normalization", () => {
  it("persists the note when materialCategory is OTHER", async () => {
    await createWarehouseLocation(actor, "wh-1", {
      code: "ROOM-X",
      zone: "",
      rack: "",
      bin: "",
      materialCategory: "OTHER",
      materialCategoryOther: "Packing Machine Room",
    });

    expect(WarehouseLocationRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ materialCategory: "OTHER", materialCategoryOther: "Packing Machine Room" })
    );
  });

  it("forces the note to null when materialCategory isn't OTHER, even if the request supplies one", async () => {
    await createWarehouseLocation(actor, "wh-1", {
      code: "ROOM-X",
      zone: "",
      rack: "",
      bin: "",
      materialCategory: "FABRIC",
      materialCategoryOther: "This should never be saved",
    });

    expect(WarehouseLocationRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ materialCategory: "FABRIC", materialCategoryOther: null })
    );
  });

  it("scrubs an existing note when a PATCH moves materialCategory away from OTHER, even without mentioning the note field", async () => {
    vi.mocked(WarehouseLocationRepository.findByIdWithWarehouse).mockResolvedValue({
      id: "loc-1",
      warehouseId: "wh-1",
      materialCategory: "OTHER",
      materialCategoryOther: "Old Note",
      warehouse: { id: "wh-1", companyId: "co-1" },
    } as never);

    await updateWarehouseLocation(actor, "wh-1", "loc-1", { materialCategory: "FABRIC" });

    expect(WarehouseLocationRepository.update).toHaveBeenCalledWith(
      "loc-1",
      expect.objectContaining({ materialCategory: "FABRIC", materialCategoryOther: null })
    );
  });

  it("updates just the note against the row's existing OTHER category when materialCategory itself isn't part of the PATCH", async () => {
    vi.mocked(WarehouseLocationRepository.findByIdWithWarehouse).mockResolvedValue({
      id: "loc-1",
      warehouseId: "wh-1",
      materialCategory: "OTHER",
      materialCategoryOther: "Old Note",
      warehouse: { id: "wh-1", companyId: "co-1" },
    } as never);

    await updateWarehouseLocation(actor, "wh-1", "loc-1", { materialCategoryOther: "Updated Note" });

    expect(WarehouseLocationRepository.update).toHaveBeenCalledWith(
      "loc-1",
      expect.objectContaining({ materialCategoryOther: "Updated Note" })
    );
    expect(WarehouseLocationRepository.update).toHaveBeenCalledWith("loc-1", expect.not.objectContaining({ materialCategory: expect.anything() }));
  });

  it("leaves materialCategoryOther completely untouched when a PATCH mentions neither field", async () => {
    vi.mocked(WarehouseLocationRepository.findByIdWithWarehouse).mockResolvedValue({
      id: "loc-1",
      warehouseId: "wh-1",
      materialCategory: "OTHER",
      materialCategoryOther: "Old Note",
      warehouse: { id: "wh-1", companyId: "co-1" },
    } as never);

    await updateWarehouseLocation(actor, "wh-1", "loc-1", { zone: "New Zone" });

    expect(WarehouseLocationRepository.update).toHaveBeenCalledWith(
      "loc-1",
      expect.not.objectContaining({ materialCategoryOther: expect.anything() })
    );
  });
});
