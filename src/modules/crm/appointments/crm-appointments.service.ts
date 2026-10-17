import type { Prisma } from "@prisma/client";
import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import {
  assertAssignable,
  canSeeRecord,
  labelsFor,
  loadActivity,
  notifyAssignee,
  presentActivity,
  recordInfo,
  touchLinkedRecords,
  type Ref,
} from "../activities/crm-activities.service";
import { CrmActivityRepository, type ActivityRow } from "../activities/crm-activity.repository";
import { OPEN_STATUSES } from "../activities/activity-registry";
import type { CreateActivityInput, UpdateActivityInput } from "../activities/activity.schema";
import type { CrmActor } from "../core/crm-actor";
import { runCrmMutation, type CrmMutationContext } from "../core/crm-mutation";
import { BUSINESS_TIME_ZONE, formatZonedDate, formatZonedTime, NonexistentLocalTimeError, zoneAbbreviation, zonedParts, zonedToInstant } from "../core/crm-timezone";
import { getCrmRecordScope, type CrmRecordScope } from "../core/crm-visibility";
import { assertCrmEntityAccess } from "../crm-entity-access";
import { optionSuggestions } from "../settings/crm-settings.service";
import { REMINDER_OPTIONS } from "../activities/activity-registry";
import {
  allowedAppointmentActions,
  APPOINTMENT_ACTIONS,
  APPOINTMENT_STATUSES,
  APPOINTMENT_TRANSITIONS,
  appointmentStatusLabel,
  canTransition,
  DEFAULT_APPOINTMENT_MINUTES,
  isOpenAppointmentStatus,
  MAX_APPOINTMENT_MINUTES,
  MIN_APPOINTMENT_MINUTES,
  type AppointmentEventPayload,
  type AppointmentEventType,
  type AppointmentStatus,
} from "./appointment-registry";
import {
  appointmentActionSchema,
  assignAppointmentSchema,
  availabilityQuerySchema,
  completeAppointmentSchema,
  createAppointmentSchema,
  rescheduleAppointmentSchema,
  updateAppointmentSchema,
  type AppointmentFilter,
  type AppointmentSortField,
} from "./appointment.schema";

/**
 * CRM appointments (Phase 10) — the single place appointments are created
 * and changed. An appointment is a CRM activity of type APPOINTMENT
 * (crm_activities), so it reuses Phase 09's links to CRM records, assignee
 * (ERP user), reminders (worker job), notifications, audit and timeline.
 *
 * Centralised here: validation (times, time zone, related records), the
 * status lifecycle (APPOINTMENT_TRANSITIONS), employee conflict checks,
 * reminder scheduling, timeline + automation events (appointment.*, written
 * in the same transaction as the change through runCrmMutation — no event is
 * stored when the change fails; the crm_events row id is the event id).
 *
 * Conflict policy (no ERP policy exists): overlapping appointments for the
 * same employee are refused with CRM_APPOINTMENT_CONFLICT unless the caller
 * confirms (`allowConflict: true`). The check runs inside the transaction
 * under a per-employee advisory lock, so two bookings can't race past it.
 */

const TABLE = "crm_activities";
type Rel = { contactId: string | null; companyId: string | null; opportunityId: string | null; leadId: string | null };
const EMPTY_REL: Rel = { contactId: null, companyId: null, opportunityId: null, leadId: null };

const blank = (v: unknown) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");
const textOrNull = (v: string | null | undefined) => (blank(v) ? null : (v as string).trim());
const notFound = (id: string) => new BusinessRuleError("NOT_FOUND", "Appointment not found.", { id });
const versionConflict = (id: string) => new BusinessRuleError("RECORD_VERSION_CONFLICT", "This appointment was changed by someone else after you opened it. Reload to see the latest version, then try again.", { id });
const zoneOf = (row: { timezone: string | null }) => row.timezone ?? BUSINESS_TIME_ZONE;
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
export const CONFLICT_MESSAGE = "The selected employee already has an appointment during this time.";

// ── Loading & presentation ───────────────────────────────────────

async function loadAppointment(actor: CrmActor, id: string) {
  const loaded = await loadActivity(actor, id).catch((e) => {
    if (e instanceof BusinessRuleError && e.code === "NOT_FOUND") throw notFound(id);
    throw e;
  });
  if (loaded.row.type !== "APPOINTMENT") throw notFound(id);
  return loaded;
}

export function relationsOf(links: { entityType: string; entityId: string }[]): Rel {
  const first = (t: string) => links.find((l) => l.entityType === t)?.entityId ?? null;
  return { contactId: first("CONTACT"), companyId: first("COMPANY"), opportunityId: first("OPPORTUNITY"), leadId: first("LEAD") };
}

export function presentAppointment(row: ActivityRow, ctx: Awaited<ReturnType<typeof labelsFor>>, actor: CrmActor, scope: CrmRecordScope, now = new Date()) {
  const base = presentActivity(row, ctx, actor, scope, now);
  const tz = zoneOf(row);
  const link = (t: string) => base.links.find((l) => l.entityType === t) ?? null;
  const name = (id: string | null) => (id ? (ctx.users.get(id) ?? null) : null);
  return {
    ...base,
    title: row.subject,
    statusLabel: appointmentStatusLabel(row.status),
    timezone: tz,
    startAt: iso(row.dueAt),
    endAt: iso(row.endAt),
    start: row.dueAt ? zonedParts(row.dueAt, tz) : null,
    end: row.endAt ? zonedParts(row.endAt, tz) : null,
    durationMinutes: row.dueAt && row.endAt ? Math.round((row.endAt.getTime() - row.dueAt.getTime()) / 60_000) : null,
    relations: { contact: link("CONTACT"), company: link("COMPANY"), opportunity: link("OPPORTUNITY"), lead: link("LEAD") },
    allowed: allowedAppointmentActions(row.status),
    confirmedByName: name(row.confirmedByUserId),
    cancelledByName: name(row.cancelledByUserId),
    noShowByName: name(row.noShowByUserId),
  };
}
export type AppointmentDto = ReturnType<typeof presentAppointment>;

async function labels(companyId: string, rows: ActivityRow[]) {
  const ctx = await labelsFor(companyId, rows);
  // Confirm / cancel / no-show actors (labelsFor already has completed / updated by).
  const extra = [...new Set(rows.flatMap((r) => [r.confirmedByUserId, r.cancelledByUserId, r.noShowByUserId]).filter((v): v is string => Boolean(v) && !ctx.users.has(v as string)))];
  for (const u of await CrmActivityRepository.userNames(extra)) ctx.users.set(u.id, u.fullName);
  return ctx;
}

async function presentOne(actor: CrmActor, scope: CrmRecordScope, row: ActivityRow) {
  return presentAppointment(row, await labels(actor.companyId, [row]), actor, scope);
}

export async function getAppointment(actor: CrmActor, id: string) {
  const { row, scope } = await loadAppointment(actor, id);
  return presentOne(actor, scope, row);
}

// ── Validation helpers ───────────────────────────────────────────

/** Start / end instants from wall-clock date + time in a zone. */
export function appointmentInstants(input: { startDate: string; startTime: string; endDate?: string | null; endTime: string; timezone: string }) {
  let start: Date;
  let end: Date;
  try {
    start = zonedToInstant(input.startDate, input.startTime, input.timezone);
  } catch (e) {
    if (e instanceof NonexistentLocalTimeError) throw new BusinessRuleError("VALIDATION_ERROR", e.message, { fieldErrors: { startTime: "This time doesn't exist that day in the chosen time zone." } });
    throw e;
  }
  try {
    end = zonedToInstant(input.endDate || input.startDate, input.endTime, input.timezone);
  } catch (e) {
    if (e instanceof NonexistentLocalTimeError) throw new BusinessRuleError("VALIDATION_ERROR", e.message, { fieldErrors: { endTime: "This time doesn't exist that day in the chosen time zone." } });
    throw e;
  }
  const minutes = (end.getTime() - start.getTime()) / 60_000;
  if (minutes <= 0) throw new BusinessRuleError("VALIDATION_ERROR", "The end must be after the start.", { fieldErrors: { endTime: "End must be after the start." } });
  if (minutes < MIN_APPOINTMENT_MINUTES) throw new BusinessRuleError("VALIDATION_ERROR", `An appointment must last at least ${MIN_APPOINTMENT_MINUTES} minutes.`, { fieldErrors: { endTime: `At least ${MIN_APPOINTMENT_MINUTES} minutes.` } });
  if (minutes > MAX_APPOINTMENT_MINUTES) throw new BusinessRuleError("VALIDATION_ERROR", "An appointment can last at most 7 days.", { fieldErrors: { endDate: "At most 7 days." } });
  return { start, end };
}

/**
 * Validates the related records and fills in the implied ones: an
 * opportunity's company (and contact, when none is chosen) and a contact's
 * company. A contact must belong to the chosen company; an opportunity's
 * company must be the chosen company. Records the user can't see, archived
 * or merged records are refused.
 */
async function resolveRelations(actor: CrmActor, requested: Rel): Promise<{ rel: Rel; links: Ref[]; primary: Ref }> {
  const rel = { ...EMPTY_REL, ...requested };
  if (rel.leadId && (rel.contactId || rel.companyId || rel.opportunityId)) {
    throw new BusinessRuleError("VALIDATION_ERROR", "An appointment on a lead can't also be linked to a contact, company or opportunity. Convert the lead first.", { fieldErrors: { leadId: "Use a lead on its own." } });
  }
  if (!rel.contactId && !rel.companyId && !rel.opportunityId && !rel.leadId) {
    throw new BusinessRuleError("VALIDATION_ERROR", "Choose the contact, company or opportunity this appointment is with.", { fieldErrors: { contactId: "Choose a contact, company or opportunity." } });
  }
  const FIELD = { CONTACT: "contactId", COMPANY: "companyId", OPPORTUNITY: "opportunityId", LEAD: "leadId" } as const;
  const refsOf = (r: Rel): Ref[] =>
    [
      r.opportunityId && { entityType: "OPPORTUNITY" as const, entityId: r.opportunityId },
      r.contactId && { entityType: "CONTACT" as const, entityId: r.contactId },
      r.companyId && { entityType: "COMPANY" as const, entityId: r.companyId },
      r.leadId && { entityType: "LEAD" as const, entityId: r.leadId },
    ].filter(Boolean) as Ref[];

  const check = async (refs: Ref[]) => {
    const recs = await CrmActivityRepository.records(actor.companyId, refs);
    for (const ref of refs) {
      const info = recordInfo(recs, ref);
      const field = FIELD[ref.entityType as keyof typeof FIELD];
      if (!info || !(await canSeeRecord(actor, ref))) throw new BusinessRuleError("VALIDATION_ERROR", "The related record was not found.", { fieldErrors: { [field]: "Choose a record you can see." } });
      if (info.merged) throw new BusinessRuleError("VALIDATION_ERROR", `"${info.label}" was merged into another record. Use that record instead.`, { fieldErrors: { [field]: "This record was merged." } });
      if (info.archived) throw new BusinessRuleError("VALIDATION_ERROR", `"${info.label}" is archived. Restore it before booking appointments.`, { fieldErrors: { [field]: "This record is archived." } });
    }
    return recs;
  };

  let recs = await check(refsOf(rel));
  const opp = rel.opportunityId ? recs.opportunities.find((o) => o.id === rel.opportunityId)! : null;
  if (opp) {
    if (opp.crmCompanyId) {
      if (rel.companyId && rel.companyId !== opp.crmCompanyId) throw new BusinessRuleError("VALIDATION_ERROR", "This opportunity belongs to a different company.", { fieldErrors: { companyId: "Use the opportunity's company." } });
      if (!rel.companyId && (await canSeeRecord(actor, { entityType: "COMPANY", entityId: opp.crmCompanyId }))) rel.companyId = opp.crmCompanyId;
    }
    if (!rel.contactId && opp.crmContactId && (await canSeeRecord(actor, { entityType: "CONTACT", entityId: opp.crmContactId }))) rel.contactId = opp.crmContactId;
  }
  recs = await check(refsOf(rel));
  if (rel.contactId) {
    const contact = recs.contacts.find((c) => c.id === rel.contactId)!;
    if (contact.crmCompanyId) {
      if (rel.companyId && rel.companyId !== contact.crmCompanyId) {
        const company = recs.companies.find((c) => c.id === rel.companyId);
        throw new BusinessRuleError("VALIDATION_ERROR", `${contact.fullName} isn't a contact of ${company?.name ?? "the chosen company"}.`, { fieldErrors: { contactId: "Choose a contact of this company." } });
      }
      if (!rel.companyId && (await canSeeRecord(actor, { entityType: "COMPANY", entityId: contact.crmCompanyId }))) {
        rel.companyId = contact.crmCompanyId;
        await check(refsOf(rel));
      }
    }
  }
  const links = refsOf(rel);
  return { rel, links, primary: links[0] };
}

/** Reminder for an appointment: `offset` minutes before the start. A time already passed fires on the next run, as long as the appointment hasn't started. */
function reminderFor(start: Date, offset: number | null | undefined, now = new Date()) {
  if (offset === null || offset === undefined) return { reminderOffsetMinutes: null, reminderAt: null, reminderState: null, reminderSentAt: null };
  if (start.getTime() <= now.getTime()) return { reminderOffsetMinutes: offset, reminderAt: null, reminderState: null, reminderSentAt: null };
  const at = new Date(Math.max(start.getTime() - offset * 60_000, now.getTime()));
  return { reminderOffsetMinutes: offset, reminderAt: at, reminderState: "PENDING", reminderSentAt: null };
}

// ── Conflicts / availability ─────────────────────────────────────

type ConflictRow = { id: string; type: string; subject: string; dueAt: Date | null; endAt: Date | null; status: string; timezone: string | null; assignedToUserId: string | null; createdByUserId: string };

/** Open, timed appointments and meetings of `userId` overlapping [start, end) (touching ones don't overlap). */
export function findConflicts(db: Prisma.TransactionClient | typeof prisma, companyId: string, userId: string, start: Date, end: Date, excludeId?: string): Promise<ConflictRow[]> {
  return db.crmActivity.findMany({
    where: {
      companyId,
      assignedToUserId: userId,
      deletedAt: null,
      type: { in: ["APPOINTMENT", "MEETING"] },
      status: { in: [...OPEN_STATUSES] },
      allDay: false,
      dueAt: { lt: end },
      endAt: { gt: start },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    orderBy: { dueAt: "asc" },
    take: 10,
    select: { id: true, type: true, subject: true, dueAt: true, endAt: true, status: true, timezone: true, assignedToUserId: true, createdByUserId: true },
  });
}

/** What the caller may see of someone's busy time: titles only for items they could open. */
function presentConflicts(actor: CrmActor, scope: CrmRecordScope, rows: ConflictRow[]) {
  return rows.map((c) => {
    const visible = scope.mode === "ALL" || c.assignedToUserId === actor.userId || c.createdByUserId === actor.userId;
    return { id: visible ? c.id : null, title: visible ? c.subject : "Busy", type: c.type, startAt: iso(c.dueAt), endAt: iso(c.endAt), status: c.status, timezone: c.timezone };
  });
}

/** Serialises bookings per employee for the rest of the transaction. */
async function lockEmployee(tx: Prisma.TransactionClient, companyId: string, userId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`crm-appointment:${companyId}:${userId}`}, 0))`;
}

async function assertNoConflict(ctx: CrmMutationContext, actor: CrmActor, scope: CrmRecordScope, userId: string, start: Date, end: Date, excludeId: string | undefined, allow: boolean | undefined) {
  await lockEmployee(ctx.tx, actor.companyId, userId);
  if (allow) return;
  const rows = await findConflicts(ctx.tx, actor.companyId, userId, start, end, excludeId);
  if (rows.length) throw new BusinessRuleError("CRM_APPOINTMENT_CONFLICT", CONFLICT_MESSAGE, { conflicts: presentConflicts(actor, scope, rows), fieldErrors: { startTime: CONFLICT_MESSAGE } });
}

/** GET /appointments/availability — does the employee have anything in that window? */
export async function checkAvailability(actor: CrmActor, raw: Record<string, unknown>) {
  const q = availabilityQuerySchema.parse(raw);
  const user = await CrmActivityRepository.activeUser(actor.companyId, q.assignedToUserId);
  if (!user) throw new BusinessRuleError("VALIDATION_ERROR", "Choose an active employee.", { fieldErrors: { assignedToUserId: "Choose an active employee." } });
  const { start, end } = q.startAt && q.endAt ? { start: new Date(q.startAt), end: new Date(q.endAt) } : appointmentInstants({ startDate: q.startDate!, startTime: q.startTime!, endDate: q.endDate, endTime: q.endTime!, timezone: q.timezone! });
  if (end <= start) throw new BusinessRuleError("VALIDATION_ERROR", "The end must be after the start.", { fieldErrors: { endTime: "End must be after the start." } });
  const scope = await getCrmRecordScope(actor);
  const rows = await findConflicts(prisma, actor.companyId, q.assignedToUserId, start, end, q.excludeId);
  return { available: rows.length === 0, startAt: start.toISOString(), endAt: end.toISOString(), employee: user, conflicts: presentConflicts(actor, scope, rows) };
}

// ── Events ───────────────────────────────────────────────────────

function payloadOf(row: ActivityRow, rel: Rel, actor: CrmActor, previousStatus: string | null, extra: Record<string, unknown> = {}): AppointmentEventPayload {
  return {
    schemaVersion: 1,
    appointmentId: row.id,
    contactId: rel.contactId,
    companyId: rel.companyId,
    opportunityId: rel.opportunityId,
    leadId: rel.leadId,
    employeeId: row.assignedToUserId,
    status: row.status,
    previousStatus,
    startAt: iso(row.dueAt),
    endAt: iso(row.endAt),
    timezone: row.timezone,
    location: row.location,
    hasVideoLink: Boolean(row.videoLink),
    appointmentType: row.appointmentType,
    actorId: actor.userId,
    occurredAt: new Date().toISOString(),
    ...extra,
  };
}

function when(row: { dueAt: Date | null; timezone: string | null }) {
  if (!row.dueAt) return "no time set";
  const tz = zoneOf(row);
  return `${formatZonedDate(row.dueAt, tz)}, ${formatZonedTime(row.dueAt, tz)} ${zoneAbbreviation(row.dueAt, tz)}`;
}

function emit(ctx: CrmMutationContext, type: AppointmentEventType, row: ActivityRow, summary: string, payload: AppointmentEventPayload) {
  ctx.emit({ entityType: "ACTIVITY", entityId: row.id, eventType: type, summary, payload: payload as unknown as Record<string, unknown> });
}

async function versioned(ctx: CrmMutationContext, row: ActivityRow, expected: number | undefined, data: Prisma.CrmActivityUncheckedUpdateManyInput, actor: CrmActor) {
  const { count } = await CrmActivityRepository.updateVersioned(row.id, expected ?? row.version, { ...data, updatedByUserId: actor.userId }, ctx.tx);
  if (count === 0) throw versionConflict(row.id);
  return (await CrmActivityRepository.findOne(actor.companyId, row.id, ctx.tx))!;
}

function assertTransition(row: ActivityRow, to: AppointmentStatus, verb: string) {
  if (!canTransition(row.status, to)) {
    const from = appointmentStatusLabel(row.status);
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", `This appointment is ${from.toLowerCase()} and can't be ${verb}.`, { status: row.status, to, allowed: APPOINTMENT_TRANSITIONS[row.status as AppointmentStatus] ?? [] });
  }
}

async function replaceLinks(ctx: CrmMutationContext, actor: CrmActor, id: string, links: Ref[]) {
  await ctx.tx.crmActivityLink.deleteMany({ where: { activityId: id } });
  await CrmActivityRepository.createLinks(
    links.map((l, i) => ({ companyId: actor.companyId, activityId: id, entityType: l.entityType, entityId: l.entityId, isPrimary: i === 0 })),
    ctx.tx
  );
}

// ── Create ───────────────────────────────────────────────────────

export async function createAppointment(actor: CrmActor, raw: unknown) {
  const input = createAppointmentSchema.parse(raw);
  const { start, end } = appointmentInstants(input);
  const { rel, links, primary } = await resolveRelations(actor, { contactId: input.contactId ?? null, companyId: input.companyId ?? null, opportunityId: input.opportunityId ?? null, leadId: input.leadId ?? null });
  const assignee = input.assignedToUserId ?? actor.userId;
  await assertAssignable(actor.companyId, assignee);
  const scope = await getCrmRecordScope(actor);
  const now = new Date();
  const data: Prisma.CrmActivityUncheckedCreateInput = {
    companyId: actor.companyId,
    type: "APPOINTMENT",
    subject: input.title,
    description: textOrNull(input.description),
    status: "SCHEDULED",
    priority: "NORMAL",
    entityType: primary.entityType,
    entityId: primary.entityId,
    assignedToUserId: assignee,
    dueAt: start,
    endAt: end,
    allDay: false,
    originalDueAt: start,
    durationMinutes: Math.round((end.getTime() - start.getTime()) / 60_000),
    timezone: input.timezone,
    location: textOrNull(input.location),
    videoLink: input.videoLink ?? null,
    appointmentType: textOrNull(input.appointmentType),
    ...reminderFor(start, input.reminderMinutes, now),
    source: "MANUAL",
    createdByUserId: actor.userId,
  };
  const created = await runCrmMutation(actor, async (ctx) => {
    await assertNoConflict(ctx, actor, scope, assignee, start, end, undefined, input.allowConflict);
    const row = await CrmActivityRepository.create(data, ctx.tx);
    await CrmActivityRepository.createLinks(
      links.map((l, i) => ({ companyId: actor.companyId, activityId: row.id, entityType: l.entityType, entityId: l.entityId, isPrimary: i === 0 })),
      ctx.tx
    );
    await ctx.audit({ tableName: TABLE, recordId: row.id, action: "CREATE", newValues: { ...data, links } });
    emit(ctx, "appointment.created", row, `${row.subject} — ${when(row)}`, payloadOf(row, rel, actor, null, { conflictConfirmed: Boolean(input.allowConflict) }));
    await notifyAssignee(ctx, actor, row, assignee);
    await touchLinkedRecords(ctx.tx, actor.companyId, links, now, "APPOINTMENT");
    return row;
  });
  return getAppointment(actor, created.id);
}

// ── Edit ─────────────────────────────────────────────────────────

/** Edit details, related records, times or employee of an open appointment. A time change is recorded as a reschedule. */
export async function updateAppointment(actor: CrmActor, id: string, raw: unknown) {
  const input = updateAppointmentSchema.parse(raw);
  const { row, scope } = await loadAppointment(actor, id);
  if (input.version !== row.version) throw versionConflict(id);
  if (!isOpenAppointmentStatus(row.status)) throw new BusinessRuleError("INVALID_STATE_TRANSITION", `This appointment is ${appointmentStatusLabel(row.status).toLowerCase()} and can't be edited.`);

  const data: Prisma.CrmActivityUncheckedUpdateManyInput = {};
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  const track = (key: keyof ActivityRow, value: unknown) => {
    if (value !== undefined && value !== row[key]) {
      (data as Record<string, unknown>)[key] = value;
      changes[key] = { from: row[key], to: value };
    }
  };
  track("subject", input.title);
  if (input.description !== undefined) track("description", textOrNull(input.description));
  if (input.appointmentType !== undefined) track("appointmentType", textOrNull(input.appointmentType));
  if (input.location !== undefined) track("location", textOrNull(input.location));
  if (input.videoLink !== undefined) track("videoLink", input.videoLink ?? null);

  // Related records
  const relTouched = (["contactId", "companyId", "opportunityId", "leadId"] as const).some((k) => input[k] !== undefined);
  let relation: Awaited<ReturnType<typeof resolveRelations>> | null = null;
  const current = relationsOf(row.links);
  if (relTouched) {
    const next: Rel = {
      contactId: input.contactId !== undefined ? (input.contactId ?? null) : current.contactId,
      companyId: input.companyId !== undefined ? (input.companyId ?? null) : current.companyId,
      opportunityId: input.opportunityId !== undefined ? (input.opportunityId ?? null) : current.opportunityId,
      leadId: input.leadId !== undefined ? (input.leadId ?? null) : current.leadId,
    };
    relation = await resolveRelations(actor, next);
    const same = JSON.stringify(relation.links.map((l) => `${l.entityType}:${l.entityId}`).sort()) === JSON.stringify(row.links.map((l) => `${l.entityType}:${l.entityId}`).sort());
    if (same) relation = null;
    else {
      data.entityType = relation.primary.entityType;
      data.entityId = relation.primary.entityId;
      changes.relations = { from: current, to: relation.rel };
    }
  }

  // Time zone / times
  const tz = input.timezone ?? zoneOf(row);
  let moved: { start: Date; end: Date } | null = null;
  if (input.startDate !== undefined) {
    const next = appointmentInstants({ startDate: input.startDate, startTime: input.startTime!, endDate: input.endDate, endTime: input.endTime!, timezone: tz });
    if (next.start.getTime() !== row.dueAt?.getTime() || next.end.getTime() !== row.endAt?.getTime()) moved = next;
  }
  if (input.timezone !== undefined && input.timezone !== row.timezone) track("timezone", input.timezone);
  if (moved) assertTransition(row, "RESCHEDULED", "rescheduled");

  // Employee
  const assigneeChanged = input.assignedToUserId !== undefined && input.assignedToUserId !== row.assignedToUserId;
  if (assigneeChanged) await assertAssignable(actor.companyId, input.assignedToUserId!);
  const employee = assigneeChanged ? input.assignedToUserId! : row.assignedToUserId;

  const start = moved?.start ?? row.dueAt!;
  const end = moved?.end ?? row.endAt!;
  if (moved || input.reminderMinutes !== undefined) Object.assign(data, reminderFor(start, input.reminderMinutes === undefined ? row.reminderOffsetMinutes : input.reminderMinutes));
  if (moved) Object.assign(data, { dueAt: start, endAt: end, durationMinutes: Math.round((end.getTime() - start.getTime()) / 60_000), status: "RESCHEDULED", rescheduleCount: { increment: 1 }, originalDueAt: row.originalDueAt ?? row.dueAt });
  if (assigneeChanged) data.assignedToUserId = employee;

  if (!Object.keys(data).length && !relation) return presentOne(actor, scope, row);
  const reason = textOrNull(input.reason);
  const after = await runCrmMutation(actor, async (ctx) => {
    if ((moved || assigneeChanged) && employee && start && end) await assertNoConflict(ctx, actor, scope, employee, start, end, id, input.allowConflict);
    const updated = await versioned(ctx, row, input.version, data, actor);
    if (relation) await replaceLinks(ctx, actor, id, relation.links);
    const fresh = relation ? (await CrmActivityRepository.findOne(actor.companyId, id, ctx.tx))! : updated;
    const rel = relationsOf(fresh.links);
    await ctx.audit({ tableName: TABLE, recordId: id, action: "UPDATE", oldValues: { ...row, links: row.links }, newValues: { ...fresh, links: fresh.links } });
    if (Object.keys(changes).length) emit(ctx, "appointment.updated", fresh, `Updated ${Object.keys(changes).join(", ")}`, payloadOf(fresh, rel, actor, row.status, { changes }));
    if (moved) emit(ctx, "appointment.rescheduled", fresh, `${when(row)} → ${when(fresh)}${reason ? ` · ${reason}` : ""}`, payloadOf(fresh, rel, actor, row.status, { previousStartAt: iso(row.dueAt), previousEndAt: iso(row.endAt), previousTimezone: row.timezone, reason, rescheduleCount: fresh.rescheduleCount }));
    if (assigneeChanged) {
      emit(ctx, "appointment.assigned", fresh, `${row.assignedTo?.fullName ?? "Unassigned"} → ${fresh.assignedTo?.fullName ?? "Unassigned"}`, payloadOf(fresh, rel, actor, row.status, { previousEmployeeId: row.assignedToUserId }));
      await notifyAssignee(ctx, actor, fresh, employee);
    }
    return fresh;
  });
  return presentOne(actor, scope, after);
}

// ── Lifecycle actions ────────────────────────────────────────────

export async function confirmAppointment(actor: CrmActor, id: string, raw: unknown) {
  const input = appointmentActionSchema.parse(raw ?? {});
  const { row, scope } = await loadAppointment(actor, id);
  if (row.status === "CONFIRMED") return presentOne(actor, scope, row);
  assertTransition(row, "CONFIRMED", "confirmed");
  const at = new Date();
  const after = await runCrmMutation(actor, async (ctx) => {
    const updated = await versioned(ctx, row, input.version, { status: "CONFIRMED", confirmedAt: at, confirmedByUserId: actor.userId }, actor);
    await ctx.audit({ tableName: TABLE, recordId: id, action: "UPDATE", oldValues: { status: row.status }, newValues: { status: "CONFIRMED", confirmedAt: at, confirmedByUserId: actor.userId } });
    emit(ctx, "appointment.confirmed", updated, `${row.subject} — ${when(row)}${textOrNull(input.reason) ? ` · ${textOrNull(input.reason)}` : ""}`, payloadOf(updated, relationsOf(updated.links), actor, row.status));
    return updated;
  });
  return presentOne(actor, scope, after);
}

/**
 * Move to a new date / time (optionally another zone). Checks the employee's
 * availability, keeps the first scheduled time (original_due_at) and every
 * change in history, recalculates the reminder and emits appointment.rescheduled.
 */
export async function rescheduleAppointment(actor: CrmActor, id: string, raw: unknown) {
  const input = rescheduleAppointmentSchema.parse(raw);
  const { row, scope } = await loadAppointment(actor, id);
  assertTransition(row, "RESCHEDULED", "rescheduled");
  const tz = input.timezone ?? zoneOf(row);
  const { start, end } = appointmentInstants({ ...input, timezone: tz });
  const sameTime = start.getTime() === row.dueAt?.getTime() && end.getTime() === row.endAt?.getTime() && tz === row.timezone;
  if (sameTime && input.reminderMinutes === undefined) return presentOne(actor, scope, row);
  const reason = textOrNull(input.reason);
  const after = await runCrmMutation(actor, async (ctx) => {
    if (row.assignedToUserId) await assertNoConflict(ctx, actor, scope, row.assignedToUserId, start, end, id, input.allowConflict);
    const data: Prisma.CrmActivityUncheckedUpdateManyInput = {
      ...reminderFor(start, input.reminderMinutes === undefined ? row.reminderOffsetMinutes : input.reminderMinutes),
      ...(sameTime
        ? {}
        : { dueAt: start, endAt: end, timezone: tz, durationMinutes: Math.round((end.getTime() - start.getTime()) / 60_000), status: "RESCHEDULED", rescheduleCount: { increment: 1 }, originalDueAt: row.originalDueAt ?? row.dueAt }),
    };
    const updated = await versioned(ctx, row, input.version, data, actor);
    await ctx.audit({ tableName: TABLE, recordId: id, action: "UPDATE", oldValues: { dueAt: row.dueAt, endAt: row.endAt, timezone: row.timezone, status: row.status, reminderAt: row.reminderAt }, newValues: { dueAt: updated.dueAt, endAt: updated.endAt, timezone: updated.timezone, status: updated.status, reminderAt: updated.reminderAt, reason } });
    if (!sameTime) {
      emit(ctx, "appointment.rescheduled", updated, `${when(row)} → ${when(updated)}${reason ? ` · ${reason}` : ""}`, payloadOf(updated, relationsOf(updated.links), actor, row.status, { previousStartAt: iso(row.dueAt), previousEndAt: iso(row.endAt), previousTimezone: row.timezone, reason, rescheduleCount: updated.rescheduleCount }));
    }
    return updated;
  });
  return presentOne(actor, scope, after);
}

export async function cancelAppointment(actor: CrmActor, id: string, raw: unknown) {
  const input = appointmentActionSchema.parse(raw ?? {});
  const { row, scope } = await loadAppointment(actor, id);
  if (row.status === "CANCELLED") return presentOne(actor, scope, row);
  assertTransition(row, "CANCELLED", "cancelled");
  const reason = textOrNull(input.reason);
  const at = new Date();
  const after = await runCrmMutation(actor, async (ctx) => {
    const updated = await versioned(ctx, row, input.version, { status: "CANCELLED", cancelledAt: at, cancelledByUserId: actor.userId, cancelReason: reason, ...(row.reminderState === "PENDING" ? { reminderState: "CANCELLED" } : {}) }, actor);
    await ctx.audit({ tableName: TABLE, recordId: id, action: "UPDATE", oldValues: { status: row.status }, newValues: { status: "CANCELLED", cancelledAt: at, cancelledByUserId: actor.userId, cancelReason: reason } });
    emit(ctx, "appointment.cancelled", updated, `${row.subject} — ${when(row)}${reason ? ` · ${reason}` : ""}`, payloadOf(updated, relationsOf(updated.links), actor, row.status, { reason }));
    return updated;
  });
  return presentOne(actor, scope, after);
}

/** Completed: outcome + what happened / next step; shows on the related records' timelines. */
export async function completeAppointment(actor: CrmActor, id: string, raw: unknown) {
  const input = completeAppointmentSchema.parse(raw ?? {});
  const { row, scope } = await loadAppointment(actor, id);
  if (row.status === "COMPLETED") return presentOne(actor, scope, row);
  assertTransition(row, "COMPLETED", "completed");
  const at = new Date();
  const note = textOrNull(input.note);
  const outcome = input.outcome !== undefined ? textOrNull(input.outcome) : row.outcome;
  const after = await runCrmMutation(actor, async (ctx) => {
    const updated = await versioned(
      ctx,
      row,
      input.version,
      {
        status: "COMPLETED",
        completedAt: at,
        completedByUserId: actor.userId,
        outcome,
        ...(note ? { metadata: { ...((row.metadata as Record<string, unknown>) ?? {}), completionNote: note } } : {}),
        ...(row.reminderState === "PENDING" ? { reminderState: "CANCELLED" } : {}),
      },
      actor
    );
    await ctx.audit({ tableName: TABLE, recordId: id, action: "UPDATE", oldValues: { status: row.status }, newValues: { status: "COMPLETED", completedAt: at, completedByUserId: actor.userId, outcome, note } });
    emit(ctx, "appointment.completed", updated, `${row.subject}${outcome ? ` · ${outcome}` : ""}${note ? ` — ${note}` : ""}`, payloadOf(updated, relationsOf(updated.links), actor, row.status, { outcome, note }));
    await touchLinkedRecords(ctx.tx, actor.companyId, row.links, at, "APPOINTMENT");
    return updated;
  });
  return presentOne(actor, scope, after);
}

/** The meeting didn't happen. Allowed once the start time has passed. */
export async function markNoShow(actor: CrmActor, id: string, raw: unknown) {
  const input = appointmentActionSchema.parse(raw ?? {});
  const { row, scope } = await loadAppointment(actor, id);
  if (row.status === "NO_SHOW") return presentOne(actor, scope, row);
  assertTransition(row, "NO_SHOW", "marked no-show");
  const at = new Date();
  if (row.dueAt && row.dueAt.getTime() > at.getTime()) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "An appointment can be marked no-show only once its start time has passed.");
  const reason = textOrNull(input.reason);
  const after = await runCrmMutation(actor, async (ctx) => {
    const updated = await versioned(ctx, row, input.version, { status: "NO_SHOW", noShowAt: at, noShowByUserId: actor.userId, noShowReason: reason, ...(row.reminderState === "PENDING" ? { reminderState: "CANCELLED" } : {}) }, actor);
    await ctx.audit({ tableName: TABLE, recordId: id, action: "UPDATE", oldValues: { status: row.status }, newValues: { status: "NO_SHOW", noShowAt: at, noShowByUserId: actor.userId, noShowReason: reason } });
    emit(ctx, "appointment.no_show", updated, `${row.subject} — ${when(row)}${reason ? ` · ${reason}` : ""}`, payloadOf(updated, relationsOf(updated.links), actor, row.status, { reason }));
    return updated;
  });
  return presentOne(actor, scope, after);
}

export async function assignAppointment(actor: CrmActor, id: string, raw: unknown) {
  const input = assignAppointmentSchema.parse(raw);
  const { row } = await loadAppointment(actor, id);
  if (input.assignedToUserId === row.assignedToUserId) return getAppointment(actor, id);
  return updateAppointment(actor, id, { version: input.version ?? row.version, assignedToUserId: input.assignedToUserId, allowConflict: input.allowConflict });
}

// ── Reads ────────────────────────────────────────────────────────

async function searchWhere(actor: CrmActor, term: string): Promise<Prisma.CrmActivityWhereInput> {
  const t = term.trim();
  const lower = t.toLowerCase();
  const [contacts, companies, opportunities] = await Promise.all([
    prisma.crmContact.findMany({ where: { companyId: actor.companyId, OR: [{ fullName: { contains: t, mode: "insensitive" } }, { searchText: { contains: lower } }] }, select: { id: true }, take: 200 }),
    prisma.crmCompany.findMany({ where: { companyId: actor.companyId, name: { contains: t, mode: "insensitive" } }, select: { id: true }, take: 200 }),
    prisma.crmOpportunity.findMany({ where: { companyId: actor.companyId, OR: [{ name: { contains: t, mode: "insensitive" } }, { opportunityNumber: { contains: t, mode: "insensitive" } }] }, select: { id: true }, take: 200 }),
  ]);
  const linked = (entityType: "CONTACT" | "COMPANY" | "OPPORTUNITY", ids: { id: string }[]) => (ids.length ? [{ links: { some: { entityType, entityId: { in: ids.map((r) => r.id) } } } }] : []);
  return {
    OR: [
      { subject: { contains: t, mode: "insensitive" } },
      { location: { contains: t, mode: "insensitive" } },
      { appointmentType: { contains: t, mode: "insensitive" } },
      { assignedTo: { fullName: { contains: t, mode: "insensitive" } } },
      ...linked("CONTACT", contacts),
      ...linked("COMPANY", companies),
      ...linked("OPPORTUNITY", opportunities),
    ],
  };
}

/**
 * Appointments visible to the caller. Without crm.view_all a user sees the
 * appointments assigned to or created by them; for one record (contactId /
 * companyId / opportunityId / leadId) everything on that record once access
 * to the record is checked — the same rules as Phase 09 activities.
 */
export async function buildAppointmentWhere(actor: CrmActor, scope: CrmRecordScope, f: AppointmentFilter, search?: string, now = new Date()): Promise<Prisma.CrmActivityWhereInput> {
  const and: Prisma.CrmActivityWhereInput[] = [{ companyId: actor.companyId, deletedAt: null, type: "APPOINTMENT" }];
  const record = f.opportunityId ? { entityType: "OPPORTUNITY" as const, entityId: f.opportunityId } : f.contactId ? { entityType: "CONTACT" as const, entityId: f.contactId } : f.companyId ? { entityType: "COMPANY" as const, entityId: f.companyId } : f.leadId ? { entityType: "LEAD" as const, entityId: f.leadId } : null;
  for (const [t, id] of [["OPPORTUNITY", f.opportunityId], ["CONTACT", f.contactId], ["COMPANY", f.companyId], ["LEAD", f.leadId]] as const) {
    if (id) and.push({ links: { some: { entityType: t, entityId: id } } });
  }
  if (!record && scope.mode === "OWN") and.push({ OR: [{ assignedToUserId: actor.userId }, { createdByUserId: actor.userId }] });
  if (f.mine) and.push({ assignedToUserId: actor.userId });
  if (f.assignedToUserIds?.length) and.push({ assignedToUserId: { in: f.assignedToUserIds } });
  if (f.statuses?.length) and.push({ status: { in: f.statuses } });
  if (f.appointmentTypes?.length) and.push({ appointmentType: { in: f.appointmentTypes } });
  // Calendar window: anything overlapping [from, to).
  if (f.from) {
    // Appointments last at most MAX_APPOINTMENT_MINUTES, so the start is also bounded — keeps the range scan on the calendar index short.
    and.push({ dueAt: { gte: new Date(new Date(f.from).getTime() - MAX_APPOINTMENT_MINUTES * 60_000) } });
    and.push({ OR: [{ endAt: { gt: new Date(f.from) } }, { endAt: null, dueAt: { gte: new Date(f.from) } }] });
  }
  if (f.to) and.push({ dueAt: { lt: new Date(f.to) } });
  if (f.when === "upcoming") and.push({ dueAt: { gte: now } });
  if (f.when === "past") and.push({ dueAt: { lt: now } });
  if (search?.trim()) and.push(await searchWhere(actor, search));
  return { AND: and };
}

async function assertRecordFilterAccess(actor: CrmActor, f: AppointmentFilter) {
  if (f.opportunityId) await assertCrmEntityAccess(actor, "OPPORTUNITY", f.opportunityId);
  if (f.contactId) await assertCrmEntityAccess(actor, "CONTACT", f.contactId);
  if (f.companyId) await assertCrmEntityAccess(actor, "COMPANY", f.companyId);
  if (f.leadId) await assertCrmEntityAccess(actor, "LEAD", f.leadId);
}

function orderBy(sortBy: AppointmentSortField, sortOrder: "asc" | "desc"): Prisma.CrmActivityOrderByWithRelationInput[] {
  if (sortBy === "startAt") return [{ dueAt: { sort: sortOrder, nulls: "last" } }, { id: "asc" }];
  if (sortBy === "title") return [{ subject: sortOrder }, { id: "asc" }];
  return [{ [sortBy]: sortOrder }, { id: "asc" }];
}

/** List view: server-side search, filters, sort, paging. */
export async function listAppointments(actor: CrmActor, f: AppointmentFilter, sort: { sortBy: AppointmentSortField; sortOrder: "asc" | "desc" }, page: { skip: number; take: number; search?: string }) {
  await assertRecordFilterAccess(actor, f);
  const scope = await getCrmRecordScope(actor);
  const now = new Date();
  const where = await buildAppointmentWhere(actor, scope, f, page.search, now);
  const [rows, totalCount] = await Promise.all([CrmActivityRepository.findMany(where, orderBy(sort.sortBy, sort.sortOrder), page.skip, page.take), CrmActivityRepository.count(where)]);
  const ctx = await labels(actor.companyId, rows);
  return { data: rows.map((r) => presentAppointment(r, ctx, actor, scope, now)), totalCount };
}

export const CALENDAR_LIMIT = 1000;

/** Calendar view: every appointment overlapping the window (from / to required), up to CALENDAR_LIMIT. */
export async function calendarAppointments(actor: CrmActor, f: AppointmentFilter, search?: string) {
  if (!f.from || !f.to) throw new BusinessRuleError("VALIDATION_ERROR", "Give the calendar window (from and to).", { fieldErrors: { from: "Required" } });
  await assertRecordFilterAccess(actor, f);
  const scope = await getCrmRecordScope(actor);
  const where = await buildAppointmentWhere(actor, scope, f, search);
  const rows = await CrmActivityRepository.findMany(where, orderBy("startAt", "asc"), 0, CALENDAR_LIMIT + 1);
  const ctx = await labels(actor.companyId, rows.slice(0, CALENDAR_LIMIT));
  return { data: rows.slice(0, CALENDAR_LIMIT).map((r) => presentAppointment(r, ctx, actor, scope)), truncated: rows.length > CALENDAR_LIMIT, from: f.from, to: f.to, viewAll: scope.mode === "ALL" };
}

/** Form / calendar lookups: statuses + transitions, actions, reminders, option lists, default zone. */
export async function getAppointmentMeta(actor: CrmActor) {
  const [suggestions, scope] = await Promise.all([optionSuggestions(actor.companyId), getCrmRecordScope(actor)]);
  return {
    statuses: Object.entries(APPOINTMENT_STATUSES).map(([key, s]) => ({ key, ...s, transitions: APPOINTMENT_TRANSITIONS[key as AppointmentStatus] })),
    actions: Object.entries(APPOINTMENT_ACTIONS).map(([key, a]) => ({ key, ...a })),
    reminders: REMINDER_OPTIONS,
    appointmentTypes: suggestions.appointment_type ?? [],
    cancelReasons: suggestions.appointment_cancel_reason ?? [],
    noShowReasons: suggestions.appointment_no_show_reason ?? [],
    outcomes: suggestions.activity_meeting_outcome ?? [],
    defaultTimeZone: BUSINESS_TIME_ZONE,
    defaultDurationMinutes: DEFAULT_APPOINTMENT_MINUTES,
    canViewAll: scope.mode === "ALL",
  };
}

// ── Phase 09 activity API → appointment service ─────────────────

/** POST /activities with type APPOINTMENT (business-time date / time on one record). */
export async function createAppointmentFromActivityInput(actor: CrmActor, input: CreateActivityInput) {
  if (input.mode === "log") throw new BusinessRuleError("VALIDATION_ERROR", "An appointment is scheduled, not logged. Create it and mark it complete.", { fieldErrors: { mode: "Schedule it instead." } });
  if (!input.dueDate || !input.dueTime) throw new BusinessRuleError("VALIDATION_ERROR", "An appointment needs a date and a start time.", { fieldErrors: { dueTime: "Choose a start time." } });
  if (input.entityType === "CONVERSATION") throw new BusinessRuleError("VALIDATION_ERROR", "Book appointments on the conversation's contact, company or opportunity.", { fieldErrors: { entityType: "Choose a contact, company or opportunity." } });
  const relKey = { CONTACT: "contactId", COMPANY: "companyId", OPPORTUNITY: "opportunityId", LEAD: "leadId" }[input.entityType];
  const startMinutes = Number(input.dueTime.slice(0, 2)) * 60 + Number(input.dueTime.slice(3));
  const endMinutes = startMinutes + DEFAULT_APPOINTMENT_MINUTES;
  const fallbackEnd = `${String(Math.floor(endMinutes / 60) % 24).padStart(2, "0")}:${String(endMinutes % 60).padStart(2, "0")}`;
  return createAppointment(actor, {
    title: input.subject,
    description: input.description,
    location: input.location,
    startDate: input.dueDate,
    startTime: input.dueTime,
    endDate: !input.endTime && endMinutes >= 24 * 60 ? addDay(input.dueDate) : null,
    endTime: input.endTime ?? fallbackEnd,
    timezone: BUSINESS_TIME_ZONE,
    reminderMinutes: input.reminderMinutes,
    ...(input.assignedToUserId ? { assignedToUserId: input.assignedToUserId } : {}),
    [relKey]: input.entityId,
  });
}

function addDay(date: string) {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** PATCH /activities/{id} on an appointment: details and employee only; times go through reschedule. */
export async function updateAppointmentFromActivityInput(actor: CrmActor, id: string, input: UpdateActivityInput) {
  // Tenant-scoped lookup first (visibility is checked again by updateAppointment).
  if (!(await CrmActivityRepository.findOne(actor.companyId, id))) throw notFound(id);
  if (input.status !== undefined || input.dueDate !== undefined || input.dueTime !== undefined || input.endTime !== undefined || input.priority !== undefined) {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", "Use the appointment actions (Reschedule, Confirm, Complete…) to change an appointment's time or status.");
  }
  return updateAppointment(actor, id, {
    version: input.version,
    ...(input.subject !== undefined ? { title: input.subject } : {}),
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.location !== undefined ? { location: input.location } : {}),
    ...(input.reminderMinutes !== undefined ? { reminderMinutes: input.reminderMinutes } : {}),
    ...(input.assignedToUserId ? { assignedToUserId: input.assignedToUserId } : {}),
  });
}

/** POST /activities/{id}/reschedule on an appointment: business-time date / time; keeps its length when no end is given. */
export async function rescheduleAppointmentInBusinessTime(actor: CrmActor, id: string, input: { dueDate: string; dueTime: string; endTime: string | null; reminderMinutes?: number | null; reason?: string | null; version?: number }) {
  const { row } = await loadAppointment(actor, id);
  const length = row.dueAt && row.endAt ? row.endAt.getTime() - row.dueAt.getTime() : DEFAULT_APPOINTMENT_MINUTES * 60_000;
  const start = zonedToInstant(input.dueDate, input.dueTime, BUSINESS_TIME_ZONE);
  const end = input.endTime ? zonedToInstant(input.dueDate, input.endTime, BUSINESS_TIME_ZONE) : new Date(start.getTime() + length);
  const tz = zoneOf(row);
  const s = zonedParts(start, tz);
  const e = zonedParts(end, tz);
  return rescheduleAppointment(actor, id, { startDate: s.date, startTime: s.time, endDate: e.date, endTime: e.time, timezone: tz, reminderMinutes: input.reminderMinutes, reason: input.reason, version: input.version });
}
