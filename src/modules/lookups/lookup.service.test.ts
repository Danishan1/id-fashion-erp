import { beforeEach, describe, expect, it, vi } from "vitest";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/core/db/client", () => ({
  prisma: {
    color: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    size: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    unitOfMeasure: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  },
}));

const { prisma } = await import("@/core/db/client");
const { createColor, updateColor, createSize, updateSize, createUnit, updateUnit } = await import("./lookup.service");

const actor = { companyId: "co-1", userId: "user-1" };

beforeEach(() => {
  vi.mocked(prisma.color.findFirst).mockReset();
  vi.mocked(prisma.color.create).mockReset().mockResolvedValue({ id: "color-1" } as never);
  vi.mocked(prisma.color.update).mockReset().mockResolvedValue({ id: "color-1" } as never);
  vi.mocked(prisma.size.findFirst).mockReset();
  vi.mocked(prisma.size.create).mockReset().mockResolvedValue({ id: "size-1" } as never);
  vi.mocked(prisma.size.update).mockReset().mockResolvedValue({ id: "size-1" } as never);
  vi.mocked(prisma.unitOfMeasure.findFirst).mockReset();
  vi.mocked(prisma.unitOfMeasure.findUnique).mockReset();
  vi.mocked(prisma.unitOfMeasure.create).mockReset().mockResolvedValue({ id: "unit-1" } as never);
  vi.mocked(prisma.unitOfMeasure.update).mockReset().mockResolvedValue({ id: "unit-1" } as never);
});

// Regression tests for the P3 fix: isActive previously had a Zod
// `.default(true)`, so the regular "Edit" form (which never sends this
// field — only the dedicated Active/Inactive toggle does) silently
// reactivated an already-deactivated record on every ordinary edit.
describe("isActive preserved across an ordinary edit, for every lookup entity", () => {
  it("color: create defaults to active when omitted", async () => {
    vi.mocked(prisma.color.findFirst).mockResolvedValue(null);
    await createColor(actor, { code: "RED", name: "Red" } as never);
    expect(prisma.color.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ isActive: true }) }));
  });

  it("color: update preserves existing isActive when omitted from the payload", async () => {
    vi.mocked(prisma.color.findFirst).mockResolvedValueOnce({ id: "color-1", isActive: false } as never).mockResolvedValueOnce(null);
    await updateColor(actor, "color-1", { code: "RED", name: "Red" } as never);
    expect(prisma.color.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ isActive: false }) }));
  });

  it("color: update still applies an explicit isActive (the toggle's own flow)", async () => {
    vi.mocked(prisma.color.findFirst).mockResolvedValueOnce({ id: "color-1", isActive: false } as never).mockResolvedValueOnce(null);
    await updateColor(actor, "color-1", { code: "RED", name: "Red", isActive: true } as never);
    expect(prisma.color.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ isActive: true }) }));
  });

  it("size: create defaults to active when omitted", async () => {
    vi.mocked(prisma.size.findFirst).mockResolvedValue(null);
    await createSize(actor, { code: "M", name: "Medium", sortOrder: 1 } as never);
    expect(prisma.size.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ isActive: true }) }));
  });

  it("size: update preserves existing isActive when omitted from the payload", async () => {
    vi.mocked(prisma.size.findFirst).mockResolvedValueOnce({ id: "size-1", isActive: false } as never).mockResolvedValueOnce(null);
    await updateSize(actor, "size-1", { code: "M", name: "Medium", sortOrder: 1 } as never);
    expect(prisma.size.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ isActive: false }) }));
  });

  it("unit: create defaults to active when omitted", async () => {
    vi.mocked(prisma.unitOfMeasure.findFirst).mockResolvedValue(null);
    await createUnit(actor, { code: "PCS", name: "Pieces", conversionFactor: 1 } as never);
    expect(prisma.unitOfMeasure.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ isActive: true }) }));
  });

  it("unit: update preserves existing isActive when omitted from the payload", async () => {
    vi.mocked(prisma.unitOfMeasure.findUnique).mockResolvedValue({ id: "unit-1", isActive: false, baseUnitId: null } as never);
    vi.mocked(prisma.unitOfMeasure.findFirst).mockResolvedValueOnce(null);
    await updateUnit(actor, "unit-1", { code: "PCS", name: "Pieces", conversionFactor: 1 } as never);
    expect(prisma.unitOfMeasure.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ isActive: false }) }));
  });

  it("unit: update rejects a unit id that doesn't exist, instead of a raw Prisma error", async () => {
    vi.mocked(prisma.unitOfMeasure.findUnique).mockResolvedValue(null);
    await expect(updateUnit(actor, "unit-missing", { code: "PCS", name: "Pieces", conversionFactor: 1 } as never)).rejects.toBeInstanceOf(
      BusinessRuleError
    );
    expect(prisma.unitOfMeasure.update).not.toHaveBeenCalled();
  });
});

describe("colour names are unique per company", () => {
  it("refuses a new colour whose name already exists, ignoring case and spaces", async () => {
    vi.mocked(prisma.color.findFirst).mockResolvedValueOnce(null).mockResolvedValueOnce({ code: "NVY", isActive: true } as never);

    await expect(createColor(actor, { code: "NAVY-2", name: "  navy blue " } as never)).rejects.toMatchObject({
      message: expect.stringContaining("NVY"),
    });
    expect(prisma.color.findFirst).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ name: { equals: "navy blue", mode: "insensitive" } }) })
    );
    expect(prisma.color.create).not.toHaveBeenCalled();
  });

  it("lets a colour keep its own name when edited, but not take another colour's", async () => {
    vi.mocked(prisma.color.findFirst).mockResolvedValueOnce({ id: "color-1", isActive: true } as never).mockResolvedValueOnce(null);
    await updateColor(actor, "color-1", { code: "RED", name: "Red" } as never);
    expect(prisma.color.findFirst).toHaveBeenLastCalledWith(expect.objectContaining({ where: expect.objectContaining({ NOT: { id: "color-1" } }) }));

    vi.mocked(prisma.color.findFirst).mockResolvedValueOnce({ id: "color-1", isActive: true } as never).mockResolvedValueOnce({ code: "BLACK", isActive: true } as never);
    await expect(updateColor(actor, "color-1", { code: "RED", name: "Black" } as never)).rejects.toBeInstanceOf(BusinessRuleError);
  });
});

describe("size names are unique per company", () => {
  it("refuses a new size whose name already exists, ignoring case and spaces", async () => {
    vi.mocked(prisma.size.findFirst).mockResolvedValueOnce(null).mockResolvedValueOnce({ code: "XL", isActive: true } as never);

    await expect(createSize(actor, { code: "X-LARGE", name: "  extra large ", sortOrder: 4 } as never)).rejects.toMatchObject({
      message: expect.stringContaining("XL"),
    });
    expect(prisma.size.findFirst).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ name: { equals: "extra large", mode: "insensitive" } }) })
    );
    expect(prisma.size.create).not.toHaveBeenCalled();
  });

  it("lets a size keep its own name when edited, but not take another size's", async () => {
    vi.mocked(prisma.size.findFirst).mockResolvedValueOnce({ id: "size-1", isActive: true } as never).mockResolvedValueOnce(null);
    await updateSize(actor, "size-1", { code: "M", name: "Medium", sortOrder: 2 } as never);
    expect(prisma.size.findFirst).toHaveBeenLastCalledWith(expect.objectContaining({ where: expect.objectContaining({ NOT: { id: "size-1" } }) }));

    vi.mocked(prisma.size.findFirst).mockResolvedValueOnce({ id: "size-1", isActive: true } as never).mockResolvedValueOnce({ code: "L", isActive: true } as never);
    await expect(updateSize(actor, "size-1", { code: "M", name: "Large", sortOrder: 2 } as never)).rejects.toBeInstanceOf(BusinessRuleError);
  });
});

describe("unit names are globally unique", () => {
  it("refuses a new unit whose name already exists, ignoring case and spaces", async () => {
    vi.mocked(prisma.unitOfMeasure.findFirst).mockResolvedValueOnce({ code: "BOX", isActive: true } as never);

    await expect(createUnit(actor, { code: "BOX-2", name: "  box  ", conversionFactor: 1 } as never)).rejects.toMatchObject({
      message: expect.stringContaining("BOX"),
    });
    expect(prisma.unitOfMeasure.findFirst).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ name: { equals: "box", mode: "insensitive" } }) })
    );
    expect(prisma.unitOfMeasure.create).not.toHaveBeenCalled();
  });

  it("lets a unit keep its own name when edited, but not take another unit's", async () => {
    vi.mocked(prisma.unitOfMeasure.findUnique).mockResolvedValue({ id: "unit-1", isActive: true, baseUnitId: null } as never);
    vi.mocked(prisma.unitOfMeasure.findFirst).mockResolvedValueOnce(null);
    await updateUnit(actor, "unit-1", { code: "BOX", name: "Box", conversionFactor: 1 } as never);
    expect(prisma.unitOfMeasure.findFirst).toHaveBeenLastCalledWith(expect.objectContaining({ where: expect.objectContaining({ NOT: { id: "unit-1" } }) }));

    vi.mocked(prisma.unitOfMeasure.findUnique).mockResolvedValue({ id: "unit-1", isActive: true, baseUnitId: null } as never);
    vi.mocked(prisma.unitOfMeasure.findFirst).mockResolvedValueOnce({ code: "KG", isActive: true } as never);
    await expect(updateUnit(actor, "unit-1", { code: "BOX", name: "Kilogram", conversionFactor: 1 } as never)).rejects.toBeInstanceOf(BusinessRuleError);
  });
});
