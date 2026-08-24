/** "IN_PRODUCTION" -> "In Production", "PARTIALLY_DISPATCHED" -> "Partially Dispatched" —
 * a generic fallback for displaying a raw enum value without maintaining a
 * second per-module label map, for screens (like Customer 360) that show
 * many different modules' statuses at once rather than owning just one. */
export function humanizeStatus(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
