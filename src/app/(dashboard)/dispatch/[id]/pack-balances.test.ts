import { describe, expect, it } from "vitest";
import { computePackBalances } from "./DispatchWorkflowPanel";

const items = [
  {
    id: "di-1",
    orderedVariants: [
      { productVariantId: "bs", colorName: "Black", sizeName: "S", orderedQuantity: 6, availableQuantity: 6 },
      { productVariantId: "bm", colorName: "Black", sizeName: "M", orderedQuantity: 4, availableQuantity: 3 },
    ],
  },
];

describe("computePackBalances", () => {
  it("leaves only the unpacked half after carton 1 holds the other half", () => {
    const picks = [
      { dispatchItemId: "di-1", productVariantId: "bs", quantity: "6" },
      { dispatchItemId: "di-1", productVariantId: "bm", quantity: "3" },
    ];
    const cartons = [{ items: [{ dispatchItemId: "di-1", productVariantId: "bs", quantity: "3" }] }];
    const rows = computePackBalances(items, picks, cartons);
    expect(rows.map((r) => [r.productVariantId, r.toPack - r.packed, r.inStock])).toEqual([
      ["bs", 3, 6],
      ["bm", 3, 3],
    ]);
  });

  it("uses the ordered quantity when nothing is picked yet", () => {
    const rows = computePackBalances(items, [], []);
    expect(rows.map((r) => r.toPack)).toEqual([6, 4]);
  });
});
