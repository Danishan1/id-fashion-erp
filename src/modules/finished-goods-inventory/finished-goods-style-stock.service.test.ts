import { describe, expect, it, vi } from "vitest";

vi.mock("@/core/db/client", () => ({ prisma: {} }));

const { buildStyleColourGroups } = await import("./finished-goods-style-stock.service");
type Row = Parameters<typeof buildStyleColourGroups>[0][number];

const black = { id: "black", name: "Black", hexValue: "#000" };
const S = { id: "s", name: "S", sortOrder: 1 };
const M = { id: "m", name: "M", sortOrder: 2 };

function row(overrides: Partial<Row> = {}): Row {
  return { quantity: 10, stockStatus: "SALEABLE", color: black, size: S, warehouseId: "w1", warehouseName: "Godam", locationCode: "R1", ...overrides };
}

describe("buildStyleColourGroups", () => {
  it("groups by colour then size, sorted by size order, with saleable and rejected kept apart", () => {
    const [group] = buildStyleColourGroups([
      row({ size: M, quantity: 4 }),
      row({ quantity: 6 }),
      row({ quantity: 2, stockStatus: "REJECTED" }),
      row({ quantity: 3, locationCode: null }),
    ]);

    expect(group.colorName).toBe("Black");
    expect(group.sizes.map((s) => s.sizeName)).toEqual(["S", "M"]);
    expect(group.sizes[0]).toMatchObject({ saleableQuantity: 9, rejectedQuantity: 2 });
    expect(group.sizes[0].places).toEqual([
      { label: "Godam (no location)", quantity: 3 },
      { label: "Godam / R1", quantity: 8 },
    ]);
    expect(group).toMatchObject({ saleableQuantity: 13, rejectedQuantity: 2 });
  });

  it("puts stock with no variant in its own group, last, and drops zero rows", () => {
    const groups = buildStyleColourGroups([
      row({ color: null, size: null, quantity: 5 }),
      row({ color: { id: "white", name: "White", hexValue: null } }),
      row({ quantity: 0 }),
    ]);

    expect(groups.map((g) => g.colorName)).toEqual(["White", "No colour / size recorded"]);
    expect(groups[1].sizes[0]).toMatchObject({ sizeName: "—", saleableQuantity: 5 });
  });
});
