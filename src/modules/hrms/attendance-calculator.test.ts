import { describe, expect, it } from "vitest";
import {
  computeDayHours,
  computeDayStatus,
  computeIsLateIst,
  computeOvertimeHours,
  dateKeysBetween,
  effectiveRadius,
  evaluateGeofence,
  findConflictingSession,
  haversineMeters,
  isValidCoordinate,
  istDateKey,
  istDayRange,
  istTimeOnDate,
  leaveFraction,
  mergeIntervals,
  monthDateKeys,
  planLeaveDeduction,
  shiftHoursFromTimes,
  validateSessionTimes,
  weekdayOf,
} from "./attendance-calculator";

const ist = (key: string, hhmm: string) => istTimeOnDate(key, hhmm);

describe("IST dates", () => {
  it("uses the IST calendar day, not UTC", () => {
    // 2026-10-23 00:30 IST = 2026-10-22 19:00 UTC
    expect(istDateKey(new Date("2026-10-22T19:00:00Z"))).toBe("2026-10-23");
    expect(istDateKey(new Date("2026-10-22T18:29:59Z"))).toBe("2026-10-22");
  });
  it("day range starts at IST midnight", () => {
    const { start, end } = istDayRange("2026-10-23");
    expect(start.toISOString()).toBe("2026-10-22T18:30:00.000Z");
    expect(end.getTime() - start.getTime()).toBe(86_400_000);
  });
  it("weekday, ranges and month keys", () => {
    expect(weekdayOf("2026-10-25")).toBe("SUNDAY");
    expect(dateKeysBetween("2026-10-30", "2026-11-02")).toEqual(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
    expect(monthDateKeys(2028, 2)).toHaveLength(29);
  });
});

describe("mergeIntervals", () => {
  it("never double counts overlap", () => {
    const r = mergeIntervals([
      { start: 0, end: 10 },
      { start: 5, end: 15 },
      { start: 20, end: 25 },
      { start: 30, end: 30 },
    ]);
    expect(r.merged).toEqual([
      { start: 0, end: 15 },
      { start: 20, end: 25 },
    ]);
    expect(r.totalMs).toBe(20);
  });
  it("empty input", () => expect(mergeIntervals([]).totalMs).toBe(0));
});

describe("computeDayHours", () => {
  const d = "2026-10-23";
  it("finalised counts closed sessions only; live adds the open one up to now", () => {
    const h = computeDayHours(
      [
        { id: "a", checkInAt: ist(d, "09:00"), checkOutAt: ist(d, "13:00") },
        { id: "b", checkInAt: ist(d, "12:00"), checkOutAt: ist(d, "14:00") }, // overlaps a by 1h
        { id: "c", checkInAt: ist(d, "15:00"), checkOutAt: null },
      ],
      ist(d, "16:30")
    );
    expect(h.finalizedHours).toBe(5);
    expect(h.liveHours).toBe(6.5);
    expect(h.hasOpenSession).toBe(true);
    expect(h.firstIn?.getTime()).toBe(ist(d, "09:00").getTime());
    expect(h.lastOut?.getTime()).toBe(ist(d, "14:00").getTime());
  });
  it("flags but still counts a session over 18 h; drops out<=in", () => {
    const h = computeDayHours([
      { id: "x", checkInAt: ist(d, "00:00"), checkOutAt: ist("2026-10-24", "20:00") },
      { id: "y", checkInAt: ist(d, "10:00"), checkOutAt: ist(d, "09:00") },
    ]);
    expect(h.excessiveSessionIds).toEqual(["x"]);
    expect(h.finalizedHours).toBe(44);
  });
});

describe("conflicts and validation", () => {
  const d = "2026-10-23";
  const existing = [
    { id: "a", checkInAt: ist(d, "09:00"), checkOutAt: ist(d, "12:00") },
    { id: "open", checkInAt: ist(d, "18:00"), checkOutAt: null },
  ];
  it("detects overlap, ignores touching edges and the excluded session", () => {
    expect(findConflictingSession({ checkInAt: ist(d, "11:00"), checkOutAt: ist(d, "13:00") }, existing)?.id).toBe("a");
    expect(findConflictingSession({ checkInAt: ist(d, "12:00"), checkOutAt: ist(d, "13:00") }, existing)).toBeNull();
    expect(findConflictingSession({ checkInAt: ist(d, "11:00"), checkOutAt: ist(d, "13:00") }, existing, "a")).toBeNull();
    // an open session conflicts with anything ending after its check-in
    expect(findConflictingSession({ checkInAt: ist(d, "17:00"), checkOutAt: ist(d, "19:00") }, existing)?.id).toBe("open");
  });
  it("validates order and 18 h", () => {
    expect(validateSessionTimes(ist(d, "10:00"), ist(d, "09:00"))).toMatch(/after/);
    expect(validateSessionTimes(ist(d, "00:00"), ist("2026-10-24", "19:00"))).toMatch(/18 hours/);
    expect(validateSessionTimes(ist(d, "09:00"), ist(d, "18:00"))).toBeNull();
    expect(validateSessionTimes(ist(d, "09:00"), null)).toBeNull();
  });
});

describe("shift, status, overtime, late", () => {
  it("shift hours wrap overnight; missing shift is null", () => {
    expect(shiftHoursFromTimes("09:30", "18:30")).toBe(9);
    expect(shiftHoursFromTimes("22:00", "06:00")).toBe(8);
    expect(shiftHoursFromTimes(null, "06:00")).toBeNull();
  });
  it("status bands with 15-minute tolerance (old salary.js)", () => {
    expect(computeDayStatus(8.75, 9)).toMatchObject({ band: "FULL", present: 1 });
    expect(computeDayStatus(8.7, 9)).toMatchObject({ band: "SEMI", present: 0.75, absent: 0.25 });
    expect(computeDayStatus(6.5, 9)).toMatchObject({ band: "SEMI" });
    expect(computeDayStatus(4.25, 9)).toMatchObject({ band: "HALF", present: 0.5 });
    expect(computeDayStatus(4.2, 9)).toMatchObject({ band: "LOW", present: 0, absent: 1 });
  });
  it("overtime = worked − shift, none without a shift", () => {
    expect(computeOvertimeHours(10.5, 9)).toBe(1.5);
    expect(computeOvertimeHours(8, 9)).toBe(0);
    expect(computeOvertimeHours(12, null)).toBe(0);
  });
  it("late uses IST shift start + grace", () => {
    const d = "2026-10-23";
    expect(computeIsLateIst(ist(d, "09:40"), "09:30", 10)).toBe(false);
    expect(computeIsLateIst(ist(d, "09:41"), "09:30", 10)).toBe(true);
    expect(computeIsLateIst(ist(d, "09:41"), null)).toBeNull();
  });
});

describe("geofence", () => {
  it("coordinate validation rejects (0,0) and out-of-range", () => {
    expect(isValidCoordinate(0, 0)).toBe(false);
    expect(isValidCoordinate(91, 10)).toBe(false);
    expect(isValidCoordinate(28.6139, 77.209)).toBe(true);
  });
  it("haversine ~ 111 km per degree latitude", () => {
    expect(Math.round(haversineMeters(28, 77, 29, 77) / 1000)).toBe(111);
  });
  it("radius default 100, minimum 10", () => {
    expect(effectiveRadius(null)).toBe(100);
    expect(effectiveRadius(5)).toBe(10);
    expect(effectiveRadius(250)).toBe(250);
  });
  it("nearest inside wins; outside reports the nearest location", () => {
    const locs = [
      { id: "far", latitude: 28.6, longitude: 77.2, radiusMeters: 50_000 },
      { id: "near", latitude: 28.6139, longitude: 77.209, radiusMeters: 100 },
    ];
    expect(evaluateGeofence(28.6139, 77.2091, locs)).toMatchObject({ inside: true, location: { id: "near" } });
    const out = evaluateGeofence(19.07, 72.87, locs);
    expect(out.inside).toBe(false);
    expect(out.location?.id).toBeDefined();
    expect(out.distanceMeters).toBeGreaterThan(1_000_000);
  });
});

describe("leave", () => {
  it("fractions (fix F1)", () => {
    expect(leaveFraction("FULL")).toBe(1);
    expect(leaveFraction("S_HALF")).toBe(0.5);
    expect(leaveFraction("QR3")).toBe(0.25);
  });
  it("deducts remaining first, then carry; unpaid when short", () => {
    expect(planLeaveDeduction(1, 0.5, 2)).toEqual({ paymentType: "PAID", fromRemaining: 0.5, fromCarry: 0.5 });
    expect(planLeaveDeduction(0.5, 1, 0)).toEqual({ paymentType: "PAID", fromRemaining: 0.5, fromCarry: 0 });
    expect(planLeaveDeduction(1, 0.25, 0.5)).toEqual({ paymentType: "NOT_PAID", fromRemaining: 0, fromCarry: 0 });
  });
});
