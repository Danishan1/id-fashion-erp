/**
 * AI Designer "New Design" flow (2026-09-27) — the garment-type picker for
 * Step 2, and the fixed model photo ("template") each garment type is
 * generated from. Generation keeps the template's own model, face, pose and
 * framing and only replaces the garment with the chosen fabric/colour, so
 * every design of the same type reads like one consistent catalogue shoot.
 *
 * Photos live in public/ai-designer-templates/<slug>.png (copied from the
 * company's own D:\ai folder). A garment type without a photo simply has no
 * templateUrl — generation falls back to the ordinary fabric-reference
 * generation for it. Adding a photo later needs only the file plus one
 * TEMPLATE_PHOTO_SLUGS entry.
 *
 * Zero server-only imports — shared by the client picker and the server.
 */

import {
  AGE_GROUPS_BY_CUSTOMER,
  PRODUCT_CATEGORIES_BY_CUSTOMER,
  TARGET_CUSTOMER_LABELS,
  TARGET_CUSTOMER_VALUES,
  type TargetCustomer,
} from "./customer-catalog";

export interface GarmentTemplateDef {
  /** Stable key, e.g. "women-dress". */
  key: string;
  label: string;
  customer: TargetCustomer;
  customerLabel: string;
  /** The PRODUCT_CATEGORIES_BY_CUSTOMER category this maps to. */
  category: string;
  /** Default age group used when this template is chosen (the customer's first adult-ish group). */
  defaultAgeGroup: string;
  /** Public URL of the model photo, when one exists. */
  templateUrl: string | null;
}

/** Only adult WOMEN photos exist today (Dress/Top/Lehenga). Keyed by `${customer}:${category}`. */
const TEMPLATE_PHOTO_SLUGS: Record<string, string> = {
  "WOMEN:Dress": "dress",
  "WOMEN:Top": "top",
  "WOMEN:Lehenga": "lehenga",
};

export function slugifyCategory(category: string): string {
  return category.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

const DEFAULT_AGE_INDEX: Record<TargetCustomer, number> = { MEN: 2, WOMEN: 2, UNISEX: 2, BOYS: 1, GIRLS: 1, BABY: 1 };

export const GARMENT_TEMPLATES: GarmentTemplateDef[] = TARGET_CUSTOMER_VALUES.flatMap((customer) =>
  PRODUCT_CATEGORIES_BY_CUSTOMER[customer].map((category) => {
    const slug = TEMPLATE_PHOTO_SLUGS[`${customer}:${category}`];
    return {
      key: `${customer.toLowerCase()}-${slugifyCategory(category)}`,
      label: category,
      customer,
      customerLabel: TARGET_CUSTOMER_LABELS[customer],
      category,
      defaultAgeGroup: AGE_GROUPS_BY_CUSTOMER[customer][DEFAULT_AGE_INDEX[customer]] ?? AGE_GROUPS_BY_CUSTOMER[customer][0],
      templateUrl: slug ? `/ai-designer-templates/${slug}.png` : null,
    };
  })
);

export function getGarmentTemplate(key: string): GarmentTemplateDef | undefined {
  return GARMENT_TEMPLATES.find((t) => t.key === key);
}

/** The public/ relative path of a template photo, e.g. "ai-designer-templates/dress.png" — server reads it from disk. */
export function templatePublicPath(def: GarmentTemplateDef): string | null {
  return def.templateUrl ? def.templateUrl.replace(/^\//, "") : null;
}

const SYNONYMS: Record<string, string[]> = {
  Dress: ["dress", "gown", "maxi", "midi", "sundress", "frock"],
  Top: ["top", "blouse top", "crop top", "tunic", "camisole", "tank"],
  Lehenga: ["lehenga", "ghagra", "chaniya", "lehnga"],
  Kurti: ["kurti", "kurta", "tunic", "anarkali"],
  Kurta: ["kurta", "kurti"],
  Skirt: ["skirt"],
  Blouse: ["blouse", "choli"],
  "Co-ord": ["co-ord", "coord", "set", "two piece"],
  Shirt: ["shirt"],
  "T-Shirt": ["t-shirt", "tshirt", "tee"],
  Pant: ["pant", "trouser", "palazzo"],
  Jeans: ["jeans", "denim"],
  Jacket: ["jacket", "blazer", "coat"],
  Hoodie: ["hoodie"],
  Shorts: ["shorts"],
};

export interface GarmentSuggestion {
  key: string;
  label: string;
  reason: string;
}

/**
 * Ranks garment templates against free-text AI hints (garment type first,
 * then suggested/recommended garments) — a plain keyword match, no AI call.
 * Templates with a real model photo win ties, since they produce the most
 * consistent catalogue output. Returns at most `limit` suggestions.
 */
export function rankGarmentTemplates(
  hints: { primary?: string | null; secondary?: string | null },
  preferredCustomer: TargetCustomer = "WOMEN",
  limit = 4
): GarmentSuggestion[] {
  const primary = (hints.primary ?? "").toLowerCase();
  const secondary = (hints.secondary ?? "").toLowerCase();
  const scored = GARMENT_TEMPLATES.map((t) => {
    const words = SYNONYMS[t.category] ?? [t.category.toLowerCase()];
    let score = 0;
    let reason = "";
    if (words.some((w) => primary.includes(w))) {
      score += 10;
      reason = "Closest match to the analysed garment type";
    } else if (words.some((w) => secondary.includes(w))) {
      score += 5;
      reason = "Recommended by the AI analysis";
    }
    if (t.customer === preferredCustomer) score += 2;
    if (t.templateUrl) score += 1;
    return { t, score, reason };
  })
    .filter((s) => s.score >= 5)
    .sort((a, b) => b.score - a.score);

  const results: GarmentSuggestion[] = [];
  const seen = new Set<string>();
  for (const s of scored) {
    if (seen.has(s.t.category)) continue;
    seen.add(s.t.category);
    results.push({ key: s.t.key, label: `${s.t.label} (${s.t.customerLabel})`, reason: s.reason });
    if (results.length >= limit) break;
  }

  // Never leave the user with nothing: fall back to the photo-backed templates.
  if (results.length === 0) {
    for (const t of GARMENT_TEMPLATES.filter((x) => x.templateUrl)) {
      results.push({ key: t.key, label: `${t.label} (${t.customerLabel})`, reason: "Popular catalogue template" });
      if (results.length >= limit) break;
    }
  }
  return results;
}
