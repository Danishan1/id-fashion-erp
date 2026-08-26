import { BusinessRuleError } from "@/core/errors/BusinessRuleError";

/**
 * Validates a status filter query param against a Prisma-generated runtime
 * enum object (e.g. `JournalStatus`, `SalesOrderStatus`) before it reaches a
 * Prisma `where` clause. Every report's status filter previously did
 * `status: filters.status as never` with no validation at all — an invalid
 * value (typo, stale bookmark, direct API probe) hit Postgres/Prisma raw and
 * surfaced as an uncaught `500 INTERNAL_ERROR` instead of a clean
 * `400 VALIDATION_ERROR` (ERP-BUG-R02, Phase 10 QA pass — confirmed on
 * Sales Invoice Register, Dispatch Register, Production Schedule; the same
 * unvalidated pattern exists in every report with a status filter).
 *
 * Returns the Prisma `where` fragment directly (`{}` when no filter was
 * supplied) so call sites can spread it exactly like the old inline
 * ternary did.
 */
export function validateStatusFilter<T extends Record<string, string>>(
  filters: Record<string, string>,
  enumObject: T
): { status?: T[keyof T] } {
  if (!filters.status) return {};
  const validValues = Object.values(enumObject);
  if (!validValues.includes(filters.status as T[keyof T])) {
    throw new BusinessRuleError(
      "VALIDATION_ERROR",
      `"${filters.status}" is not a valid status. Expected one of: ${validValues.join(", ")}.`,
      { field: "status", value: filters.status, validValues }
    );
  }
  return { status: filters.status as T[keyof T] };
}
