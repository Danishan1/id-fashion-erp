import { gradedValue, MASTER_PAGE_DEFINITIONS, type MasterAnalysis, type MasterField } from "./schema";

/**
 * Builds the 7 tech-pack page image prompts from the (possibly user-edited)
 * analysis. Built in code, not by the AI, so all 7 pages carry byte-identical
 * style numbers, measurements, colours and terminology — the master prompt's
 * own "CRITICAL CONSISTENCY RULES". Each prompt is sent together with the
 * garment's own design photo as a reference image.
 */

const GLOBAL_VISUAL_RULES = `Create a professional garment tech pack page — a factory-ready apparel specification sheet and fashion technical design document, clean production document layout, high-resolution print-ready page.
Visual rules: pure white background; professional technical document layout; minimal luxury factory tech pack aesthetic; thin black divider lines; thin gray table borders; Helvetica / Arial style typography; clean spacing and alignment; no decorative graphics; no gradients; no shadows; no mockup scene; no folded garments; flat orthographic garment CAD views only; supplier-document visual quality; fashion CAD style; ultra-sharp, legible text rendering with every word spelled exactly as given; precise table alignment; realistic garment rendering; editorially clean composition. Portrait page orientation.`;

const FOOTER_TEXT = "ALL MEASUREMENTS IN CENTIMETERS (CM) UNLESS OTHERWISE SPECIFIED. TOLERANCES APPLY.";

const MISSING_VALUE = /^(tbc|tbd|n\/?a|none|unknown|not set|not visible|not specified|-|—)$/i;

function val(fields: MasterField[], label: string): string {
  const f = fields.find((x) => x.label.toLowerCase().includes(label.toLowerCase()));
  const v = f?.value?.trim() ?? "";
  return !v || MISSING_VALUE.test(v) || f?.status === "NOT_VISIBLE" ? "TBC" : v;
}

function shown(v: string): string {
  return v && !MISSING_VALUE.test(v.trim()) ? v : "TBC";
}

function list(fields: MasterField[]): string {
  return fields.map((f) => `${f.label}: ${f.value || "TBC"}`).join("; ");
}

function header(a: MasterAnalysis, pageNumber: number, title: string): string {
  const brand = val(a.identification, "brand");
  const styleNo = val(a.identification, "style number");
  const styleName = val(a.identification, "style name");
  const brandArea = brand === "TBC" ? "an empty rectangular brand logo placeholder box (no text inside)" : `a brand logo area reading "${brand}"`;
  return `PAGE HEADER: top-left text "PAGE ${pageNumber} — ${title}", top-right text "${pageNumber} of 7". Below the header: ${brandArea} and a small brand info block: Style No. ${styleNo} · Style Name ${styleName} · Season ${val(a.identification, "season")} · Base Size ${a.baseSize}.
Spell every word and number exactly as written in this prompt; copy dates character by character.
PAGE FOOTER: italic small text "${FOOTER_TEXT}"`;
}

function garmentRef(a: MasterAnalysis): string {
  return `THE GARMENT (use the supplied reference image as the exact garment — same silhouette, construction, colours and print; redraw it as flat orthographic CAD views, never as a photo of a person): ${a.garmentVisualDescription}`;
}

function table(headers: string[], rows: string[][]): string {
  return `| ${headers.join(" | ")} |\n${rows.map((r) => `| ${r.join(" | ")} |`).join("\n")}`;
}

function page1(a: MasterAnalysis): string {
  return `${GLOBAL_VISUAL_RULES}

${header(a, 1, "COVER PAGE / STYLE SUMMARY")}

${garmentRef(a)}

PAGE CONTENT — COVER PAGE / STYLE SUMMARY:
1. Large full-color, realistic fashion CAD technical flats of the garment: FRONT view and BACK view side by side, orthographic, visible seam construction and trims, accurate proportions and artwork placement, supplier-level technical flats.
2. Style info table:
${table(["Field", "Value"], a.identification.map((f) => [f.label, shown(f.value)]))}
3. Revision history table:
${table(["Rev", "Date", "Description", "By"], [["01", val(a.identification, "date"), "Initial tech pack", val(a.identification, "designer")]])}
4. Style summary paragraph: ${a.garmentVisualDescription}
5. Key specs row (small boxes): Fit ${val(a.identification, "fit")} · Closure ${a.closure[0]?.value || "TBC"} · Main fabric ${a.bom[0]?.description || "TBC"} ${a.bom[0]?.gsm || ""} · Base size ${a.baseSize}.`;
}

function page2(a: MasterAnalysis): string {
  return `${GLOBAL_VISUAL_RULES}

${header(a, 2, "CONSTRUCTION & DETAIL CALLOUTS")}

${garmentRef(a)}

PAGE CONTENT — CONSTRUCTION & DETAIL CALLOUTS:
1. Full-color front and back technical CAD flats of the garment with thin numbered callout lines (circled numbers 1–${a.seamCallouts.length}) pointing to each location below.
2. Construction legend table:
${table(
  ["#", "Location", "Technical Specification", "Status"],
  a.seamCallouts.map((c) => [String(c.number), c.location, c.specification, c.status])
)}
3. Small technical seam detail sketches (cross-section line drawings) for the key seams.
4. Construction notes: ${list(a.construction)}. Closure: ${list(a.closure)}.
5. Reinforcement notes: bartack at stress points; secure all thread ends.`;
}

function page3(a: MasterAnalysis): string {
  return `${GLOBAL_VISUAL_RULES}

${header(a, 3, "BILL OF MATERIALS / BOM")}

PAGE CONTENT — BILL OF MATERIALS / BOM (a full-width table is the main element; a small thumbnail CAD flat of the garment in the top-right corner):
${table(
  ["#", "Item", "Description", "Composition", "GSM", "Color", "Consumption", "Supplier", "Notes"],
  a.bom.map((b, i) => [String(i + 1), b.item, b.description, b.composition, b.gsm, b.color, b.consumption, b.supplier || "TBD", b.notes])
)}
Below the table: "MATERIAL NOTES" and "QUALITY NOTES" boxes — all materials to meet buyer quality standards; shade band approval before bulk; colour fastness and shrinkage tests required.`;
}

function page4(a: MasterAnalysis): string {
  return `${GLOBAL_VISUAL_RULES}

${header(a, 4, "COLORWAYS & ARTWORK PLACEMENT")}

${garmentRef(a)}

PAGE CONTENT — COLORWAYS & ARTWORK PLACEMENT:
1. Colorway chart: one row per colorway, each with a small FULL-COLOR front technical flat of the garment recoloured in that colorway, plus solid color swatches:
${table(
  ["Code", "Colorway", "Main", "Contrast", "Trim", "Artwork", "Notes"],
  a.colorways.map((c) => [c.code, c.name, c.main, c.contrast, c.trim, c.artwork, c.notes])
)}
2. Color reference table with swatches:
${table(["Color", "Pantone", "HEX", "Panel"], a.colors.map((c) => [c.name, c.pantone, c.hex, c.panel]))}
3. Artwork reference table:
${
  a.artwork.length
    ? table(
        ["Type", "Placement", "Scale", "Dimensions", "Method", "From HPS", "From CF", "Alignment"],
        a.artwork.map((w) => [w.type, w.placement, w.scale, w.dimensions, w.method, w.fromHps, w.fromCf, w.alignment])
      )
    : "No artwork — state 'NO ARTWORK APPLIED' in the artwork section."
}
4. A full-color technical flat with dimension lines showing artwork/print placement measurements from HPS and CF. Pattern / print: ${list(a.patternPrint)}.`;
}

function page5(a: MasterAnalysis): string {
  return `${GLOBAL_VISUAL_RULES}

${header(a, 5, "MEASUREMENTS & SPEC TABLE")}

PAGE CONTENT — MEASUREMENTS & SPEC TABLE:
1. A BLACK-AND-WHITE line-art measurement diagram of the garment (front and back flats, no color, no shading) with thin arrows labelled by POM code (${a.measurements.map((m) => m.code).join(", ")}).
2. Spec table for base size ${a.baseSize}:
${table(
  ["Code", "Point of Measure", `${a.baseSize} (cm)`, "Tolerance"],
  a.measurements.map((m) => [m.code, m.pom, String(gradedValue(a, m, a.baseSize)), m.tolerance])
)}
3. HOW TO MEASURE section:
${a.measurements.map((m) => `${m.code} — ${m.pom}: ${m.howToMeasure}`).join("\n")}
4. Measurement notes: measure garment flat and unstretched; all measurements in cm.`;
}

function page6(a: MasterAnalysis): string {
  return `${GLOBAL_VISUAL_RULES}

${header(a, 6, "SIZE GRADING")}

PAGE CONTENT — SIZE GRADING:
1. Grade table (the main element):
${table(
  ["Code", "Point of Measure", ...a.sizes, "Grade Rule"],
  a.measurements.map((m) => [m.code, m.pom, ...a.sizes.map((s) => String(gradedValue(a, m, s))), `± ${m.gradeRule}`])
)}
2. Grade progression diagram: nested black outline silhouettes of the garment from smallest (${a.sizes[0]}) to largest (${a.sizes[a.sizes.length - 1]}) size, base size ${a.baseSize} highlighted.
3. Size explanation: base sample size ${a.baseSize}; grading is applied equally per size step using the grade rules above.
4. Fit notes: ${val(a.identification, "fit")} fit; maintain proportions across sizes.`;
}

function page7(a: MasterAnalysis): string {
  return `${GLOBAL_VISUAL_RULES}

${header(a, 7, "LABELS & PACKAGING")}

PAGE CONTENT — LABELS & PACKAGING:
1. Labels table:
${table(["Item", "Specification"], a.labelsPackaging.map((f) => [f.label, f.value || "TBC"]))}
2. Placement diagrams: small line-art garment flats showing main label, size label and care label positions.
3. Hangtag front and back illustration with brand "${val(a.identification, "brand")}", style no. ${val(a.identification, "style number")}, size and barcode.
4. Folding instructions: step-by-step small line-art diagrams (3–4 steps).
5. Polybag specs and carton specs boxes, and packaging notes.`;
}

const BUILDERS = [page1, page2, page3, page4, page5, page6, page7];

export function buildTechPackPagePrompts(analysis: MasterAnalysis): { pageNumber: number; pageTitle: string; promptText: string }[] {
  return MASTER_PAGE_DEFINITIONS.map((def, i) => ({ pageNumber: def.pageNumber, pageTitle: def.title, promptText: BUILDERS[i](analysis) }));
}
