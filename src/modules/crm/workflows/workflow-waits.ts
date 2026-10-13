import { addDays, isValidTimeZone, weekdayOf, zonedParts, zonedToInstant, NonexistentLocalTimeError } from "../core/crm-timezone";
import type { WaitSpec } from "./workflow-definition";
import { WAIT_UNITS, WEEKDAYS, WORKFLOW_LIMITS, type Weekday } from "./workflow-registry";

/**
 * When a WAIT step resumes. Waits are persisted (`next_run_at`) and picked
 * up by the scheduler — never an in-process timer, so they survive restarts
 * and deploys. Wall-clock waits ("until 09:00 on weekdays") are computed in
 * the workflow's IANA time zone with the runtime's tz database (DST-safe).
 *
 * Returns the instant to resume at; an instant ≤ now means "continue now".
 */
export function computeResumeAt(spec: WaitSpec, now: Date, timeZone: string, fieldValue?: unknown): Date {
  const tz = isValidTimeZone(timeZone) ? timeZone : "Asia/Kolkata";
  const max = now.getTime() + WORKFLOW_LIMITS.maxWaitDays * 86_400_000;
  switch (spec.mode) {
    case "DURATION":
      return new Date(Math.min(max, now.getTime() + spec.amount * WAIT_UNITS[spec.unit]));
    case "UNTIL_TIME": {
      const days = spec.days?.length ? new Set<Weekday>(spec.days) : null;
      const todayIso = zonedParts(now, tz).date;
      for (let i = 0; i <= 8; i++) {
        const date = addDays(todayIso, i);
        const wd = WEEKDAYS[(weekdayOf(date) + 6) % 7];
        if (days && !days.has(wd)) continue;
        let at: Date;
        try {
          at = zonedToInstant(date, spec.time, tz);
        } catch (e) {
          // A wall-clock time skipped by a DST change: use the same time one hour later.
          if (!(e instanceof NonexistentLocalTimeError)) throw e;
          const [h, m] = spec.time.split(":").map(Number);
          at = zonedToInstant(date, `${String((h + 1) % 24).padStart(2, "0")}:${String(m).padStart(2, "0")}`, tz);
        }
        if (at.getTime() > now.getTime()) return at;
      }
      return new Date(now.getTime() + 86_400_000);
    }
    case "UNTIL_FIELD": {
      const base = fieldValue instanceof Date ? fieldValue : typeof fieldValue === "string" || typeof fieldValue === "number" ? new Date(fieldValue) : null;
      if (!base || Number.isNaN(base.getTime())) return now; // no date on the record: continue
      return new Date(Math.min(max, base.getTime() + spec.offsetMinutes * 60_000));
    }
  }
}

/** Plain-English description of a wait, for traces and the editor. */
export function describeWait(spec: WaitSpec, fieldLabel?: string): string {
  switch (spec.mode) {
    case "DURATION":
      return `Wait ${spec.amount} ${spec.unit.toLowerCase()}`;
    case "UNTIL_TIME":
      return `Wait until ${spec.time}${spec.days?.length ? ` on ${spec.days.join(", ")}` : ""}`;
    case "UNTIL_FIELD": {
      const off = spec.offsetMinutes;
      const offText = off ? ` ${off > 0 ? "+" : "−"}${Math.abs(off)} min` : "";
      return `Wait until ${fieldLabel ?? spec.field}${offText}`;
    }
  }
}
