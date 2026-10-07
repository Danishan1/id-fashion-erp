import { describe, expect, it, vi } from "vitest";

vi.mock("@/core/db/client", () => ({ prisma: {} }));
vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/core/rbac/PermissionService", () => ({ PermissionService: { can: vi.fn(async () => true) } }));

const { dueState, dueFilterWhere, dueFromParts, reminderTime, dueParts, isOverdue } = await import("./activity-due");
const reg = await import("./activity-registry");
const schema = await import("./activity.schema");
const { buildActivityWhere } = await import("./crm-activities.service");
const { CRM_EVENT_TYPES } = await import("../core/crm-event-types");
const { CRM_OPTION_LIST_KEYS, DEFAULT_OPTION_VALUES } = await import("../contacts/contact-registry");

const A = "6f1c2f1e-1f2a-4b1a-9d1a-2b3c4d5e6f70";
// 15 Oct 2026, 11:30 IST
const NOW = new Date("2026-10-15T06:00:00.000Z");

describe("activity registry", () => {
  it("defines every type once, with schedule / log capabilities and timeline events", () => {
    expect(reg.ACTIVITY_TYPE_KEYS).toEqual(["TASK", "CALL", "MEETING", "APPOINTMENT", "EMAIL", "SMS", "WHATSAPP", "OTHER"]);
    expect(reg.SCHEDULABLE_TYPES).toEqual(expect.arrayContaining(["TASK", "CALL", "MEETING", "APPOINTMENT"]));
    expect(reg.SCHEDULABLE_TYPES).not.toContain("EMAIL");
    expect(reg.LOGGABLE_TYPES).toEqual(expect.arrayContaining(["CALL", "MEETING", "EMAIL", "SMS", "WHATSAPP"]));
    expect(reg.LOGGABLE_TYPES).not.toContain("TASK");
    for (const t of reg.LOGGABLE_TYPES) expect(CRM_EVENT_TYPES).toHaveProperty(reg.ACTIVITY_TYPES[t].logEvent!);
    for (const e of ["activity.created", "activity.assigned", "activity.rescheduled", "activity.completed", "activity.reopened", "activity.reminder_sent"]) expect(CRM_EVENT_TYPES).toHaveProperty(e);
  });
  it("registers configurable call / meeting outcomes as admin option lists", () => {
    expect(CRM_OPTION_LIST_KEYS).toEqual(expect.arrayContaining(["activity_call_outcome", "activity_meeting_outcome"]));
    expect(DEFAULT_OPTION_VALUES.activity_call_outcome).toContain("No answer");
    expect(reg.reminderLabel(null)).toBe("No reminder");
    expect(reg.reminderLabel(30)).toBe("30 minutes before");
  });
});

describe("due dates (business time zone)", () => {
  const t = (iso: string, allDay = false, status = "PENDING") => ({ status, allDay, dueAt: new Date(iso) });
  it("derives overdue / today / tomorrow / upcoming without storing it", () => {
    expect(dueState(t("2026-10-15T05:00:00.000Z"), NOW)).toBe("OVERDUE"); // 10:30 IST today, passed
    expect(dueState(t("2026-10-15T08:00:00.000Z"), NOW)).toBe("DUE_TODAY");
    expect(dueState(t("2026-10-14T18:30:00.000Z", true), NOW)).toBe("DUE_TODAY"); // all-day today (IST midnight)
    expect(dueState(t("2026-10-13T18:30:00.000Z", true), NOW)).toBe("OVERDUE"); // all-day yesterday
    expect(dueState(t("2026-10-16T04:00:00.000Z"), NOW)).toBe("DUE_TOMORROW");
    expect(dueState(t("2026-10-20T04:00:00.000Z"), NOW)).toBe("UPCOMING");
    expect(dueState({ status: "PENDING", allDay: false, dueAt: null }, NOW)).toBe("NO_DUE_DATE");
    expect(dueState(t("2026-10-01T04:00:00.000Z", false, "COMPLETED"), NOW)).toBe("COMPLETED");
    expect(isOverdue(t("2026-10-01T04:00:00.000Z", false, "CANCELLED"), NOW)).toBe(false);
    // 23:00 UTC on 15 Oct is 04:30 on 16 Oct in India: a task due 16 Oct 09:00 IST is "today" then
    expect(dueState(t("2026-10-16T03:30:00.000Z"), new Date("2026-10-15T23:00:00.000Z"))).toBe("DUE_TODAY");
  });
  it("builds due instants, reminder times and display parts", () => {
    expect(dueFromParts("2026-10-10", "11:00")).toEqual({ dueAt: new Date("2026-10-10T05:30:00.000Z"), allDay: false });
    expect(dueFromParts("2026-10-10")).toEqual({ dueAt: new Date("2026-10-09T18:30:00.000Z"), allDay: true });
    expect(reminderTime(new Date("2026-10-10T05:30:00.000Z"), false, 30)).toEqual(new Date("2026-10-10T05:00:00.000Z"));
    expect(reminderTime(new Date("2026-10-09T18:30:00.000Z"), true, 0)).toEqual(new Date("2026-10-10T03:30:00.000Z")); // 09:00 IST on the day
    expect(reminderTime(new Date("2026-10-10T05:30:00.000Z"), false, 1440)).toEqual(new Date("2026-10-09T05:30:00.000Z"));
    expect(dueParts(new Date("2026-10-10T05:30:00.000Z"), false)).toEqual({ date: "2026-10-10", time: "11:00" });
    expect(dueParts(new Date("2026-10-09T18:30:00.000Z"), true)).toEqual({ date: "2026-10-10", time: null });
  });
  it("turns quick filters into server-side conditions on open items", () => {
    const over = JSON.stringify(dueFilterWhere("overdue", NOW));
    // Open = pending / in progress, and open appointments (Phase 10).
    expect(over).toContain('"status":{"in":["PENDING","IN_PROGRESS","SCHEDULED","CONFIRMED","RESCHEDULED"]}');
    expect(over).toContain(`{"allDay":false,"dueAt":{"lt":"${NOW.toISOString()}"}}`);
    expect(over).toContain('{"allDay":true,"dueAt":{"lt":"2026-10-14T18:30:00.000Z"}}');
    expect(JSON.stringify(dueFilterWhere("tomorrow", NOW))).toContain('"gte":"2026-10-15T18:30:00.000Z"');
    expect(dueFilterWhere("completed", NOW)).toEqual({ status: "COMPLETED" });
    expect(JSON.stringify(dueFilterWhere("no_due_date", NOW))).toContain('"dueAt":null');
  });
});

describe("activity schemas", () => {
  const base = { type: "TASK", subject: "Follow up", entityType: "OPPORTUNITY", entityId: A };
  it("accepts a scheduled task and rejects bad types, records, times and reminders", () => {
    expect(schema.createActivitySchema.parse({ ...base, dueDate: "2026-10-10", dueTime: "11:00", reminderMinutes: "30", priority: "HIGH" })).toMatchObject({ reminderMinutes: 30, priority: "HIGH" });
    expect(schema.createActivitySchema.safeParse({ ...base, type: "FAX" }).success).toBe(false);
    expect(schema.createActivitySchema.safeParse({ ...base, entityType: "SUPPLIER" }).success).toBe(false);
    expect(schema.createActivitySchema.safeParse({ ...base, entityId: "x" }).success).toBe(false);
    expect(schema.createActivitySchema.safeParse({ ...base, dueTime: "11:00" }).success).toBe(false); // time without date
    expect(schema.createActivitySchema.safeParse({ ...base, dueDate: "2026-10-10", dueTime: "25:00" }).success).toBe(false);
    expect(schema.createActivitySchema.safeParse({ ...base, reminderMinutes: 30 }).success).toBe(false); // reminder without date
    expect(schema.createActivitySchema.safeParse({ ...base, dueDate: "2026-10-10", reminderMinutes: 7 }).success).toBe(false);
    expect(schema.createActivitySchema.safeParse({ ...base, type: "MEETING", dueDate: "2026-10-10", dueTime: "11:00", endTime: "10:00" }).success).toBe(false);
    expect(schema.createActivitySchema.safeParse({ ...base, subject: " " }).success).toBe(false);
    expect(schema.createActivitySchema.safeParse({ ...base, externalRef: "m1" }).success).toBe(false); // needs a source
    expect(schema.createActivitySchema.safeParse({ ...base, source: "gmail", externalRef: "m1" }).success).toBe(false); // UPPER_CASE source
  });
  it("keeps completion, status and type out of edits and validates actions", () => {
    expect(schema.updateActivitySchema.safeParse({ version: 1, status: "COMPLETED" }).success).toBe(false);
    expect(schema.updateActivitySchema.safeParse({ version: 1, type: "CALL" }).success).toBe(false);
    expect(schema.updateActivitySchema.safeParse({ subject: "x" }).success).toBe(false);
    expect(schema.rescheduleActivitySchema.safeParse({ dueDate: "2026-10-12", dueTime: "15:00" }).success).toBe(true);
    expect(schema.rescheduleActivitySchema.safeParse({}).success).toBe(false);
    expect(schema.bulkActivitySchema.safeParse({ action: "complete", ids: [A] }).success).toBe(true);
    expect(schema.bulkActivitySchema.safeParse({ action: "delete", ids: [A] }).success).toBe(false);
  });
  it("parses list filters from the query string", () => {
    const f = schema.parseActivityFilterParams(new URLSearchParams({ types: "TASK,CALL", due: "overdue", mine: "assigned", entityType: "CONTACT", entityId: A }));
    expect(f).toMatchObject({ types: ["TASK", "CALL"], due: "overdue", mine: "assigned", entityType: "CONTACT", entityId: A });
    expect(() => schema.parseActivityFilterParams(new URLSearchParams({ entityId: A }))).toThrow();
    expect(() => schema.parseActivityFilterParams(new URLSearchParams({ due: "someday" }))).toThrow();
    expect(() => schema.parseActivityFilterParams(new URLSearchParams({ dueFrom: "2026-10-10", dueTo: "2026-10-01" }))).toThrow();
  });
});

describe("activity list scope", () => {
  const actor = { companyId: "co-1", userId: "u1", branchId: null };
  it("limits users without view_all to activities assigned to or created by them, except on a record they can open", () => {
    const own = JSON.stringify(buildActivityWhere(actor, { mode: "OWN", userId: "u1" }, {} as never, undefined, NOW));
    expect(own).toContain('{"companyId":"co-1","deletedAt":null}');
    expect(own).toContain('{"OR":[{"assignedToUserId":"u1"},{"createdByUserId":"u1"}]}');
    const record = JSON.stringify(buildActivityWhere(actor, { mode: "OWN", userId: "u1" }, { entityType: "CONTACT", entityId: A } as never, undefined, NOW));
    expect(record).toContain(`"links":{"some":{"entityType":"CONTACT","entityId":"${A}"}}`);
    expect(record).not.toContain('"createdByUserId":"u1"');
    const all = JSON.stringify(buildActivityWhere(actor, { mode: "ALL" }, { search: undefined, unassigned: "true", assignedToUserIds: [A] } as never, "quote", NOW));
    expect(all).toContain('{"OR":[{"assignedToUserId":{"in":["' + A + '"]}},{"assignedToUserId":null}]}');
    expect(all).toContain('"subject":{"contains":"quote","mode":"insensitive"}');
  });
});
