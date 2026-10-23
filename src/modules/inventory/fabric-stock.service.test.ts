import { describe, expect, it, vi } from "vitest";

vi.mock("@/core/db/client", () => ({ prisma: {} }));

const { buildFabricColourGroups } = await import("./fabric-stock.service");
type Roll = Parameters<typeof buildFabricColourGroups>[0][number];

const m = (id: string, name = id) => ({ id, code: id, name });

function roll(overrides: Partial<Roll> = {}): Roll {
  return {
    id: "r1",
    rollNumber: "1",
    batchNo: null,
    rollQuantity: 100,
    remainingQuantity: 100,
    color: { id: "sky", name: "Sky Blue", hexValue: "#87ceeb" },
    shade: { ...m("S02"), pantone: null },
    composition: m("cotton", "100% Cotton"),
    gsm: m("180", "180"),
    width: m("58", "58 in"),
    construction: m("jersey", "Single Jersey"),
    warehouseName: "Main",
    locationLabel: "A1",
    receiptNumber: "REC-1",
    ...overrides,
  };
}

describe("buildFabricColourGroups", () => {
  it("groups rolls by colour with totals from the rolls' remaining quantity", () => {
    const groups = buildFabricColourGroups([
      roll({ id: "a", rollNumber: "2", remainingQuantity: 60 }),
      roll({ id: "b", rollNumber: "10", shade: { ...m("S03"), pantone: null } }),
      roll({ id: "c", color: { id: "navy", name: "Navy Blue", hexValue: null }, remainingQuantity: 40 }),
    ]);

    expect(groups.map((g) => [g.colorName, g.rollCount, g.availableQuantity, g.shades])).toEqual([
      ["Navy Blue", 1, 40, ["S02"]],
      ["Sky Blue", 2, 160, ["S02", "S03"]],
    ]);
    expect(groups[1].initialQuantity).toBe(200);
    expect(groups[1].rolls.map((r) => r.rollNumber)).toEqual(["2", "10"]);
  });

  it("keeps rolls with a different GSM, width, composition or shade as separate spec groups", () => {
    const [sky] = buildFabricColourGroups([
      roll({ id: "a", remainingQuantity: 30 }),
      roll({ id: "b", remainingQuantity: 20 }),
      roll({ id: "c", gsm: m("220", "220"), remainingQuantity: 50 }),
      roll({ id: "d", width: m("44", "44 in"), remainingQuantity: 5 }),
    ]);

    expect(sky.specs).toHaveLength(3);
    const byGsm = sky.specs.find((s) => s.gsm === "220")!;
    expect(byGsm).toMatchObject({ rollCount: 1, availableQuantity: 50 });
    expect(sky.specs.find((s) => s.gsm === "180" && s.width === "58 in")).toMatchObject({ rollCount: 2, availableQuantity: 50 });
    expect(sky.specs.reduce((sum, s) => sum + s.availableQuantity, 0)).toBe(sky.availableQuantity);
  });

  it("puts rolls with no colour last and uses the receipt number when there is no batch", () => {
    const groups = buildFabricColourGroups([roll({ id: "a", color: null }), roll({ id: "b", batchNo: "B-7" })]);

    expect(groups.map((g) => g.colorName)).toEqual(["Sky Blue", "No colour recorded"]);
    expect(groups[0].rolls[0].lotNumber).toBe("B-7");
    expect(groups[1].rolls[0].lotNumber).toBe("REC-1");
  });

  it("returns no colours when there are no rolls", () => {
    expect(buildFabricColourGroups([])).toEqual([]);
  });
});
