import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
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
const { WarehouseRepository, WarehouseLocationRepository } = await import("./warehouse.repository");
const { createWarehouse, updateWarehouse } = await import("./warehouse.service");

const actor = { companyId: "co-1", branchId: "branch-1", userId: "user-1" };

beforeEach(() => {
  vi.mocked(writeAuditLog).mockReset();
  vi.mocked(WarehouseRepository.findByCodeInBranch).mockReset().mockResolvedValue(null);
  vi.mocked(WarehouseRepository.create)
    .mockReset()
    .mockResolvedValue({ id: "wh-1", code: "WH-NEW", name: "New Warehouse", type: ["FABRIC"] } as never);
  vi.mocked(WarehouseRepository.update).mockReset();
  vi.mocked(WarehouseLocationRepository.findMany).mockReset().mockResolvedValue([]);
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
            data: [{ code: "ROOM-A", zone: "Block 1", rack: null, bin: null, materialCategory: "FABRIC" }],
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
