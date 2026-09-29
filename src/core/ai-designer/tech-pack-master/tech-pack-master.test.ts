import { describe, expect, it } from "vitest";
import { AI_PAGE_NUMBERS, gradedValue, isMasterTechPackJson, pageMode, validateMasterAnalysis, type MasterAnalysis } from "./schema";
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

  it("typesets the table-heavy pages and leaves the drawing pages to the AI", () => {
    expect(AI_PAGE_NUMBERS).toEqual([1, 2, 4, 7]);
    expect([3, 5, 6].map(pageMode)).toEqual(["TYPESET", "TYPESET", "TYPESET"]);
  });

  it("tags the stored JSON so older table-based tech packs are distinguishable", () => {
    expect(isMasterTechPackJson({ format: "MASTER_V1", analysis: analysis() })).toBe(true);
    expect(isMasterTechPackJson({ part1: {} })).toBe(false);
    expect(isMasterTechPackJson(null)).toBe(false);
  });
});

describe("buildTechPackPagePrompts", () => {
  it("builds exactly 7 pages sharing the same header data", () => {
    const pages = buildTechPackPagePrompts(analysis());
    expect(pages.map((p) => p.pageNumber)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    for (const p of pages) {
      expect(p.promptText).toContain(`"PAGE ${p.pageNumber} — ${p.pageTitle}"`);
      expect(p.promptText).toContain(`"${p.pageNumber} of 7"`);
      expect(p.promptText).toContain("AID-2026-00020");
      expect(p.promptText).toContain("pure white background");
      expect(p.promptText).toContain("ALL MEASUREMENTS IN CENTIMETERS (CM) UNLESS OTHERWISE SPECIFIED. TOLERANCES APPLY.");
    }
  });

  it("puts the computed grade table on page 6 and a black-and-white diagram on page 5", () => {
    const pages = buildTechPackPagePrompts(analysis());
    expect(pages[5].promptText).toContain("| A | POM 0 | 46 | 48 | 50 | 52 | 54 | ± 2 |");
    expect(pages[4].promptText).toContain("BLACK-AND-WHITE line-art measurement diagram");
    expect(pages[2].promptText.match(/\| \d+ \| Item/g)?.length).toBe(14);
  });

  it("states NO ARTWORK when the garment has none", () => {
    expect(buildTechPackPagePrompts(analysis())[3].promptText).toContain("NO ARTWORK APPLIED");
  });
});
