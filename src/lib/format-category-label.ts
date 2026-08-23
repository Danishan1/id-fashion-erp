/** "FABRIC" -> "Fabric", "OTHER" -> "Other" — shared so every category-grouped
 * picker/filter in the app formats enum values the same way. */
export function formatCategoryLabel(category: string) {
  return category.charAt(0) + category.slice(1).toLowerCase();
}
