// Acronym words that must stay fully uppercase rather than being
// title-cased word-by-word (e.g. "WIP" -> "Wip" would be wrong).
const ACRONYM_WORDS = new Set(["WIP"]);

/** "FABRIC" -> "Fabric", "FINISHED_GOODS" -> "Finished Goods",
 * "WIP" -> "WIP" — shared so every category-grouped picker/filter in the
 * app formats enum values the same way, including the multi-word/acronym
 * WarehouseLocation stage tags. */
export function formatCategoryLabel(category: string) {
  return category
    .split("_")
    .map((word) => (ACRONYM_WORDS.has(word) ? word : word.charAt(0) + word.slice(1).toLowerCase()))
    .join(" ");
}
