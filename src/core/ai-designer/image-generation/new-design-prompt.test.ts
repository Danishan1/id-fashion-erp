import { describe, expect, it } from "vitest";
import { buildSketchEditPrompt, buildTemplateDressSwapPrompt, pickDesignDirections } from "./new-design-prompt";
import { SKETCH_OPTION_DEFINITIONS, SKETCH_STRUCTURE_OPTIONS } from "@/core/ai-designer/catalogs/sketch-structure-catalog";

describe("buildSketchEditPrompt", () => {
  it("sends a precise definition for every silhouette option", () => {
    const silhouettes = SKETCH_STRUCTURE_OPTIONS.find((g) => g.category === "silhouette")!.options;
    for (const value of silhouettes) {
      expect(SKETCH_OPTION_DEFINITIONS[value], value).toBeTruthy();
      const prompt = buildSketchEditPrompt({ garmentType: "Dress", structuralChanges: { silhouette: value }, viewAngle: "BOTH" });
      expect(prompt).toContain(`Silhouette → ${value}: ${SKETCH_OPTION_DEFINITIONS[value]}`);
    }
  });

  it("makes the change required and lets it remove conflicting tiers and gathers", () => {
    const prompt = buildSketchEditPrompt({ structuralChanges: { silhouette: "Straight / Column" }, viewAngle: "BOTH" });
    expect(prompt).toContain("REQUIRED CHANGES");
    expect(prompt).toMatch(/Remove or redraw any existing tiers, gathers/);
  });

  it("does not ask to preserve the silhouette while changing it", () => {
    const prompt = buildSketchEditPrompt({ structuralChanges: { silhouette: "A-Line" }, viewAngle: "BOTH" });
    const preserve = prompt.slice(prompt.indexOf("PRESERVE"));
    expect(preserve).not.toMatch(/silhouette/i);
    expect(preserve).toContain("neckline & collar");
    expect(preserve).toContain("sleeves");
  });

  it("keeps the silhouette when only the neckline changes", () => {
    const prompt = buildSketchEditPrompt({ structuralChanges: { neckline: "V-Neck" }, viewAngle: "BOTH" });
    const preserve = prompt.slice(prompt.indexOf("PRESERVE"));
    expect(preserve).toContain("silhouette");
    expect(preserve).not.toContain("neckline");
  });
});

const base = {
  garmentType: "Dress",
  targetCustomer: "Women",
  ageGroup: "25-40",
  designBrief: null,
  environmentLabel: "Studio White",
  environmentHint: null,
  keepTemplateBackground: true,
};

describe("pickDesignDirections", () => {
  it("returns the requested number of different directions", () => {
    for (const count of [1, 3, 4]) {
      const picked = pickDesignDirections("Dress", count, { hasBrief: false });
      expect(picked).toHaveLength(count);
      expect(new Set(picked).size).toBe(count);
    }
  });

  it("uses dress-specific directions, matched loosely by name", () => {
    const picked = pickDesignDirections("Maxi Dress", 4, { hasBrief: false });
    expect(picked.every((d) => /dress/i.test(d))).toBe(true);
  });

  it("falls back to generic directions for an unknown garment type", () => {
    const picked = pickDesignDirections("Cape", 4, { hasBrief: false });
    expect(picked).toHaveLength(4);
    expect(new Set(picked).size).toBe(4);
  });

  it("keeps option 1 faithful to the brief when a brief exists", () => {
    const picked = pickDesignDirections("Dress", 3, { hasBrief: true, random: () => 0.5 });
    expect(picked[0]).toMatch(/Faithful interpretation/);
    expect(new Set(picked).size).toBe(3);
  });

  it("gives a different set on another run (random selection)", () => {
    const a = pickDesignDirections("Dress", 3, { hasBrief: false, random: () => 0 });
    const b = pickDesignDirections("Dress", 3, { hasBrief: false, random: () => 0.99 });
    expect(a).not.toEqual(b);
  });
});

describe("buildTemplateDressSwapPrompt", () => {
  it("adds the design direction and the other options to avoid", () => {
    const prompt = buildTemplateDressSwapPrompt({
      ...base,
      variation: { optionNumber: 2, totalOptions: 3, direction: "Wrap dress: crossover V-neck.", otherDirections: ["Sheath dress.", "Tiered maxi dress."] },
    });
    expect(prompt).toContain("design option 2 of 3");
    expect(prompt).toContain("Design this option as: Wrap dress: crossover V-neck.");
    expect(prompt).toContain('"Sheath dress."; "Tiered maxi dress."');
    expect(prompt).toContain("Do NOT copy the silhouette, neckline, sleeves, or length of the garment in IMAGE 1");
  });

  it("has no direction section when no variation is given", () => {
    expect(buildTemplateDressSwapPrompt(base)).not.toContain("DESIGN DIRECTION");
  });
});
