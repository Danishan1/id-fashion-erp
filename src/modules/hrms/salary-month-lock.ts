import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";

/**
 * Salary Management (2026-10-28): once a month's salary is APPROVED or
 * FINALISED, attendance, leave and salary adjustments for that month are
 * locked so the approved figures can't go stale. Sending the run back (or
 * reopening a finalised run) unlocks it.
 */
export async function assertSalaryMonthOpen(companyId: string, dates: (string | Date)[]) {
  const months = new Set<string>();
  for (const d of dates) {
    const key = typeof d === "string" ? d.slice(0, 7) : d.toISOString().slice(0, 7);
    if (/^\d{4}-\d{2}$/.test(key)) months.add(key);
  }
  if (months.size === 0) return;
  const runs = await prisma.salaryRun.findMany({
    where: { companyId, status: { in: ["APPROVED", "FINALISED"] }, OR: [...months].map((m) => ({ year: Number(m.slice(0, 4)), month: Number(m.slice(5, 7)) })) },
    select: { year: true, month: true, status: true },
  });
  if (runs.length > 0) {
    const r = runs[0];
    const label = new Date(Date.UTC(r.year, r.month - 1, 1)).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
    throw new BusinessRuleError(
      "INVALID_STATE_TRANSITION",
      `Salary for ${label} is ${r.status === "FINALISED" ? "finalised" : "approved"}, so this month is locked. ${r.status === "FINALISED" ? "Reopen" : "Send back"} the salary run first.`
    );
  }
}

/** Every date from `from` to `to` (inclusive) as YYYY-MM-DD — for range-based requests. */
export function monthKeysBetween(from: Date, to: Date): string[] {
  const out: string[] = [];
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
  const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1));
  while (d <= end && out.length < 36) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return out;
}
