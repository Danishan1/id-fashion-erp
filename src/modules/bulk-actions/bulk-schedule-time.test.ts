import { describe, expect, it } from "vitest";
import { describeSchedule, nextScheduleRunAt } from "./bulk-schedule-time";

/** Phase 14 (S&M) — schedule times are India time (UTC+05:30, no DST). */
describe("nextScheduleRunAt", () => {
  const at = (s: string) => new Date(s);

  it("daily: later today, or tomorrow once today's time has passed", () => {
    expect(nextScheduleRunAt({ frequency: "DAILY", timeOfDay: "07:00" }, at("2026-11-06T00:00:00Z")).toISOString()).toBe("2026-11-06T01:30:00.000Z");
    expect(nextScheduleRunAt({ frequency: "DAILY", timeOfDay: "07:00" }, at("2026-11-06T01:30:00Z")).toISOString()).toBe("2026-11-07T01:30:00.000Z");
  });

  it("handles the India day boundary (IST is already tomorrow at 18:30 UTC)", () => {
    expect(nextScheduleRunAt({ frequency: "DAILY", timeOfDay: "23:45" }, at("2026-11-06T18:00:00Z")).toISOString()).toBe("2026-11-06T18:15:00.000Z");
    expect(nextScheduleRunAt({ frequency: "DAILY", timeOfDay: "00:10" }, at("2026-11-06T18:45:00Z")).toISOString()).toBe("2026-11-07T18:40:00.000Z");
  });

  it("weekly on the chosen weekday (1 = Monday)", () => {
    // Thursday 5 Nov → Monday 9 Nov, 09:00 IST.
    expect(nextScheduleRunAt({ frequency: "WEEKLY", timeOfDay: "09:00", dayOfWeek: 1 }, at("2026-11-05T10:00:00Z")).toISOString()).toBe("2026-11-09T03:30:00.000Z");
    // Sunday = 7.
    expect(nextScheduleRunAt({ frequency: "WEEKLY", timeOfDay: "09:00", dayOfWeek: 7 }, at("2026-11-05T10:00:00Z")).toISOString()).toBe("2026-11-08T03:30:00.000Z");
  });

  it("monthly on the chosen day", () => {
    expect(nextScheduleRunAt({ frequency: "MONTHLY", timeOfDay: "06:00", dayOfMonth: 1 }, at("2026-11-06T00:00:00Z")).toISOString()).toBe("2026-12-01T00:30:00.000Z");
    expect(nextScheduleRunAt({ frequency: "MONTHLY", timeOfDay: "06:00", dayOfMonth: 28 }, at("2027-02-01T00:00:00Z")).toISOString()).toBe("2027-02-28T00:30:00.000Z");
  });

  it("rejects a malformed time", () => {
    expect(() => nextScheduleRunAt({ frequency: "DAILY", timeOfDay: "7:00" }, new Date())).toThrow();
  });

  it("describes the rule", () => {
    expect(describeSchedule({ frequency: "WEEKLY", timeOfDay: "09:00", dayOfWeek: 1 })).toBe("Every Monday at 09:00 IST");
    expect(describeSchedule({ frequency: "MONTHLY", timeOfDay: "06:00", dayOfMonth: 5 })).toBe("Monthly on day 5 at 06:00 IST");
  });
});
