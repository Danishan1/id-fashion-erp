/**
 * CRM Activities, Tasks & Follow-ups (Phase 09) against a real, migrated +
 * seeded Postgres database.
 *
 * Skipped unless CRM_IT_DATABASE_URL points at a DISPOSABLE database:
 *   CRM_IT_DATABASE_URL=postgresql://…/crm_it npx vitest run src/modules/crm/activities/activities.integration.test.ts
 *
 * Only permissions are mocked: `crm.view_all` is granted to "manager";
 * users in `noCrm` have no CRM access (can't be assigned).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const DB_URL = process.env.CRM_IT_DATABASE_URL;
if (DB_URL) process.env.DATABASE_URL = DB_URL;

const viewAllUsers = new Set<string>();
const noCrm = new Set<string>();
vi.mock("@/core/rbac/PermissionService", () => ({
  PermissionService: {
    can: vi.fn(async (userId: string, module: string, action: string) => {
      if (action === "view_all") return viewAllUsers.has(userId);
      if (module === "crm") return !noCrm.has(userId);
      return true;
    }),
    assert: vi.fn(async () => undefined),
    getAllowedBranchIds: vi.fn(async () => null),
    invalidate: vi.fn(),
  },
}));

type Actor = { companyId: string; userId: string; branchId: string | null };

describe.skipIf(!DB_URL)("CRM activities (database integration)", async () => {
  const { prisma } = await import("@/core/db/client");
  const svc = await import("./crm-activities.service");
  const opps = await import("../opportunities/crm-opportunities.service");
  const companies = await import("../companies/crm-companies.service");
  const contacts = await import("../contacts/crm-contacts.service");
  const merge = await import("../contacts/contact-merge.service");
  const events = await import("../core/crm-events.service");
  const { addCalendarDays, businessToday } = await import("../core/crm-dates");

  const run = `a${Date.now().toString(36)}`;
  let manager: Actor;
  let rep: Actor;
  let otherRep: Actor;
  let outsider: Actor;
  const expectCode = (p: Promise<unknown>, code: string) => expect(p).rejects.toMatchObject({ code });
  const name = (n: string) => `${n} ${run}`;
  const raw = (id: string) => prisma.crmActivity.findUniqueOrThrow({ where: { id } });
  const eventTypes = async (id: string) => (await prisma.crmEvent.findMany({ where: { entityType: "ACTIVITY", entityId: id }, orderBy: { occurredAt: "asc" } })).map((e) => e.eventType);
  const today = businessToday();
  const tomorrow = addCalendarDays(today, 1);
  const nextWeek = addCalendarDays(today, 7);
  const yesterday = addCalendarDays(today, -1);
  let deal: { id: string; crmCompanyId: string | null; crmContactId: string | null };
  let co: { id: string };
  let ct: { id: string };

  beforeAll(async () => {
    const company = await prisma.company.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
    const mk = (n: string) => prisma.user.create({ data: { companyId: company.id, email: `${n}.${run}@crm-it.local`, passwordHash: "x", fullName: `${n} ${run}` } });
    const [m, r, o, x] = await Promise.all([mk("amanager"), mk("arep"), mk("aother"), mk("anocrm")]);
    manager = { companyId: company.id, userId: m.id, branchId: null };
    rep = { companyId: company.id, userId: r.id, branchId: null };
    otherRep = { companyId: company.id, userId: o.id, branchId: null };
    outsider = { companyId: company.id, userId: x.id, branchId: null };
    viewAllUsers.add(m.id);
    noCrm.add(x.id);
    co = await companies.createCompany(rep, { name: name("ABC Textiles"), phone: `9${String(Date.now()).slice(-9)}` });
    ct = await contacts.createContact(rep, { firstName: "Asha", lastName: run, crmCompanyId: co.id });
    const opp = await opps.createOpportunity(rep, { name: name("Winter Order"), crmCompanyId: co.id, crmContactId: ct.id });
    deal = { id: opp.id, crmCompanyId: co.id, crmContactId: ct.id };
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("creates a task on an opportunity, links it to the company and contact, notifies the assignee and shows it on all three timelines", async () => {
    const a = await svc.createActivity(rep, {
      type: "TASK",
      subject: "Follow up for quotation",
      entityType: "OPPORTUNITY",
      entityId: deal.id,
      assignedToUserId: otherRep.userId,
      dueDate: nextWeek,
      dueTime: "11:00",
      reminderMinutes: 30,
      priority: "HIGH",
    });
    expect(a).toMatchObject({ type: "TASK", status: "PENDING", priority: "HIGH", assignedToUserId: otherRep.userId, allDay: false, reminderState: "PENDING", reminderOffsetMinutes: 30, dueState: "UPCOMING" });
    expect(a.due).toEqual({ date: nextWeek, time: "11:00" });
    expect(new Date(a.reminderAt!).getTime()).toBe(new Date(a.dueAt!).getTime() - 30 * 60_000);
    expect(a.links[0]).toMatchObject({ entityType: "OPPORTUNITY", entityId: deal.id, isPrimary: true });
    expect(a.links.slice(1).map((l) => [l.entityType, l.isPrimary]).sort()).toEqual([
      ["COMPANY", false],
      ["CONTACT", false],
    ]);
    expect(await eventTypes(a.id)).toEqual(["activity.created", "activity.assigned"]);
    expect(await prisma.notification.count({ where: { userId: otherRep.userId, relatedModule: "CRM_ACTIVITY", relatedRecordId: a.id } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { tableName: "crm_activities", recordId: a.id, action: "CREATE" } })).toBe(1);
    for (const [entityType, entityId] of [
      ["OPPORTUNITY", deal.id],
      ["COMPANY", co.id],
      ["CONTACT", ct.id],
    ] as const) {
      const list = await svc.listActivities(rep, { entityType, entityId } as never, { sortBy: "dueAt", sortOrder: "asc" }, { skip: 0, take: 50 });
      expect(list.data.map((x) => x.id)).toContain(a.id);
    }
    // Opportunity timeline includes the activity's events (via the events API scope)
    const ids = await (await import("./crm-activity.repository")).CrmActivityRepository.linkedActivityIds(rep.companyId, "OPPORTUNITY", [deal.id]);
    const tl = await events.listCrmEvents(rep.companyId, { entityType: "OPPORTUNITY", entityId: deal.id }, { page: 1, pageSize: 50, skip: 0, take: 50, sortBy: "occurredAt", sortOrder: "desc" } as never, [], [{ entityType: "ACTIVITY", ids }]);
    expect(tl.data.map((e) => e.eventType)).toEqual(expect.arrayContaining(["activity.created", "activity.assigned", "opportunity.created"]));
  });

  it("validates type, related record, assignee, dates and reminders", async () => {
    const base = { type: "TASK", subject: "X", entityType: "OPPORTUNITY", entityId: deal.id };
    await expect(svc.createActivity(rep, { ...base, type: "FAX" })).rejects.toThrow();
    await expectCode(svc.createActivity(rep, { ...base, entityId: "00000000-0000-4000-8000-000000000000" }), "VALIDATION_ERROR");
    await expectCode(svc.createActivity(rep, { ...base, assignedToUserId: outsider.userId }), "VALIDATION_ERROR"); // no CRM access
    await expectCode(svc.createActivity(rep, { ...base, assignedToUserId: "00000000-0000-4000-8000-000000000000" }), "VALIDATION_ERROR");
    await expect(svc.createActivity(rep, { ...base, reminderMinutes: 30 })).rejects.toThrow(); // reminder without due date
    await expect(svc.createActivity(rep, { ...base, dueDate: nextWeek, reminderMinutes: 7 })).rejects.toThrow(); // not a listed reminder
    await expectCode(svc.createActivity(rep, { ...base, dueDate: yesterday, dueTime: "10:00", reminderMinutes: 0 }), "VALIDATION_ERROR"); // reminder in the past
    await expectCode(svc.createActivity(rep, { ...base, type: "EMAIL", mode: "schedule" }), "VALIDATION_ERROR");
    await expectCode(svc.createActivity(rep, { ...base, type: "TASK", mode: "log" }), "VALIDATION_ERROR");
    // A record the user can't see is "not found"
    const hidden = await opps.createOpportunity(otherRep, { name: name("Hidden deal") });
    await expectCode(svc.createActivity(rep, { ...base, entityId: hidden.id }), "VALIDATION_ERROR");
    // Archived record
    const arch = await opps.createOpportunity(rep, { name: name("Archived deal") });
    await opps.archiveOpportunity(rep, arch.id);
    await expectCode(svc.createActivity(rep, { ...base, entityId: arch.id }), "VALIDATION_ERROR");
  });

  it("derives due state and overdue in business time, and filters server-side", async () => {
    const mk = (subject: string, dueDate?: string, dueTime?: string) => svc.createActivity(rep, { type: "TASK", subject: name(subject), entityType: "CONTACT", entityId: ct.id, dueDate, dueTime });
    const over = await mk("Overdue timed", yesterday, "10:00");
    const overDay = await mk("Overdue all-day", yesterday);
    const tod = await mk("Today all-day", today);
    const tom = await mk("Tomorrow", tomorrow, "09:30");
    const none = await mk("No date");
    expect([over.dueState, overDay.dueState, tod.dueState, tom.dueState, none.dueState]).toEqual(["OVERDUE", "OVERDUE", "DUE_TODAY", "DUE_TOMORROW", "NO_DUE_DATE"]);
    const ids = async (due: string) => (await svc.listActivities(rep, { entityType: "CONTACT", entityId: ct.id, due } as never, { sortBy: "dueAt", sortOrder: "asc" }, { skip: 0, take: 100 })).data.map((x) => x.id);
    expect(await ids("overdue")).toEqual(expect.arrayContaining([over.id, overDay.id]));
    expect(await ids("overdue")).not.toContain(tod.id);
    expect(await ids("today")).toContain(tod.id);
    expect(await ids("tomorrow")).toEqual([tom.id]);
    expect(await ids("upcoming")).toContain(tom.id);
    expect(await ids("no_due_date")).toContain(none.id);
    // Completing removes it from overdue; overdue is never stored
    await svc.completeActivity(rep, over.id, {});
    expect(await ids("overdue")).not.toContain(over.id);
    expect(Object.keys(await raw(over.id))).not.toContain("overdue");
    // My Tasks counts (assigned to me by default)
    const counts = await svc.myTaskCounts(rep);
    expect(counts.overdue).toBeGreaterThanOrEqual(1);
    expect(counts.today).toBeGreaterThanOrEqual(1);
  });

  it("completes (idempotently), reopens, cancels and keeps completed history", async () => {
    const a = await svc.createActivity(rep, { type: "CALL", subject: name("Call back"), entityType: "OPPORTUNITY", entityId: deal.id, dueDate: nextWeek, dueTime: "15:00", reminderMinutes: 15 });
    const done = await svc.completeActivity(rep, a.id, { outcome: "Interested", note: "Wants samples", version: a.version });
    expect(done).toMatchObject({ status: "COMPLETED", completedByUserId: rep.userId, outcome: "Interested", reminderState: "CANCELLED", dueState: "COMPLETED" });
    expect(new Date(done.dueAt!).toISOString()).toBe(new Date(a.dueAt!).toISOString()); // due date preserved
    const again = await svc.completeActivity(rep, a.id, {});
    expect(again.version).toBe(done.version); // idempotent
    expect((await eventTypes(a.id)).filter((t) => t === "activity.completed")).toHaveLength(1);
    await expectCode(svc.deleteActivity(manager, a.id), "INVALID_STATE_TRANSITION"); // completed = history
    await expectCode(svc.updateActivity(rep, a.id, { version: done.version, subject: "x" }), "INVALID_STATE_TRANSITION");
    const reopened = await svc.reopenActivity(rep, a.id, {});
    expect(reopened).toMatchObject({ status: "PENDING", completedAt: null, reminderState: "PENDING" });
    const cancelled = await svc.cancelActivity(rep, a.id, { reason: "Customer travelling" });
    expect(cancelled.status).toBe("CANCELLED");
    expect(await eventTypes(a.id)).toEqual(["activity.created", "activity.completed", "activity.reopened", "activity.cancelled"]);
    // last activity bumped on the linked opportunity
    expect((await prisma.crmOpportunity.findUniqueOrThrow({ where: { id: deal.id } })).lastActivityAt).not.toBeNull();
  });

  it("reschedules with history (original due date kept) and re-arms the reminder", async () => {
    const a = await svc.createActivity(rep, { type: "MEETING", subject: name("Sampling review"), entityType: "COMPANY", entityId: co.id, dueDate: nextWeek, dueTime: "11:00", endTime: "12:00", reminderMinutes: 60 });
    const firstDue = a.dueAt;
    const r1 = await svc.rescheduleActivity(rep, a.id, { dueDate: addCalendarDays(nextWeek, 2), dueTime: "15:00", reason: "Buyer asked" });
    expect(r1).toMatchObject({ rescheduleCount: 1, reminderState: "PENDING", due: { date: addCalendarDays(nextWeek, 2), time: "15:00" } });
    expect(new Date(r1.originalDueAt!).toISOString()).toBe(new Date(firstDue!).toISOString());
    expect(new Date(r1.reminderAt!).getTime()).toBe(new Date(r1.dueAt!).getTime() - 60 * 60_000);
    const r2 = await svc.rescheduleActivity(rep, a.id, { dueDate: addCalendarDays(nextWeek, 3) });
    expect(r2).toMatchObject({ rescheduleCount: 2, allDay: true });
    expect(new Date(r2.originalDueAt!).toISOString()).toBe(new Date(firstDue!).toISOString());
    const ev = await prisma.crmEvent.findMany({ where: { entityType: "ACTIVITY", entityId: a.id, eventType: "activity.rescheduled" }, orderBy: { occurredAt: "asc" } });
    expect(ev).toHaveLength(2);
    expect(ev[0].payload).toMatchObject({ reason: "Buyer asked" });
    expect(await prisma.auditLog.count({ where: { tableName: "crm_activities", recordId: a.id, action: "UPDATE" } })).toBe(2);
    // Stale version
    await expectCode(svc.rescheduleActivity(rep, a.id, { dueDate: nextWeek, version: a.version }), "RECORD_VERSION_CONFLICT");
  });

  it("assigns and reassigns only to active CRM users, with notifications and history", async () => {
    const a = await svc.createActivity(rep, { type: "TASK", subject: name("Send price list"), entityType: "CONTACT", entityId: ct.id, dueDate: nextWeek });
    expect(a.assignedToUserId).toBe(rep.userId); // defaults to the creator
    await expectCode(svc.assignActivity(rep, a.id, { assignedToUserId: outsider.userId }), "VALIDATION_ERROR");
    const b = await svc.assignActivity(rep, a.id, { assignedToUserId: otherRep.userId });
    expect(b.assignedToUserId).toBe(otherRep.userId);
    expect(await prisma.notification.count({ where: { userId: otherRep.userId, relatedRecordId: a.id } })).toBe(1);
    // The new assignee can see and complete it even without access to the contact
    const seen = await svc.getActivity(otherRep, a.id);
    expect(seen.id).toBe(a.id);
    await svc.completeActivity(otherRep, a.id, {});
    // A user with no relation to it can't see it
    const stranger = await prisma.user.create({ data: { companyId: rep.companyId, email: `stranger.${run}@crm-it.local`, passwordHash: "x", fullName: `stranger ${run}` } });
    await expectCode(svc.getActivity({ ...rep, userId: stranger.id }, a.id), "NOT_FOUND");
    expect(await eventTypes(a.id)).toEqual(["activity.created", "activity.assigned", "activity.completed"]);
  });

  it("logs calls, meetings and messages as completed history on the record", async () => {
    const call = await svc.createActivity(rep, { type: "CALL", mode: "log", subject: name("Called ABC"), entityType: "OPPORTUNITY", entityId: deal.id, outcome: "Interested", durationMinutes: 12, occurredDate: today, occurredTime: "00:01" });
    expect(call).toMatchObject({ status: "COMPLETED", outcome: "Interested", direction: "OUTBOUND", durationMinutes: 12, reminderState: null });
    expect(await eventTypes(call.id)).toEqual(["activity.call_logged"]);
    const meet = await svc.createActivity(rep, { type: "MEETING", mode: "log", subject: name("Factory visit"), entityType: "COMPANY", entityId: co.id, location: "Tiruppur" });
    expect(await eventTypes(meet.id)).toEqual(["activity.meeting_logged"]);
    const wa = await svc.createActivity(rep, { type: "WHATSAPP", subject: name("Sent catalogue"), entityType: "CONTACT", entityId: ct.id, direction: "OUTBOUND" });
    expect(wa.status).toBe("COMPLETED");
    expect(await eventTypes(wa.id)).toEqual(["activity.message_logged"]);
    await expectCode(svc.createActivity(rep, { type: "CALL", mode: "log", subject: "Future", entityType: "CONTACT", entityId: ct.id, occurredDate: nextWeek }), "VALIDATION_ERROR");
    // Integrations log each external item once
    const ext = { type: "EMAIL", subject: name("Re: quotation"), entityType: "CONTACT", entityId: ct.id, source: "GMAIL", externalRef: `msg-${run}` };
    const e1 = await svc.createActivity(rep, ext);
    const e2 = await svc.createActivity(rep, ext);
    expect(e2.id).toBe(e1.id);
    const completed = await svc.listActivities(rep, { entityType: "CONTACT", entityId: ct.id, due: "completed", types: ["WHATSAPP", "EMAIL"] } as never, { sortBy: "completedAt", sortOrder: "desc" }, { skip: 0, take: 20 });
    expect(completed.data.map((x) => x.id)).toEqual(expect.arrayContaining([wa.id, e1.id]));
  });

  it("sends each due reminder exactly once, even when the job runs twice or concurrently", async () => {
    const a = await svc.createActivity(rep, { type: "TASK", subject: name("Reminder test"), entityType: "CONTACT", entityId: ct.id, dueDate: nextWeek, dueTime: "10:00", reminderMinutes: 0 });
    const gone = await svc.createActivity(rep, { type: "TASK", subject: name("Reminder deleted"), entityType: "CONTACT", entityId: ct.id, dueDate: nextWeek, dueTime: "10:00", reminderMinutes: 0 });
    await svc.deleteActivity(rep, gone.id);
    const at = new Date(new Date(a.dueAt!).getTime() + 1000);
    const [r1, r2] = await Promise.all([svc.processDueActivityReminders(at), svc.processDueActivityReminders(at)]);
    const r3 = await svc.processDueActivityReminders(at);
    expect(r1.sent + r2.sent + r3.sent).toBeGreaterThanOrEqual(1);
    expect(await prisma.notification.count({ where: { relatedRecordId: a.id, title: { startsWith: "Reminder" } } })).toBe(1);
    expect(await raw(a.id)).toMatchObject({ reminderState: "SENT" });
    expect((await eventTypes(a.id)).filter((t) => t === "activity.reminder_sent")).toHaveLength(1);
    expect((await raw(gone.id)).reminderState).toBe("CANCELLED");
    // Rescheduling re-arms it
    const r = await svc.rescheduleActivity(rep, a.id, { dueDate: addCalendarDays(nextWeek, 1), dueTime: "10:00" });
    expect(r.reminderState).toBe("PENDING");
  });

  it("deletes softly (creator or manager only) and runs bulk actions record by record", async () => {
    const a = await svc.createActivity(rep, { type: "TASK", subject: name("Bulk 1"), entityType: "CONTACT", entityId: ct.id, dueDate: nextWeek });
    const b = await svc.createActivity(rep, { type: "TASK", subject: name("Bulk 2"), entityType: "CONTACT", entityId: ct.id, dueDate: nextWeek });
    const c = await svc.createActivity(rep, { type: "TASK", subject: name("Bulk 3"), entityType: "CONTACT", entityId: ct.id });
    await svc.completeActivity(rep, c.id, {});
    const res = await svc.bulkActivityAction(rep, { action: "complete", ids: [a.id, b.id, c.id, "00000000-0000-4000-8000-000000000000"] });
    expect(res.updated).toBe(2);
    expect(res.skipped).toEqual(expect.arrayContaining([expect.objectContaining({ id: c.id, reason: "Already completed" }), expect.objectContaining({ reason: "Not found or not visible to you" })]));
    const p = await svc.bulkActivityAction(rep, { action: "priority", ids: [a.id], priority: "URGENT" });
    expect(p.skipped[0].reason).toMatch(/completed/i); // completed items can't be edited
    const d = await svc.createActivity(rep, { type: "TASK", subject: name("Delete me"), entityType: "CONTACT", entityId: ct.id });
    await svc.assignActivity(rep, d.id, { assignedToUserId: otherRep.userId });
    await expectCode(svc.deleteActivity(otherRep, d.id), "PERMISSION_DENIED");
    await svc.deleteActivity(rep, d.id);
    expect((await raw(d.id)).deletedAt).not.toBeNull();
    await expectCode(svc.getActivity(rep, d.id), "NOT_FOUND");
  });

  it("moves activities to the survivor when contacts are merged", async () => {
    const dup = await contacts.createContact(rep, { firstName: "Asha", lastName: `${run}-dup`, crmCompanyId: co.id, confirmDuplicate: true });
    const a = await svc.createActivity(rep, { type: "TASK", subject: name("On duplicate"), entityType: "CONTACT", entityId: dup.id });
    const [s0, d0] = await Promise.all([prisma.crmContact.findUniqueOrThrow({ where: { id: ct.id } }), prisma.crmContact.findUniqueOrThrow({ where: { id: dup.id } })]);
    const result = await merge.mergeContacts(manager, { survivorId: ct.id, mergedId: dup.id, survivorVersion: s0.version, mergedVersion: d0.version });
    expect(result.moved).toMatchObject({ activities: 1 });
    const after = await raw(a.id);
    expect(after.entityId).toBe(ct.id);
    const links = await prisma.crmActivityLink.findMany({ where: { activityId: a.id } });
    expect(links.map((l) => l.entityId)).toContain(ct.id);
    expect(links.map((l) => l.entityId)).not.toContain(dup.id);
  });
});
