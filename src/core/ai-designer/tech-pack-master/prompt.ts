import { FACT_STATUSES } from "./schema";

export const MASTER_TECH_PACK_PROMPT_VERSION = "ai-designer-tech-pack-master-v3";

/**
 * The company's own "GARMENT TECH PACK SPEC SHEET GENERATOR" master prompt,
 * adapted for a structured-JSON response: the model does the full A–J
 * garment analysis; the page image prompts are assembled from that
 * analysis by page-prompts.ts (so every page shares identical data).
 */
export const MASTER_TECH_PACK_SYSTEM_PROMPT = `You are a Senior Technical Fashion Designer and Apparel Product Developer with 20+ years of experience creating factory-ready garment tech packs for manufacturers, sourcing teams, and apparel suppliers.

You are NOT a fashion stylist. You are NOT a creative director. You are NOT giving opinions. You are a technical translator for apparel manufacturing. Your output must resemble Nike supplier tech packs, Zara/Bershka factory development documents, and professional apparel CAD documentation.

TASK: Analyze the garment image and convert it into a complete, production-oriented technical specification (the categories below). Use professional apparel terminology (overlock, coverstitch, safety stitch, twin needle, topstitch, bartack, rib knit, self-fabric binding, French seam, blind hem, etc.) and factory-ready language. Use exact placements in centimeters.

FACT STATUS — every fact carries a status:
- CONFIRMED: supplied in the ERP facts below, or clearly visible in the image.
- ASSUMED: inferred from the image or from garment-industry norms — must be confirmed by the designer.
- NOT_VISIBLE: cannot be determined from the image. Still give your best professional default value where a factory needs a number (e.g. a standard measurement), and mark it NOT_VISIBLE or ASSUMED.
Never invent a detail without flagging it. ERP facts are always CONFIRMED and must be used verbatim.

NEVER LEAVE A FIELD BLANK. This applies to every single value you return — every field's "value", every BOM row's every column (item, description, composition, GSM, color, consumption, supplier, notes), every measurement row's every column (POM, how-to-measure, tolerance), and every seam callout's every column. If you genuinely cannot determine something, do NOT return an empty string — instead give your best professional, standard-garment-industry default value for that exact field and mark its status ASSUMED or NOT_VISIBLE so the designer knows to double-check it. An empty string is never an acceptable answer for any field.

REQUIRED ANALYSIS:
A. GARMENT IDENTIFICATION (identification): Brand name, Style name, Style number, Garment category, Sub-category, Fit type, Gender/category, Target season, Base sample size, Date created, Designer.
B. CONSTRUCTION & SILHOUETTE (construction): Silhouette, Body shape, Body length, Width, Hem shape, Side seam construction, Shoulder construction, Sleeve construction, Collar/neck construction, Rib trims, Paneling, Drop shoulder amount, Cuff construction, Lining/facing — each with a precise technical value (stitch types, seam allowances in cm, SPI).
C. CLOSURE SYSTEM (closure): Pullover / zipper / buttons / hooks / drawcord / snaps / tie — type, count, size, placement. If none, state clearly.
D. PANELS & SEAM CONSTRUCTION (seamCallouts): every seam line, panel join, shoulder/sleeve/side/hem seam, rib or trim attachment and artwork application, as numbered callouts (number, location, technical specification, status PROPOSED or CONFIRMED). At least 10 callouts.
E. BILL OF MATERIALS (bom): exhaustive — at least 14 rows: main fabric, lining/contrast fabric, rib/binding, interfacing, sewing threads, closures/hardware, main label, size label, care label, neck tape, print inks/embroidery thread, hangtag, polybag, carton, and any trims. Each: item, description, composition, GSM, color, consumption per garment (with unit), supplier (use "TBD — supplier placeholder"), notes, status.
F. MEASUREMENTS & GRADING: sizes (e.g. ["XS","S","M","L","XL","XXL"] — adapt to the category/age group), baseSize (the sample size), and at least 10 points of measure (measurements) with code (A, B, C…), POM name, how-to-measure instruction, tolerance (e.g. "± 1.0"), baseValue in cm for the base size, and gradeRule in cm per size step (the system computes every size from these, so they must be realistic).
G. LABELS & PACKAGING (labelsPackaging): main label, size label, care label, hangtag, polybag, folding instructions, carton packing, barcode placement — each with material, size in cm and placement.

ALSO PROVIDE:
- garmentVisualDescription: 4–6 sentences describing the garment's exact visual appearance (silhouette, neckline, sleeves, length, panels, trims, fabric colour, print motif and scale) precise enough that an illustrator could redraw the identical garment as a CAD flat.
- notesForDesigner: every assumption and unclear area, one per line.
- suggestedAdditionalViews: recommended additional reference images (e.g. back view, close-up of neckline).

Respond ONLY by calling the provided tool exactly once, with every field filled.`;

export interface MasterTechPackErpFacts {
  brandName: string | null;
  styleName: string;
  styleNumber: string;
  garmentCategory: string | null;
  targetCustomer: string | null;
  ageGroup: string | null;
  designer: string | null;
  dateCreated: string;
  fabric: string | null;
  fabricDetail: string | null;
  designBrief: string | null;
}

export function buildMasterUserText(facts: MasterTechPackErpFacts): string {
  const lines = [
    "Analyze the attached garment image.",
    "",
    "ERP FACTS (CONFIRMED — use these exact values):",
    `- Brand name: ${facts.brandName || "Not set in ERP — mark NOT_VISIBLE unless a label is visible"}`,
    `- Style name: ${facts.styleName}`,
    `- Style number: ${facts.styleNumber}`,
    facts.garmentCategory && `- Garment category: ${facts.garmentCategory}`,
    facts.targetCustomer && `- Gender / category: ${facts.targetCustomer}${facts.ageGroup ? ` (${facts.ageGroup})` : ""}`,
    facts.designer && `- Designer: ${facts.designer}`,
    `- Date created: ${facts.dateCreated}`,
    facts.fabric && `- Fabric: ${facts.fabric}`,
    facts.fabricDetail && `- Fabric detail: ${facts.fabricDetail}`,
    facts.designBrief && `- Design brief: ${facts.designBrief}`,
  ].filter(Boolean);
  return lines.join("\n");
}

const fieldArray = {
  type: "array",
  items: {
    type: "object",
    properties: { label: { type: "string" }, value: { type: "string" }, status: { type: "string", enum: [...FACT_STATUSES] } },
    required: ["label", "value", "status"],
  },
};

const s = { type: "string" };

export function buildMasterToolInputSchema() {
  return {
    type: "object" as const,
    properties: {
      garmentVisualDescription: s,
      identification: fieldArray,
      construction: fieldArray,
      closure: fieldArray,
      seamCallouts: {
        type: "array",
        items: {
          type: "object",
          properties: { number: { type: "integer" }, location: s, specification: s, status: { type: "string", enum: ["PROPOSED", "CONFIRMED"] } },
          required: ["number", "location", "specification", "status"],
        },
      },
      bom: {
        type: "array",
        items: {
          type: "object",
          properties: {
            item: s,
            description: s,
            composition: s,
            gsm: s,
            color: s,
            consumption: s,
            supplier: s,
            notes: s,
            status: { type: "string", enum: [...FACT_STATUSES] },
          },
          required: ["item", "description", "composition", "gsm", "color", "consumption", "supplier", "notes", "status"],
        },
      },
      sizes: { type: "array", items: s },
      baseSize: s,
      measurements: {
        type: "array",
        items: {
          type: "object",
          properties: {
            code: s,
            pom: s,
            howToMeasure: s,
            tolerance: s,
            baseValue: { type: "number" },
            gradeRule: { type: "number" },
            status: { type: "string", enum: [...FACT_STATUSES] },
          },
          required: ["code", "pom", "howToMeasure", "tolerance", "baseValue", "gradeRule", "status"],
        },
      },
      labelsPackaging: fieldArray,
      notesForDesigner: { type: "array", items: s },
      suggestedAdditionalViews: { type: "array", items: s },
    },
    required: [
      "garmentVisualDescription",
      "identification",
      "construction",
      "closure",
      "seamCallouts",
      "bom",
      "sizes",
      "baseSize",
      "measurements",
      "labelsPackaging",
      "notesForDesigner",
      "suggestedAdditionalViews",
    ],
  };
}
