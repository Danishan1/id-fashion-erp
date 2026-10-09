import { describe, expect, it } from "vitest";
import { addDays, isValidTimeZone, NonexistentLocalTimeError, startOfWeek, zoneAbbreviation, zonedDayStart, zonedParts, zonedToInstant, zoneOffsetMinutes } from "../core/crm-timezone";
import { allowedAppointmentActions, APPOINTMENT_STATUS_KEYS, APPOINTMENT_TRANSITIONS, canTransition, isOpenAppointmentStatus, rangesOverlap } from "./appointment-registry";
import { appointmentFilterSchema, createAppointmentSchema, parseAppointmentFilterParams, updateAppointmentSchema, videoLinkSchema } from "./appointment.schema";

describe("time zones (Intl tz database, no hand-written DST rules)", () => {
  it("converts wall-clock times to instants and back", () => {
    expect(zonedToInstant("2026-10-15", "11:00", "Asia/Kolkata").toISOString()).toBe("2026-10-15T05:30:00.000Z");
    expect(zonedToInstant("2026-10-15", "11:00", "UTC").toISOString()).toBe("2026-10-15T11:00:00.000Z");
    expect(zonedParts("2026-10-15T05:30:00.000Z", "Europe/London")).toMatchObject({ date: "2026-10-15", time: "06:30", weekday: 4 });
    expect(zonedParts("2026-10-15T05:30:00.000Z", "America/New_York")).toMatchObject({ date: "2026-10-15", time: "01:30" });
    // Day boundary: 10:00 IST on the 1st is still the previous day in New York.
    expect(zonedParts(zonedToInstant("2026-11-01", "10:00", "Asia/Kolkata"), "America/Los_Angeles").date).toBe("2026-10-31");
  });

  it("handles daylight-saving changes in London and New York", () => {
    expect(zoneOffsetMinutes(new Date("2026-01-15T12:00:00Z"), "Europe/London")).toBe(0);
    expect(zoneOffsetMinutes(new Date("2026-07-15T12:00:00Z"), "Europe/London")).toBe(60);
    // Spring forward: 01:30 doesn't exist.
    expect(() => zonedToInstant("2026-03-29", "01:30", "Europe/London")).toThrow(NonexistentLocalTimeError);
    expect(() => zonedToInstant("2026-03-08", "02:30", "America/New_York")).toThrow(NonexistentLocalTimeError);
    // Fall back: 01:30 happens twice — the first one (still summer time) is used.
    expect(zonedToInstant("2026-10-25", "01:30", "Europe/London").toISOString()).toBe("2026-10-25T00:30:00.000Z");
    expect(zonedToInstant("2026-11-01", "01:30", "America/New_York").toISOString()).toBe("2026-11-01T05:30:00.000Z");
    // A day with the clock change is 25 hours long.
    expect((zonedDayStart("2026-10-26", "Europe/London").getTime() - zonedDayStart("2026-10-25", "Europe/London").getTime()) / 3_600_000).toBe(25);
    // Same wall time before and after the change → instants 1 hour apart beyond the day gap.
    const before = zonedToInstant("2026-10-24", "10:00", "Europe/London").getTime();
    const after = zonedToInstant("2026-10-26", "10:00", "Europe/London").getTime();
    expect((after - before) / 3_600_000).toBe(49);
  });

  it("validates zones and labels them", () => {
    expect(isValidTimeZone("Asia/Kolkata")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
    expect(zoneAbbreviation("2026-10-15T05:30:00Z", "Asia/Kolkata")).toBe("IST");
    expect(zoneAbbreviation("2026-07-15T05:30:00Z", "Europe/London")).toBe("BST");
    expect(zoneAbbreviation("2026-01-15T05:30:00Z", "America/New_York")).toBe("EST");
    expect(startOfWeek("2026-10-15")).toBe("2026-10-12");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("computes reminder times as an offset from the absolute start, whatever the viewer's zone", () => {
    const start = zonedToInstant("2026-10-15", "10:00", "Asia/Kolkata");
    const reminder = new Date(start.getTime() - 30 * 60_000);
    expect(zonedParts(reminder, "Asia/Kolkata").time).toBe("09:30");
    expect(zonedParts(reminder, "Europe/London").time).toBe("05:00");
  });
});

describe("appointment lifecycle", () => {
  it("allows exactly the documented transitions", () => {
    const allowed: [string, string][] = [
      ["SCHEDULED", "CONFIRMED"],
      ["SCHEDULED", "CANCELLED"],
      ["SCHEDULED", "NO_SHOW"],
      ["SCHEDULED", "RESCHEDULED"],
      ["CONFIRMED", "COMPLETED"],
      ["CONFIRMED", "CANCELLED"],
      ["CONFIRMED", "NO_SHOW"],
      ["CONFIRMED", "RESCHEDULED"],
      ["RESCHEDULED", "CONFIRMED"],
    ];
    for (const [from, to] of allowed) expect(canTransition(from, to as never)).toBe(true);
    const refused: [string, string][] = [
      ["CONFIRMED", "CONFIRMED"],
      ["COMPLETED", "CONFIRMED"],
      ["COMPLETED", "CANCELLED"],
      ["CANCELLED", "COMPLETED"],
      ["CANCELLED", "RESCHEDULED"],
      ["NO_SHOW", "COMPLETED"],
      ["NO_SHOW", "RESCHEDULED"],
      ["PENDING", "CONFIRMED"],
    ];
    for (const [from, to] of refused) expect(canTransition(from, to as never)).toBe(false);
    for (const s of ["COMPLETED", "CANCELLED", "NO_SHOW"] as const) expect(APPOINTMENT_TRANSITIONS[s]).toEqual([]);
    expect(APPOINTMENT_STATUS_KEYS.filter(isOpenAppointmentStatus)).toEqual(["SCHEDULED", "CONFIRMED", "RESCHEDULED"]);
  });

  it("derives the actions a status offers", () => {
    expect(allowedAppointmentActions("SCHEDULED")).toEqual({ actions: ["confirm", "reschedule", "complete", "cancel", "no_show"], edit: true, assign: true });
    expect(allowedAppointmentActions("CONFIRMED").actions).toEqual(["reschedule", "complete", "cancel", "no_show"]);
    expect(allowedAppointmentActions("CANCELLED")).toEqual({ actions: [], edit: false, assign: false });
  });

  it("treats touching appointments as free and any overlap as a conflict", () => {
    const at = (h: number, m = 0) => Date.UTC(2026, 9, 15, h, m);
    const existing = { start: at(10), end: at(11) };
    expect(rangesOverlap(existing, { start: at(10), end: at(11) })).toBe(true); // exact
    expect(rangesOverlap(existing, { start: at(10, 30), end: at(11, 30) })).toBe(true); // partial
    expect(rangesOverlap(existing, { start: at(9), end: at(12) })).toBe(true); // containing
    expect(rangesOverlap(existing, { start: at(11), end: at(12) })).toBe(false); // adjacent after
    expect(rangesOverlap(existing, { start: at(9), end: at(10) })).toBe(false); // adjacent before
  });
});

describe("appointment schemas", () => {
  const base = { title: "Demo", startDate: "2026-10-15", startTime: "11:00", endTime: "12:00", timezone: "Asia/Kolkata", contactId: "6f1c2f1e-1f2a-4b1a-9d1a-2b3c4d5e6f70" };
  it("accepts a valid appointment and rejects bad zones, links and reminders", () => {
    expect(createAppointmentSchema.safeParse(base).success).toBe(true);
    expect(createAppointmentSchema.safeParse({ ...base, timezone: "Nowhere/City" }).success).toBe(false);
    expect(createAppointmentSchema.safeParse({ ...base, reminderMinutes: 7 }).success).toBe(false);
    expect(createAppointmentSchema.safeParse({ ...base, startTime: "25:00" }).success).toBe(false);
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "meet.example.com", "ftp://x.y"]) expect(videoLinkSchema.safeParse(bad).success).toBe(false);
    expect(videoLinkSchema.safeParse("https://meet.google.com/abc-defg-hij").success).toBe(true);
    expect(createAppointmentSchema.parse({ ...base, videoLink: "" }).videoLink).toBeNull();
  });

  it("requires start and end together when editing times", () => {
    expect(updateAppointmentSchema.safeParse({ version: 1, startDate: "2026-10-15" }).success).toBe(false);
    expect(updateAppointmentSchema.safeParse({ version: 1, startDate: "2026-10-15", startTime: "10:00", endTime: "11:00" }).success).toBe(true);
    expect(updateAppointmentSchema.safeParse({ version: 1, status: "COMPLETED" }).success).toBe(false); // status only via actions
  });

  it("parses calendar filters and caps the window", () => {
    const f = parseAppointmentFilterParams(new URLSearchParams({ from: "2026-10-01T00:00:00+05:30", to: "2026-11-01T00:00:00+05:30", statuses: "SCHEDULED,CONFIRMED", appointmentTypes: "Product demo|Site / factory visit", mine: "true" }));
    expect(f).toMatchObject({ statuses: ["SCHEDULED", "CONFIRMED"], appointmentTypes: ["Product demo", "Site / factory visit"], mine: "true" });
    expect(appointmentFilterSchema.safeParse({ from: "2026-01-01T00:00:00Z", to: "2026-04-01T00:00:00Z" }).success).toBe(false);
    expect(appointmentFilterSchema.safeParse({ from: "2026-02-01T00:00:00Z", to: "2026-01-01T00:00:00Z" }).success).toBe(false);
  });
});
