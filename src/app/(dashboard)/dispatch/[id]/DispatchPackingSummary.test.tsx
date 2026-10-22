// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PickedVsPackedSummary, SavedCartonsSummary } from "./DispatchPackingSummary";

afterEach(() => cleanup());

const v = (color: string, size: string) => ({ color: { name: color }, size: { name: size } });

const items = [
  {
    id: "di-1",
    product: { styleName: "Formal shirt", styleCode: "ST-00013" },
    orderedVariants: [
      { productVariantId: "var-bs", colorName: "Black", sizeName: "S", orderedQuantity: 3 },
      { productVariantId: "var-bm", colorName: "Black", sizeName: "M", orderedQuantity: 3 },
    ],
    pickLines: [
      { productVariantId: "var-bs", quantity: 3, productVariant: v("Black", "S") },
      { productVariantId: "var-bm", quantity: 3, productVariant: v("Black", "M") },
    ],
  },
];

const cartons = [
  { id: "c1", cartonNumber: 1, totalQuantity: 4, items: [
    { dispatchItemId: "di-1", productVariantId: "var-bs", quantity: 3, productVariant: v("Black", "S") },
    { dispatchItemId: "di-1", productVariantId: "var-bm", quantity: 1, productVariant: v("Black", "M") },
  ] },
  { id: "c2", cartonNumber: 2, totalQuantity: 1, items: [
    { dispatchItemId: "di-1", productVariantId: "var-bm", quantity: 1, productVariant: v("Black", "M") },
  ] },
];

describe("SavedCartonsSummary", () => {
  it("shows each saved carton with its colour/sizes, pieces and total", () => {
    render(<SavedCartonsSummary items={items} cartons={cartons} />);

    expect(screen.getByText("2 cartons saved · 5 pcs in total")).toBeTruthy();
    const carton1 = screen.getByText("Carton 1").closest("div.rounded-lg") as HTMLElement;
    expect(within(carton1).getByText("4 pcs")).toBeTruthy();
    expect(within(carton1).getByText("Black / S")).toBeTruthy();
    expect(within(carton1).getAllByText("ST-00013")).toHaveLength(2);
  });

  it("says when nothing is saved", () => {
    render(<SavedCartonsSummary items={items} cartons={[]} />);
    expect(screen.getByText("No cartons saved yet.")).toBeTruthy();
  });
});

describe("PickedVsPackedSummary", () => {
  it("compares picked and packed per colour/size and flags the difference", () => {
    render(<PickedVsPackedSummary items={items} cartons={cartons} />);

    expect(screen.getByText("Picked and packed don't match yet")).toBeTruthy();
    const blackM = screen.getByText("Black / M").closest("tr") as HTMLElement;
    expect(within(blackM).getByText("1 not in a carton")).toBeTruthy();
    const blackS = screen.getByText("Black / S").closest("tr") as HTMLElement;
    expect(within(blackS).getByText("✓")).toBeTruthy();
  });

  it("shows all packed when every picked piece is in a carton", () => {
    const full = [{ ...cartons[0], totalQuantity: 6, items: [cartons[0].items[0], { ...cartons[0].items[1], quantity: 3 }] }];
    render(<PickedVsPackedSummary items={items} cartons={full} />);
    expect(screen.getByText("All picked pieces are packed")).toBeTruthy();
  });
});
