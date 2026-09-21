import { describe, expect, it } from "vitest";
import {
  computeContainFitRect,
  computeGradeRules,
  findColorHexForBomRow,
  mapCalloutPositionToBoxPercent,
  resolveColorHex,
  tryParseNumberedSteps,
} from "./tech-pack-format";

function point(pointName: string, values: Partial<Record<string, string>>) {
  return { pointName, values: { XS: "", S: "", M: "", L: "", XL: "", XXL: "", ...values } };
}

describe("computeGradeRules", () => {
  it("returns an empty array for an empty measurementPoints list", () => {
    expect(computeGradeRules([])).toEqual([]);
  });

  it("reports a consistent grade rule when every adjacent step increases by the same amount", () => {
    const rows = computeGradeRules([point("Chest Width", { XS: "48 cm", S: "51 cm", M: "54 cm", L: "57 cm", XL: "60 cm", XXL: "63 cm" })]);
    expect(rows).toEqual([{ pointName: "Chest Width", grade: "+3 cm" }]);
  });

  it("reports a negative grade rule correctly", () => {
    const rows = computeGradeRules([point("Neck Drop", { XS: "10 cm", S: "9 cm", M: "8 cm", L: "7 cm", XL: "6 cm", XXL: "5 cm" })]);
    expect(rows).toEqual([{ pointName: "Neck Drop", grade: "-1 cm" }]);
  });

  it("reports Non-linear when deltas disagree beyond tolerance", () => {
    const rows = computeGradeRules([point("Odd Point", { XS: "10 cm", S: "12 cm", M: "13 cm", L: "16 cm", XL: "18 cm", XXL: "20 cm" })]);
    expect(rows).toEqual([{ pointName: "Odd Point", grade: "Non-linear — see full chart" }]);
  });

  it("renders — for a point with a non-numeric value (e.g. TBC)", () => {
    const rows = computeGradeRules([point("Unclear Point", { XS: "TBC", S: "51 cm", M: "54 cm", L: "57 cm", XL: "60 cm", XXL: "63 cm" })]);
    expect(rows).toEqual([{ pointName: "Unclear Point", grade: "—" }]);
  });

  it("renders — for a point missing a size key entirely", () => {
    const incomplete = { pointName: "Missing Key", values: { XS: "48 cm", S: "51 cm", M: "54 cm", L: "57 cm", XL: "60 cm" } };
    const rows = computeGradeRules([incomplete]);
    expect(rows).toEqual([{ pointName: "Missing Key", grade: "—" }]);
  });

  it("tolerates values without a unit suffix (e.g. '57cm' or bare '57')", () => {
    const rows = computeGradeRules([point("No Space", { XS: "48cm", S: "51cm", M: "54cm", L: "57cm", XL: "60cm", XXL: "63cm" })]);
    expect(rows).toEqual([{ pointName: "No Space", grade: "+3 cm" }]);
  });
});

describe("resolveColorHex", () => {
  it("prefers an explicit valid hex estimate", () => {
    expect(resolveColorHex({ hexEstimate: "Approx. #1A2B3C", colorName: "Mustard" })).toBe("#1A2B3C");
  });

  it("falls back to a common color-name dictionary when no hex is present", () => {
    expect(resolveColorHex({ hexEstimate: "", colorName: "Navy Blue" })).toBe("#1F2A44");
  });

  it("matches a common color name case-insensitively as a substring", () => {
    expect(resolveColorHex({ colorName: "Deep Maroon Shade" })).toBe("#800000");
  });

  it("returns null when nothing resolves — never fabricates a hex", () => {
    expect(resolveColorHex({ hexEstimate: "not a hex", colorName: "Iridescent Unicorn Shimmer" })).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(resolveColorHex({})).toBeNull();
  });
});

describe("findColorHexForBomRow", () => {
  const visibleColors = [{ colorName: "Mustard Yellow", hexEstimate: "#E1AD01" }];

  it("matches a BOM row's color against the visible-colors list and resolves its hex", () => {
    expect(findColorHexForBomRow("Mustard", visibleColors)).toBe("#E1AD01");
  });

  it("returns null when no BOM color is given", () => {
    expect(findColorHexForBomRow("", visibleColors)).toBeNull();
  });

  it("returns null when nothing matches", () => {
    expect(findColorHexForBomRow("Cobalt Blue", visibleColors)).toBeNull();
  });
});

describe("tryParseNumberedSteps", () => {
  it("splits genuinely numbered instructions into discrete steps", () => {
    const steps = tryParseNumberedSteps("1. Fold sleeves inward. 2. Fold sides inward. 3. Fold pant upwardly.");
    expect(steps).toEqual(["Fold sleeves inward.", "Fold sides inward.", "Fold pant upwardly."]);
  });

  it("returns null for plain prose with no numbered separators", () => {
    expect(tryParseNumberedSteps("Fold arms behind, fold in half vertically, insert into polybag.")).toBeNull();
  });

  it("returns null when only a single numbered marker exists (ambiguous, not a real list)", () => {
    expect(tryParseNumberedSteps("1. Only one step is mentioned here, nothing else follows.")).toBeNull();
  });
});

describe("computeContainFitRect", () => {
  it("letterboxes left/right for a portrait photo in a wide landscape box (the common AI Designer case)", () => {
    // A 3:4 portrait photo (900x1200) inside a 547.28x220 box: the box is far wider
    // than the photo, so the photo fills the full box HEIGHT and is centered horizontally.
    const rect = computeContainFitRect(900, 1200, 547.28, 220);
    expect(rect.yPercent).toBe(0);
    expect(rect.heightPercent).toBe(100);
    expect(rect.widthPercent).toBeCloseTo((220 * (900 / 1200) / 547.28) * 100, 5);
    expect(rect.xPercent).toBeCloseTo((100 - rect.widthPercent) / 2, 5);
  });

  it("letterboxes top/bottom for a very wide panoramic photo in a shorter box", () => {
    // A 3:1 photo inside the same box, which is only ~2.49:1 -- the photo is
    // proportionally WIDER than the box, so it fills the full box WIDTH.
    const rect = computeContainFitRect(1500, 500, 547.28, 220);
    expect(rect.xPercent).toBe(0);
    expect(rect.widthPercent).toBe(100);
    expect(rect.heightPercent).toBeLessThan(100);
  });

  it("returns a full, unadjusted rect when dimensions are unknown (safe fallback, no letterboxing assumed)", () => {
    expect(computeContainFitRect(0, 0, 547.28, 220)).toEqual({ xPercent: 0, yPercent: 0, widthPercent: 100, heightPercent: 100 });
  });

  it("returns a full rect for an image whose aspect ratio exactly matches the box (no letterboxing needed)", () => {
    const rect = computeContainFitRect(547.28, 220, 547.28, 220);
    expect(rect).toEqual({ xPercent: 0, yPercent: 0, widthPercent: 100, heightPercent: 100 });
  });
});

describe("mapCalloutPositionToBoxPercent", () => {
  it("maps a position at the photo's exact center to the visually correct spot within a letterboxed rect", () => {
    const rect = computeContainFitRect(900, 1200, 547.28, 220); // portrait photo, letterboxed left/right
    const { left, top } = mapCalloutPositionToBoxPercent({ xPercent: 50, yPercent: 50 }, rect);
    expect(left).toBeCloseTo(50, 5); // horizontal center of a horizontally-centered rect is still the box's own center
    expect(top).toBeCloseTo(50, 5); // no vertical letterboxing in this case, so 50% of the photo is 50% of the box
  });

  it("keeps a pin inside the visible photo area, never in the empty letterbox margin", () => {
    const rect = computeContainFitRect(900, 1200, 547.28, 220);
    const { left } = mapCalloutPositionToBoxPercent({ xPercent: 0, yPercent: 0 }, rect); // the photo's own left edge
    expect(left).toBeCloseTo(rect.xPercent, 5); // lands exactly at the start of the visible (non-letterboxed) region, not at box x=0
    expect(left).toBeGreaterThan(0); // proves the fix: without it, this would incorrectly be 0 (the box's own edge, inside the empty margin)
  });

  it("maps 1:1 when there is no letterboxing at all", () => {
    const rect = { xPercent: 0, yPercent: 0, widthPercent: 100, heightPercent: 100 };
    expect(mapCalloutPositionToBoxPercent({ xPercent: 30, yPercent: 70 }, rect)).toEqual({ left: 30, top: 70 });
  });
});
