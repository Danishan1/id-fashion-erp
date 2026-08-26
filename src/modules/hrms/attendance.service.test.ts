import { describe, expect, it } from "vitest";
import { computeIsLate } from "./attendance.service";

describe("computeIsLate", () => {
  it("returns null when there's no punch-in", () => {
    expect(computeIsLate(null, "10:00")).toBeNull();
  });

  it("returns null when the employee has no shift assigned", () => {
    expect(computeIsLate(new Date("2026-08-24T10:30:00"), null)).toBeNull();
    expect(computeIsLate(new Date("2026-08-24T10:30:00"), undefined)).toBeNull();
  });

  it("is late when punch-in is after the employee's own shift start", () => {
    expect(computeIsLate(new Date("2026-08-24T10:16:00"), "10:15")).toBe(true);
  });

  it("is on time when punch-in is exactly at the shift start", () => {
    expect(computeIsLate(new Date("2026-08-24T10:15:00"), "10:15")).toBe(false);
  });

  it("is on time when punch-in is before the shift start", () => {
    expect(computeIsLate(new Date("2026-08-24T09:50:00"), "10:15")).toBe(false);
  });

  it("uses each employee's own shift, not one hardcoded company-wide cutoff", () => {
    const punchIn = new Date("2026-08-24T09:10:00");
    // Late against a 9:00 shift...
    expect(computeIsLate(punchIn, "09:00")).toBe(true);
    // ...but on time against a 9:30 shift, same punch-in time.
    expect(computeIsLate(punchIn, "09:30")).toBe(false);
  });

  it("defaults to zero grace minutes when omitted, matching the pre-grace-time behavior exactly", () => {
    expect(computeIsLate(new Date("2026-08-24T09:01:00"), "09:00")).toBe(true);
  });

  it("treats a punch-in inside the grace window as on time", () => {
    expect(computeIsLate(new Date("2026-08-24T09:09:00"), "09:00", 10)).toBe(false);
  });

  it("still counts a punch-in past the grace window as late", () => {
    expect(computeIsLate(new Date("2026-08-24T09:11:00"), "09:00", 10)).toBe(true);
  });

  it("is on time exactly at the edge of the grace window", () => {
    expect(computeIsLate(new Date("2026-08-24T09:10:00"), "09:00", 10)).toBe(false);
  });
});
