/**
 * Fixed, built-in catalog for AI Designer's Target Customer / Age Group /
 * Product Category screens. Deliberately self-contained within this module
 * (not imported from the sibling "AI Garment Flow" module's own near-
 * identical catalog) — a direct, accepted consequence of "genuinely separate
 * module, zero shared code," confirmed explicitly with the user. Not tied to
 * the real Product Type master (Masters -> Garment Attributes -> Product
 * Types) — that master has no gender/age tagging today, and adding one would
 * ripple into BOM/Style/Sales Orders for every company.
 *
 * Zero Prisma/server-only imports — both the server (validating a submitted
 * selection) and the client (rendering the picker screens) import this same
 * file.
 */

export const TARGET_CUSTOMER_VALUES = ["MEN", "WOMEN", "BOYS", "GIRLS", "BABY", "UNISEX"] as const;
export type TargetCustomer = (typeof TARGET_CUSTOMER_VALUES)[number];

export const TARGET_CUSTOMER_LABELS: Record<TargetCustomer, string> = {
  MEN: "Men",
  WOMEN: "Women",
  BOYS: "Boys",
  GIRLS: "Girls",
  BABY: "Baby",
  UNISEX: "Unisex",
};

export const AGE_GROUPS_BY_CUSTOMER: Record<TargetCustomer, string[]> = {
  MEN: ["Teen", "18-25", "25-40", "40+"],
  WOMEN: ["Teen", "18-25", "25-40", "40+"],
  BOYS: ["2-4 Years", "5-8 Years", "9-12 Years", "13-16 Years"],
  GIRLS: ["2-4 Years", "5-8 Years", "9-12 Years", "13-16 Years"],
  BABY: ["0-6 Months", "6-12 Months", "1-2 Years", "2-5 Years"],
  UNISEX: ["Teen", "18-25", "25-40", "40+"],
};

/**
 * Category names are shared where the garment is genuinely the same (e.g.
 * Men's "Shirt" and Women's "Shirt" both point at the same
 * design-attribute-catalog.ts entry) — the value here is the category name
 * string, keyed by name (not by customer) in that sibling file.
 */
export const PRODUCT_CATEGORIES_BY_CUSTOMER: Record<TargetCustomer, string[]> = {
  MEN: ["Shirt", "T-Shirt", "Pant", "Jeans", "Kurta", "Jacket", "Hoodie", "Shorts"],
  WOMEN: ["Dress", "Top", "Kurti", "Pant", "Skirt", "Blouse", "Co-ord", "Shirt"],
  BOYS: ["Shirt", "T-Shirt", "Pant", "Shorts", "Jacket", "Hoodie"],
  GIRLS: ["Dress", "Top", "Frock", "Skirt", "Pant", "Jacket"],
  BABY: ["Onesie", "Romper", "Baby Dress", "Sleepwear", "Top-Bottom Set"],
  UNISEX: ["T-Shirt", "Hoodie", "Sweatshirt", "Track Pant", "Shorts"],
};

export function isTargetCustomer(value: string): value is TargetCustomer {
  return (TARGET_CUSTOMER_VALUES as readonly string[]).includes(value);
}

export function isValidAgeGroup(customer: TargetCustomer, ageGroup: string): boolean {
  return AGE_GROUPS_BY_CUSTOMER[customer].includes(ageGroup);
}

export function isValidProductCategory(customer: TargetCustomer, categoryName: string): boolean {
  return PRODUCT_CATEGORIES_BY_CUSTOMER[customer].includes(categoryName);
}
