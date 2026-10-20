import { describe, expect, it } from "vitest";
import { AI_PAGE_NUMBERS, displayPageNumber, gradedValue, isMasterTechPackJson, pageMode, validateMasterAnalysis, type MasterAnalysis } from "./schema";
import { buildTechPackPagePrompts } from "./page-prompts";

function analysis(overrides: Partial<MasterAnalysis> = {}): MasterAnalysis {
  const field = (label: string, value: string) => ({ label, value, status: "CONFIRMED" as const });
  return {
    garmentVisualDescription: "A lilac tiered midi dress with spaghetti straps and a smocked waist.",
    identification: [field("Brand name", "Indradhar"), field("Style name", "Lilac Tier Dress"), field("Style number", "AID-2026-00020"), field("Target season", "SS26"), field("Fit type", "Regular"), field("Designer", "Super Admin"), field("Date created", "2026-09-28")],
    construction: [field("Silhouette", "Fit-and-flare")],
    closure: [field("Closure", "Pullover — no closure")],
    seamCallouts: [{ number: 1, location: "Shoulder strap", specification: "Self-fabric tube, 1 cm", status: "PROPOSED" }],
    colors: [{ name: "Lilac", pantone: "15-3716 TCX", hex: "#C8A2C8", panel: "Body" }],
    colorways: [{ code: "CW01", name: "Lilac", main: "Lilac", contrast: "—", trim: "Lilac", artwork: "—", notes: "—" }],
    artwork: [],
    patternPrint: [field("Pattern", "Swiss dot")],
    bom: Array.from({ length: 14 }, (_, i) => ({
      item: `Item ${i + 1}`,
      description: `Description ${i + 1}`,
      composition: "100% Cotton",
      gsm: "180",
      color: "Lilac",
      consumption: "0.5 m",
      supplier: "TBD — supplier placeholder",
      notes: "—",
      status: "CONFIRMED" as const,
    })),
    sizes: ["XS", "S", "M", "L", "XL"],
    baseSize: "M",
    measurements: Array.from({ length: 8 }, (_, i) => ({
      code: String.fromCharCode(65 + i),
      pom: `POM ${i}`,
      howToMeasure: "Measure flat, edge to edge",
      tolerance: "± 1.0",
      baseValue: 50,
      gradeRule: 2,
      status: "CONFIRMED" as const,
    })),
    labelsPackaging: [field("Main label", "Woven, 5 × 2 cm, CB neck")],
    notesForDesigner: [],
    suggestedAdditionalViews: [],
    ...overrides,
  };
}

describe("master tech pack schema", () => {
  it("grades every size from the base value and grade rule", () => {
    const a = analysis();
    const m = { baseValue: 50, gradeRule: 2 };
    expect(a.sizes.map((s) => gradedValue(a, m, s))).toEqual([46, 48, 50, 52, 54]);
    expect(gradedValue(a, { baseValue: 40, gradeRule: 1.3 }, "XL")).toBe(42.5); // rounded to 0.5 cm
  });

  it("rejects a thin BOM or too few measurement points so the AI retries", () => {
    expect(validateMasterAnalysis(analysis({ bom: analysis().bom.slice(0, 10) }))).toMatchObject({ success: false });
    expect(validateMasterAnalysis(analysis({ measurements: analysis().measurements.slice(0, 5) }))).toMatchObject({ success: false });
    expect(validateMasterAnalysis(analysis())).toMatchObject({ success: true });
  });

  it("rejects any blank text column so the AI's corrective retry fills it in", () => {
    const bomWithBlank = analysis().bom;
    bomWithBlank[2] = { ...bomWithBlank[2], description: "" };
    const result = validateMasterAnalysis(analysis({ bom: bomWithBlank }));
    expect(result).toMatchObject({ success: false });
    expect((result as { error: string }).error).toContain("bom[2].description");

    const measurementsWithBlank = analysis().measurements;
    measurementsWithBlank[1] = { ...measurementsWithBlank[1], howToMeasure: "" };
    expect(validateMasterAnalysis(analysis({ measurements: measurementsWithBlank }))).toMatchObject({ success: false });

    const fieldsWithBlank = analysis().identification;
    fieldsWithBlank[0] = { ...fieldsWithBlank[0], value: "" };
    expect(validateMasterAnalysis(analysis({ identification: fieldsWithBlank }))).toMatchObject({ success: false });
  });

  it("does not flag a legitimate zero grade rule or an empty artwork array as blank", () => {
    const measurementsWithZeroGrade = analysis().measurements;
    measurementsWithZeroGrade[0] = { ...measurementsWithZeroGrade[0], gradeRule: 0, baseValue: 0 };
    expect(validateMasterAnalysis(analysis({ measurements: measurementsWithZeroGrade, artwork: [] }))).toMatchObject({ success: true });
  });

  it("keeps pages 1/2/7 as full AI images and pages 3/6 as an AI illustration plus the real typeset table", () => {
    expect(AI_PAGE_NUMBERS).toEqual([1, 2, 7]);
    expect([3, 6].map(pageMode)).toEqual(["HYBRID", "HYBRID"]);
    // Older tech packs' removed pages keep rendering as before: Colorways full image, Spec Table typeset.
    expect(pageMode(4)).toBe("AI");
    expect(pageMode(5)).toBe("HYBRID");
  });

  it("numbers pages by position, so the header reads 1-5 without the removed pages", () => {
    expect([1, 2, 3, 6, 7].map((n) => displayPageNumber(n))).toEqual([1, 2, 3, 4, 5]);
    // An older 7-page pack keeps its own numbering.
    expect(displayPageNumber(5, [1, 2, 3, 4, 5, 6, 7])).toBe(5);
  });

  it("still parses an older analysis that carries colours/artwork, and a new one without them", () => {
    const withoutColour = analysis() as Record<string, unknown>;
    delete withoutColour.colors;
    delete withoutColour.colorways;
    delete withoutColour.artwork;
    delete withoutColour.patternPrint;
    expect(validateMasterAnalysis(withoutColour)).toMatchObject({ success: true });
    expect(validateMasterAnalysis(analysis())).toMatchObject({ success: true });
  });

  it("tags the stored JSON so older table-based tech packs are distinguishable", () => {
    expect(isMasterTechPackJson({ format: "MASTER_V1", analysis: analysis() })).toBe(true);
    expect(isMasterTechPackJson({ part1: {} })).toBe(false);
    expect(isMasterTechPackJson(null)).toBe(false);
  });
});

describe("buildTechPackPagePrompts", () => {
  it("builds 5 pages (no Colorways or Spec Table page) sharing the same header data", () => {
    const pages = buildTechPackPagePrompts(analysis());
    expect(pages.map((p) => p.pageNumber)).toEqual([1, 2, 3, 6, 7]);
    expect(pages.some((p) => /COLORWAYS|SPEC TABLE/.test(p.pageTitle))).toBe(false);
    pages.forEach((p, i) => {
      expect(p.promptText).toContain(`"PAGE ${i + 1} — ${p.pageTitle}"`);
      expect(p.promptText).toContain(`"${i + 1} of 5"`);
      expect(p.promptText).toContain("AID-2026-00020");
      expect(p.promptText).toContain("pure white background");
      expect(p.promptText).toContain("ALL MEASUREMENTS IN CENTIMETERS (CM) UNLESS OTHERWISE SPECIFIED. TOLERANCES APPLY.");
    });
  });

  it("asks the AI for an illustration only on pages 3/6, never the real BOM/grade numbers (so the image can't scramble them)", () => {
    const pages = buildTechPackPagePrompts(analysis());
    const page = (n: number) => pages.find((p) => p.pageNumber === n)!;
    expect(page(3).promptText).not.toMatch(/\| \d+ \| Item/);
    expect(page(6).promptText).not.toMatch(/±\s*\d/);
    expect(page(6).promptText).not.toMatch(/\| Grade Rule \|/);
  });

});
