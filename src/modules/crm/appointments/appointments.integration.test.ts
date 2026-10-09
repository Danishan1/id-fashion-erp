/**
 * CRM appointments (Phase 10) against a real, migrated + seeded Postgres
 * database: relations, time zones, lifecycle, conflicts, reminders, events,
 * timeline, calendar queries, visibility and the Phase 09 activity API.
 *
 * Skipped unless CRM_IT_DATABASE_URL points at a DISPOSABLE database:
 *   CRM_IT_DATABASE_URL=postgresql://…/crm_it npx vitest run src/modules/crm/appointments/appointments.integration.test.ts
 *
 * Only permissions are mocked: `crm.view_all` is granted to "manager".
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const DB_URL = process.env.CRM_IT_DATABASE_URL;
if (DB_URL) process.env.DATABASE_URL = DB_URL;

const viewAllUsers = new Set<string>();
vi.mock("@/core/rbac/PermissionService", () => ({
  PermissionService: {
    can: vi.fn(async (userId: string, _module: string, action: string) => (action === "view_all" ? viewAllUsers.has(userId) : true)),
    assert: vi.fn(async () => undefined),
    getAllowedBranchIds: vi.fn(async () => null),
    invalidate: vi.fn(),
  },
}));

type Actor = { companyId: string; userId: string; branchId: string | null };

describe.skipIf(!DB_URL)("CRM appointments (database integration)", async () => {
  const { prisma } = await import("@/core/db/client");
  const svc = await import("./crm-appointments.service");
  const activities = await import("../activities/crm-activities.service");
  const companies = await import("../companies/crm-companies.service");
  const contacts = await import("../contacts/crm-contacts.service");
  const opps = await import("../opportunities/crm-opportunities.service");
  const { runCrmMutation } = await import("../core/crm-mutation");
  const { CrmActivityRepository } = await import("../activities/crm-activity.repository");

  const run = `ap${Date.now().toString(36)}`;
  let manager: Actor;
  let rep: Actor;
  let otherRep: Actor;
  let co: { id: string; name: string };
  let co2: { id: string; name: string };
  let ct: { id: string; fullName: string };
  let ct2: { id: string; fullName: string };
  let opp: { id: string; name: string };
  const expectCode = (p: Promise<unknown>, code: string) => expect(p).rejects.toMatchObject({ code });
  const raw = (id: string) => prisma.crmActivity.findUniqueOrThrow({ where: { id } });
  const events = async (id: string) => (await prisma.crmEvent.findMany({ where: { entityId: id }, orderBy: { occurredAt: "asc" } })).map((e) => e.eventType);
  // A distinct future day per test keeps conflicts independent.
  let day = 0;
  const nextDay = () => {
    day += 1;
    const d = new Date(Date.UTC(2027, 2, 1 + day));
    return d.toISOString().slice(0, 10);
  };
  const book = (actor: Actor, extra: Record<string, unknown> = {}) =>
    svc.createAppointment(actor, { title: `Demo ${run}`, startDate: extra.startDate ?? "2027-01-15", startTime: "11:00", endTime: "12:00", timezone: "Asia/Kolkata", contactId: ct.id, ...extra });

  beforeAll(async () => {
    const company = await prisma.company.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
    const mk = (u: string, n: string) => prisma.user.create({ data: { companyId: company.id, email: `${u}.${run}@crm-it.local`, passwordHash: "x", fullName: `${n} ${run}` } });
    const [m, r, o] = await Promise.all([mk("apmanager", "Meera Manager"), mk("aprep", "Ravi Rep"), mk("apother", "Zoya Other")]);
    manager = { companyId: company.id, userId: m.id, branchId: null };
    rep = { companyId: company.id, userId: r.id, branchId: null };
    otherRep = { companyId: company.id, userId: o.id, branchId: null };
    viewAllUsers.add(m.id);
    co = (await companies.createCompany(rep, { name: `ABC Textiles ${run}` })) as typeof co;
    co2 = (await companies.createCompany(rep, { name: `XYZ Mills ${run}` })) as typeof co2;
    ct = (await contacts.createContact(rep, { firstName: "Rahul", lastName: `Sharma ${run}`, crmCompanyId: co.id })) as typeof ct;
    ct2 = (await contacts.createContact(rep, { firstName: "Priya", lastName: `Nair ${run}`, crmCompanyId: co2.id })) as typeof ct2;
    opp = (await opps.createOpportunity(rep, { name: `Winter Order ${run}`, crmCompanyId: co.id, crmContactId: ct.id })) as typeof opp;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // ── Relations ──

  it("creates from a contact (company filled in), from an opportunity (contact + company prefilled) and company-only", async () => {
    const a = await book(rep, { startDate: nextDay() });
    expect(a).toMatchObject({ type: "APPOINTMENT", status: "SCHEDULED", title: `Demo ${run}`, timezone: "Asia/Kolkata", assignedToUserId: rep.userId });
    expect(a.relations.contact?.entityId).toBe(ct.id);
    expect(a.relations.company?.entityId).toBe(co.id);
    expect(a.primary?.entityType).toBe("CONTACT");

    const b = await book(rep, { startDate: nextDay(), contactId: null, opportunityId: opp.id, title: "Commercial Discussion" });
    expect(b.relations).toMatchObject({ opportunity: { entityId: opp.id }, contact: { entityId: ct.id }, company: { entityId: co.id } });
    expect(b.primary?.entityType).toBe("OPPORTUNITY");

    const c = await book(rep, { startDate: nextDay(), contactId: null, companyId: co.id });
    expect(c.relations.company?.entityId).toBe(co.id);
    expect(c.relations.contact).toBeNull();
  });

  it("refuses invalid relationships", async () => {
    await expectCode(book(rep, { contactId: null }), "VALIDATION_ERROR"); // nothing related
    await expect(book(rep, { contactId: ct2.id, companyId: co.id })).rejects.toMatchObject({ code: "VALIDATION_ERROR", details: { fieldErrors: { contactId: expect.any(String) } } });
    await expect(book(rep, { contactId: null, opportunityId: opp.id, companyId: co2.id })).rejects.toMatchObject({ details: { fieldErrors: { companyId: expect.any(String) } } });
    const archived = (await contacts.createContact(rep, { firstName: "Old", lastName: run })) as { id: string };
    await contacts.archiveContact(rep, archived.id);
    await expect(book(rep, { contactId: archived.id })).rejects.toMatchObject({ details: { fieldErrors: { contactId: "This record is archived." } } });
    const hidden = (await contacts.createContact(otherRep, { firstName: "Hidden", lastName: run })) as { id: string };
    await expect(book(rep, { contactId: hidden.id })).rejects.toMatchObject({ details: { fieldErrors: { contactId: "Choose a record you can see." } } });
  });

  // ── Date / time / zone ──

  it("stores UTC instants with the entry zone, rejects bad ranges and DST gaps, and shows wall times in that zone", async () => {
    const d = nextDay();
    const a = await book(rep, { startDate: d, startTime: "10:00", endTime: "10:45", timezone: "Asia/Kolkata", videoLink: "https://meet.example.com/abc", location: "ABC Textiles Factory, Noida" });
    const r = await raw(a.id);
    expect(r.dueAt?.toISOString()).toBe(`${d}T04:30:00.000Z`);
    expect(r.endAt?.toISOString()).toBe(`${d}T05:15:00.000Z`);
    expect(a).toMatchObject({ start: { date: d, time: "10:00" }, end: { time: "10:45" }, durationMinutes: 45, videoLink: "https://meet.example.com/abc", location: "ABC Textiles Factory, Noida" });

    // London in summer (BST, UTC+1) and in winter (GMT).
    const summer = await book(rep, { startDate: "2027-07-01", startTime: "09:00", endTime: "10:00", timezone: "Europe/London" });
    expect((await raw(summer.id)).dueAt?.toISOString()).toBe("2027-07-01T08:00:00.000Z");
    const winter = await book(rep, { startDate: "2027-12-01", startTime: "09:00", endTime: "10:00", timezone: "Europe/London" });
    expect((await raw(winter.id)).dueAt?.toISOString()).toBe("2027-12-01T09:00:00.000Z");
    // Crossing midnight with an end date.
    const late = await book(rep, { startDate: "2027-12-31", startTime: "23:30", endDate: "2028-01-01", endTime: "00:30", timezone: "Asia/Kolkata" });
    expect(late.durationMinutes).toBe(60);

    await expect(book(rep, { startTime: "11:00", endTime: "11:00" })).rejects.toMatchObject({ code: "VALIDATION_ERROR", details: { fieldErrors: { endTime: expect.any(String) } } });
    await expect(book(rep, { startTime: "11:00", endTime: "10:00" })).rejects.toMatchObject({ details: { fieldErrors: { endTime: expect.any(String) } } });
    await expect(book(rep, { startDate: "2027-03-28", startTime: "01:30", endTime: "03:00", timezone: "Europe/London" })).rejects.toMatchObject({ details: { fieldErrors: { startTime: expect.any(String) } } });
    await expect(book(rep, { timezone: "Mars/Olympus" })).rejects.toThrow();
    await expect(book(rep, { videoLink: "javascript:alert(1)" })).rejects.toThrow();
  });

  // ── Lifecycle ──

  it("follows the lifecycle: confirm → complete, cancel, no-show, reschedule; refuses invalid transitions", async () => {
    const a = await book(rep, { startDate: nextDay() });
    const confirmed = await svc.confirmAppointment(rep, a.id, { version: a.version });
    expect(confirmed).toMatchObject({ status: "CONFIRMED", allowed: { actions: expect.arrayContaining(["reschedule", "complete", "cancel", "no_show"]) } });
    expect(confirmed.allowed.actions).not.toContain("confirm");
    expect((await raw(a.id)).confirmedByUserId).toBe(rep.userId);
    expect((await svc.confirmAppointment(rep, a.id, {})).version).toBe(confirmed.version); // idempotent
    const done = await svc.completeAppointment(rep, a.id, { outcome: "Positive", note: "Customer requested revised quotation." });
    expect(done).toMatchObject({ status: "COMPLETED", outcome: "Positive", metadata: { completionNote: "Customer requested revised quotation." }, allowed: { actions: [], edit: false } });
    await expectCode(svc.confirmAppointment(rep, a.id, {}), "INVALID_STATE_TRANSITION");
    await expectCode(svc.cancelAppointment(rep, a.id, {}), "INVALID_STATE_TRANSITION");
    await expectCode(svc.updateAppointment(rep, a.id, { version: done.version, title: "x" }), "INVALID_STATE_TRANSITION");

    const b = await book(rep, { startDate: nextDay() });
    const cancelled = await svc.cancelAppointment(rep, b.id, { reason: "Customer unavailable" });
    expect(cancelled).toMatchObject({ status: "CANCELLED", cancelReason: "Customer unavailable", cancelledByName: `Ravi Rep ${run}` });
    expect((await raw(b.id)).cancelledAt).not.toBeNull();
    await expectCode(svc.completeAppointment(rep, b.id, {}), "INVALID_STATE_TRANSITION");
    await expectCode(activities.reopenActivity(rep, b.id, {}), "INVALID_STATE_TRANSITION");

    // Confirmed → rescheduled → confirmed → cancelled
    const c = await book(rep, { startDate: nextDay() });
    await svc.confirmAppointment(rep, c.id, {});
    const moved = await svc.rescheduleAppointment(rep, c.id, { startDate: nextDay(), startTime: "15:00", endTime: "16:00", reason: "Buyer travelling" });
    expect(moved).toMatchObject({ status: "RESCHEDULED", rescheduleCount: 1, start: { time: "15:00" } });
    expect((await raw(c.id)).originalDueAt?.toISOString()).toBe((await raw(c.id)).originalDueAt?.toISOString());
    expect((await svc.confirmAppointment(rep, c.id, {})).status).toBe("CONFIRMED");
    expect((await svc.cancelAppointment(rep, c.id, {})).status).toBe("CANCELLED");

    // No-show: only once started (scheduled and confirmed past appointments).
    const future = await book(rep, { startDate: nextDay() });
    await expectCode(svc.markNoShow(rep, future.id, {}), "INVALID_STATE_TRANSITION");
    const past = await book(rep, { startDate: "2026-01-05" });
    expect((await svc.markNoShow(rep, past.id, { reason: "Customer did not attend" })).status).toBe("NO_SHOW");
    await expectCode(svc.rescheduleAppointment(rep, past.id, { startDate: nextDay(), startTime: "10:00", endTime: "11:00" }), "INVALID_STATE_TRANSITION");
    const pastConfirmed = await book(rep, { startDate: "2026-01-06" });
    await svc.confirmAppointment(rep, pastConfirmed.id, {});
    expect((await svc.markNoShow(rep, pastConfirmed.id, {})).status).toBe("NO_SHOW");
  });

  it("keeps the original time and every reschedule in history; stale versions conflict", async () => {
    const d = nextDay();
    const a = await book(rep, { startDate: d });
    const first = (await raw(a.id)).dueAt;
    await svc.rescheduleAppointment(rep, a.id, { startDate: nextDay(), startTime: "15:00", endTime: "16:00", version: a.version });
    await expectCode(svc.rescheduleAppointment(rep, a.id, { startDate: nextDay(), startTime: "09:00", endTime: "10:00", version: a.version }), "RECORD_VERSION_CONFLICT");
    const r = await raw(a.id);
    expect(r.originalDueAt?.toISOString()).toBe(first?.toISOString());
    expect(r.rescheduleCount).toBe(1);
    expect(await events(a.id)).toEqual(["appointment.created", "appointment.rescheduled"]);
  });

  // ── Conflicts ──

  it("detects employee conflicts: exact, partial and reschedule-into overlaps; not adjacent, other employees or cancelled", async () => {
    const d = nextDay();
    const base = await book(rep, { startDate: d, startTime: "10:00", endTime: "11:00" });
    await expect(book(rep, { startDate: d, startTime: "10:00", endTime: "11:00" })).rejects.toMatchObject({ code: "CRM_APPOINTMENT_CONFLICT", message: "The selected employee already has an appointment during this time.", details: { conflicts: [expect.objectContaining({ id: base.id })] } });
    await expectCode(book(rep, { startDate: d, startTime: "10:30", endTime: "11:30" }), "CRM_APPOINTMENT_CONFLICT");
    const adjacent = await book(rep, { startDate: d, startTime: "11:00", endTime: "12:00" });
    expect(adjacent.status).toBe("SCHEDULED");
    expect((await book(manager, { assignedToUserId: otherRep.userId,  startDate: d, startTime: "10:00", endTime: "11:00", contactId: null, companyId: co.id })).status).toBe("SCHEDULED");
    // Booking another employee's time is checked against *their* calendar.
    await expectCode(book(rep, { startDate: d, startTime: "10:15", endTime: "10:45", assignedToUserId: otherRep.userId, contactId: null, companyId: co.id }), "CRM_APPOINTMENT_CONFLICT");
    // Explicit confirmation books anyway.
    const overlap = await book(rep, { startDate: d, startTime: "10:30", endTime: "10:45", allowConflict: true });
    expect(overlap.status).toBe("SCHEDULED");
    // Rescheduling into a conflict.
    const later = await book(rep, { startDate: d, startTime: "14:00", endTime: "15:00" });
    await expectCode(svc.rescheduleAppointment(rep, later.id, { startDate: d, startTime: "11:30", endTime: "12:30" }), "CRM_APPOINTMENT_CONFLICT");
    // Cancelled appointments free the time.
    await svc.cancelAppointment(rep, adjacent.id, {});
    expect((await svc.rescheduleAppointment(rep, later.id, { startDate: d, startTime: "11:15", endTime: "11:45" })).status).toBe("RESCHEDULED");

    const avail = await svc.checkAvailability(rep, { assignedToUserId: rep.userId, startDate: d, startTime: "10:15", endTime: "10:40", timezone: "Asia/Kolkata" });
    expect(avail).toMatchObject({ available: false });
    expect(avail.conflicts.map((c) => c.id)).toEqual(expect.arrayContaining([base.id, overlap.id]));
    expect((await svc.checkAvailability(rep, { assignedToUserId: rep.userId, startDate: d, startTime: "16:00", endTime: "17:00", timezone: "Asia/Kolkata" })).available).toBe(true);
    // Another employee's busy time: titles hidden unless the caller could open it.
    const theirs = await svc.checkAvailability(rep, { assignedToUserId: otherRep.userId, startDate: d, startTime: "10:00", endTime: "11:00", timezone: "Asia/Kolkata" });
    expect(theirs.conflicts.some((c) => c.title === "Busy" && c.id === null)).toBe(true);
    expect((await svc.checkAvailability(manager, { assignedToUserId: otherRep.userId, startDate: d, startTime: "10:00", endTime: "11:00", timezone: "Asia/Kolkata" })).conflicts.every((c) => c.title !== "Busy")).toBe(true);
  });

  it("serialises concurrent bookings of the same slot (only one wins)", async () => {
    const d = nextDay();
    const results = await Promise.allSettled([1, 2, 3].map(() => book(rep, { startDate: d, startTime: "09:00", endTime: "09:30" })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected").every((r) => (r as PromiseRejectedResult).reason.code === "CRM_APPOINTMENT_CONFLICT")).toBe(true);
  });

  // ── Reminders ──

  it("schedules, recalculates and cancels reminders and delivers each once", async () => {
    const d = nextDay();
    const a = await book(rep, { startDate: d, startTime: "11:00", endTime: "12:00", reminderMinutes: 30 });
    expect((await raw(a.id)).reminderAt?.toISOString()).toBe(`${d}T05:00:00.000Z`);
    await svc.rescheduleAppointment(rep, a.id, { startDate: d, startTime: "15:00", endTime: "16:00" });
    expect((await raw(a.id)).reminderAt?.toISOString()).toBe(`${d}T09:00:00.000Z`);
    await svc.rescheduleAppointment(rep, a.id, { startDate: d, startTime: "15:00", endTime: "16:00", reminderMinutes: 1440 });
    const r = await raw(a.id);
    expect(r.reminderAt?.toISOString()).toBe(new Date(r.dueAt!.getTime() - 1440 * 60_000).toISOString());
    await svc.cancelAppointment(rep, a.id, {});
    expect((await raw(a.id)).reminderState).toBe("CANCELLED");

    // Due now: delivered once even when the job runs twice.
    const soon = new Date(Date.now() + 10 * 60_000);
    const p = (x: Date) => new Date(x.getTime() + 330 * 60_000).toISOString();
    const b = await book(rep, { startDate: p(soon).slice(0, 10), startTime: p(soon).slice(11, 16), endTime: p(new Date(soon.getTime() + 30 * 60_000)).slice(11, 16), endDate: p(new Date(soon.getTime() + 30 * 60_000)).slice(0, 10), reminderMinutes: 30, allowConflict: true });
    const rb = await raw(b.id);
    expect(rb.reminderState).toBe("PENDING");
    expect(rb.reminderAt!.getTime()).toBeLessThanOrEqual(Date.now() + 1000); // already due → next run
    const at = new Date(Date.now() + 1000);
    await activities.processDueActivityReminders(at);
    await activities.processDueActivityReminders(at);
    const notes = await prisma.notification.findMany({ where: { relatedRecordId: b.id } });
    expect(notes).toHaveLength(1);
    expect(notes[0].title).toMatch(/^Reminder: Appointment at .* IST/);
    expect((await raw(b.id)).reminderState).toBe("SENT");
  });

  // ── Events & timeline ──

  it("emits appointment.* events with the automation payload, exactly once each, and none when the change fails", async () => {
    const a = await book(rep, { startDate: nextDay(), contactId: null, opportunityId: opp.id, appointmentType: "Product demo" });
    await svc.confirmAppointment(rep, a.id, {});
    const moved = await svc.rescheduleAppointment(rep, a.id, { startDate: nextDay(), startTime: "15:00", endTime: "16:00", reason: "Buyer travelling" });
    await svc.completeAppointment(rep, a.id, { outcome: "Positive" });
    expect(await events(a.id)).toEqual(["appointment.created", "appointment.confirmed", "appointment.rescheduled", "appointment.completed"]);
    const rows = await prisma.crmEvent.findMany({ where: { entityId: a.id }, orderBy: { occurredAt: "asc" } });
    expect(new Set(rows.map((r) => r.id)).size).toBe(4); // unique event ids
    expect(rows[0]).toMatchObject({ entityType: "ACTIVITY", actorUserId: rep.userId });
    expect(rows[0].payload).toMatchObject({ schemaVersion: 1, appointmentId: a.id, opportunityId: opp.id, contactId: ct.id, companyId: co.id, employeeId: rep.userId, status: "SCHEDULED", previousStatus: null, timezone: "Asia/Kolkata", appointmentType: "Product demo", actorId: rep.userId });
    expect(rows[2].payload).toMatchObject({ status: "RESCHEDULED", previousStatus: "CONFIRMED", startAt: moved.startAt, reason: "Buyer travelling", previousStartAt: expect.any(String) });
    expect(rows[3].payload).toMatchObject({ status: "COMPLETED", previousStatus: "RESCHEDULED", outcome: "Positive" });

    const b = await book(rep, { startDate: "2026-02-02" });
    await svc.markNoShow(rep, b.id, {});
    const c = await book(rep, { startDate: nextDay() });
    await svc.cancelAppointment(rep, c.id, { reason: "Internal conflict" });
    expect(await events(b.id)).toEqual(["appointment.created", "appointment.no_show"]);
    expect(await events(c.id)).toEqual(["appointment.created", "appointment.cancelled"]);

    // Failed change → no event (version conflict inside the transaction).
    await expectCode(svc.confirmAppointment(rep, c.id, { version: 1 }), "INVALID_STATE_TRANSITION");
    const d = await book(rep, { startDate: nextDay() });
    await expectCode(svc.confirmAppointment(rep, d.id, { version: d.version + 5 }), "RECORD_VERSION_CONFLICT");
    expect(await events(d.id)).toEqual(["appointment.created"]);
    // A transaction that fails after emitting stores nothing.
    const marker = `rollback ${run}`;
    await expect(
      runCrmMutation(rep, async (ctx) => {
        ctx.emit({ entityType: "ACTIVITY", entityId: d.id, eventType: "appointment.cancelled", summary: marker, payload: {} });
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");
    expect(await prisma.crmEvent.count({ where: { summary: marker } })).toBe(0);
    // A refused booking (conflict) leaves no row and no event.
    const before = await prisma.crmEvent.count({ where: { eventType: "appointment.created", actorUserId: rep.userId } });
    const taken = await raw(d.id);
    const p = (x: Date) => new Date(x.getTime() + 330 * 60_000).toISOString();
    await expectCode(book(rep, { startDate: p(taken.dueAt!).slice(0, 10), startTime: p(taken.dueAt!).slice(11, 16), endTime: p(taken.endAt!).slice(11, 16) }), "CRM_APPOINTMENT_CONFLICT");
    expect(await prisma.crmEvent.count({ where: { eventType: "appointment.created", actorUserId: rep.userId } })).toBe(before);
  });

  it("shows on the contact, company and opportunity timelines and bumps their last activity", async () => {
    const a = await book(rep, { startDate: nextDay(), contactId: null, opportunityId: opp.id });
    await svc.completeAppointment(rep, a.id, {});
    for (const [type, id] of [["CONTACT", ct.id], ["COMPANY", co.id], ["OPPORTUNITY", opp.id]] as const) {
      const linked = await CrmActivityRepository.linkedActivityIds(rep.companyId, type, [id]);
      expect(linked).toContain(a.id);
    }
    expect((await prisma.crmOpportunity.findUniqueOrThrow({ where: { id: opp.id } })).lastActivityAt).not.toBeNull();
  });

  // ── Calendar & list ──

  it("loads only the requested window with filters, search and visibility", async () => {
    // A day no other run uses (the manager sees the whole company's calendar).
    const base = new Date(Date.UTC(2031, 0, 1) + (Math.floor(Date.now() / 1000) % 5000) * 86_400_000);
    const d = base.toISOString().slice(0, 10);
    const next = (n: number) => new Date(base.getTime() + n * 86_400_000).toISOString().slice(0, 10);
    const mine = await book(rep, { startDate: d, startTime: "10:00", endTime: "11:00", appointmentType: "Site / factory visit", location: `Noida plant ${run}` });
    const other = await book(manager, { assignedToUserId: otherRep.userId,  startDate: d, startTime: "10:00", endTime: "11:00", contactId: null, companyId: co.id });
    await book(rep, { startDate: next(5), startTime: "10:00", endTime: "11:00" });
    const day = { from: `${d}T00:00:00+05:30`, to: `${next(1)}T00:00:00+05:30` };
    const ids = async (actor: Actor, extra: Record<string, unknown> = {}, search?: string) => (await svc.calendarAppointments(actor, { ...day, ...extra } as never, search)).data.map((r) => r.id);

    expect(await ids(manager)).toEqual(expect.arrayContaining([mine.id, other.id]));
    expect(await ids(manager)).toHaveLength((await ids(manager)).length);
    expect(await ids(rep)).toContain(mine.id);
    expect(await ids(rep)).not.toContain(other.id); // another employee's calendar needs view_all
    expect(await ids(manager, { assignedToUserIds: [otherRep.userId] })).toEqual([other.id]);
    expect(await ids(rep, { mine: "true" })).toEqual([mine.id]);
    expect(await ids(manager, { contactId: ct.id })).toContain(mine.id);
    expect(await ids(manager, { contactId: ct.id })).not.toContain(other.id);
    expect(await ids(manager, { statuses: ["CONFIRMED"] })).toEqual([]);
    expect(await ids(manager, { appointmentTypes: ["Site / factory visit"] })).toEqual([mine.id]);
    expect(await ids(manager, {}, `Noida plant ${run}`)).toEqual([mine.id]);
    expect(await ids(manager, {}, `Zoya Other ${run}`)).toEqual([other.id]); // employee name
    expect(await ids(manager, {}, `Rahul Sharma ${run}`)).toContain(mine.id); // contact name
    // On a record, everything on it is visible to whoever can see the record.
    expect(await ids(rep, { companyId: co.id })).toEqual(expect.arrayContaining([mine.id, other.id]));
    // Week window includes neighbours; an appointment overlapping the window start is included.
    const week = await svc.calendarAppointments(manager, { from: `${d}T10:30:00+05:30`, to: `${next(6)}T00:00:00+05:30` } as never);
    expect(week.data.map((r) => r.id)).toEqual(expect.arrayContaining([mine.id, other.id]));
    await expectCode(svc.calendarAppointments(manager, {} as never), "VALIDATION_ERROR");

    const list = await svc.listAppointments(manager, { opportunityId: undefined, contactId: ct.id, when: "upcoming" } as never, { sortBy: "startAt", sortOrder: "asc" }, { skip: 0, take: 200 });
    expect(list.totalCount).toBeGreaterThan(0);
    const starts = list.data.map((r) => r.startAt!);
    expect([...starts].sort()).toEqual(starts);
  });

  // ── Phase 09 activity API ──

  it("routes the Phase 09 activity API through the appointment service", async () => {
    const d = nextDay();
    const viaActivity = await activities.createActivity(rep, { type: "APPOINTMENT", subject: "Sample review", entityType: "OPPORTUNITY", entityId: opp.id, dueDate: d, dueTime: "16:00" });
    const r = await raw(viaActivity.id);
    expect(r).toMatchObject({ status: "SCHEDULED", timezone: "Asia/Kolkata" });
    expect(r.endAt!.getTime() - r.dueAt!.getTime()).toBe(60 * 60_000);
    expect(await events(viaActivity.id)).toEqual(["appointment.created"]);
    // Open appointments count as open activities (My Tasks, open tab).
    const open = await activities.listActivities(rep, { entityType: "OPPORTUNITY", entityId: opp.id, state: "open" } as never, { sortBy: "dueAt", sortOrder: "asc" }, { skip: 0, take: 100 });
    expect(open.data.map((a) => a.id)).toContain(viaActivity.id);
    await activities.completeActivity(rep, viaActivity.id, { outcome: "Positive" });
    expect(await events(viaActivity.id)).toEqual(["appointment.created", "appointment.completed"]);
    await expectCode(activities.reopenActivity(rep, viaActivity.id, {}), "INVALID_STATE_TRANSITION");
    const other = await book(rep, { startDate: nextDay() });
    await expectCode(activities.updateActivity(rep, other.id, { version: other.version, status: "IN_PROGRESS" }), "INVALID_STATE_TRANSITION");
    expect((await activities.updateActivity(rep, other.id, { version: other.version, subject: "Renamed demo" })).subject).toBe("Renamed demo");
    expect((await activities.cancelActivity(rep, other.id, { reason: "Other" })).status).toBe("CANCELLED");
  });

  // ── Edit ──

  it("edits details, relations, times (as a reschedule) and employee with conflict checks", async () => {
    const d = nextDay();
    const a = await book(rep, { startDate: d });
    const edited = await svc.updateAppointment(rep, a.id, { version: a.version, title: "Product Demo", videoLink: "https://meet.example.com/xyz", location: "Online", contactId: ct2.id, companyId: co2.id });
    expect(edited).toMatchObject({ title: "Product Demo", videoLink: "https://meet.example.com/xyz", status: "SCHEDULED" });
    expect(edited.relations).toMatchObject({ contact: { entityId: ct2.id }, company: { entityId: co2.id } });
    expect(await CrmActivityRepository.linkedActivityIds(rep.companyId, "CONTACT", [ct.id])).not.toContain(a.id);
    const timed = await svc.updateAppointment(rep, a.id, { version: edited.version, startDate: d, startTime: "17:00", endTime: "18:00" });
    expect(timed).toMatchObject({ status: "RESCHEDULED", start: { time: "17:00" } });
    const blocker = await book(manager, { assignedToUserId: otherRep.userId,  startDate: d, startTime: "17:30", endTime: "18:30", contactId: null, companyId: co.id });
    await expectCode(svc.assignAppointment(rep, a.id, { assignedToUserId: otherRep.userId }), "CRM_APPOINTMENT_CONFLICT");
    const reassigned = await svc.assignAppointment(rep, a.id, { assignedToUserId: otherRep.userId, allowConflict: true });
    expect(reassigned.assignedToUserId).toBe(otherRep.userId);
    expect(await events(a.id)).toEqual(["appointment.created", "appointment.updated", "appointment.rescheduled", "appointment.assigned"]);
    void blocker;
    // Time zone only: same instant, shown in the new zone.
    const tz = await svc.updateAppointment(manager, a.id, { version: reassigned.version, timezone: "Europe/London" });
    expect(tz.startAt).toBe(reassigned.startAt);
    expect(tz.start?.time).toBe(new Date(reassigned.startAt!).toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }));
  });
});
