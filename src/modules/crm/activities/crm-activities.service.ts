import type { CrmEntityType, Prisma } from "@prisma/client";
import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { createNotification } from "@/core/notifications/NotificationService";
import { PermissionService } from "@/core/rbac/PermissionService";
import type { CrmActor } from "../core/crm-actor";
import { addCalendarDays, businessDateParts, businessDateTime, businessDayEnd, businessDayStart } from "../core/crm-dates";
import { crmEntityHref } from "../core/crm-entity-types";
import type { CrmEventType } from "../core/crm-event-types";
import { runCrmMutation, type CrmMutationContext } from "../core/crm-mutation";
import { getCrmRecordScope, type CrmRecordScope } from "../core/crm-visibility";
import { assertCrmEntityAccess } from "../crm-entity-access";
import { optionSuggestions } from "../settings/crm-settings.service";
import { dueFilterWhere, dueFromParts, dueParts, dueState, reminderTime } from "./activity-due";
import {
  ACTIVITY_PRIORITIES,
  ACTIVITY_PRIORITY_KEYS,
  ACTIVITY_STATUSES,
  ACTIVITY_TYPE_KEYS,
  ACTIVITY_TYPES,
  activityTypeLabel,
  isOpenStatus,
  REMINDER_OPTIONS,
  type ActivityType,
} from "./activity-registry";
import {
  assignActivitySchema,
  bulkActivitySchema,
  completeActivitySchema,
  createActivitySchema,
  rescheduleActivitySchema,
  simpleActionSchema,
  updateActivitySchema,
  type ActivityFilter,
  type ActivitySortField,
} from "./activity.schema";
import { CrmActivityRepository, type ActivityRow } from "./crm-activity.repository";

/**
 * CRM activities (Phase 09) — the single service for tasks, calls, meetings,
 * appointments and logged messages. Every change goes through
 * runCrmMutation, so the row, its AuditLog entry and its `activity.*`
 * timeline events commit together. Activity events are stored on the
 * activity (entity type ACTIVITY); a CRM record's timeline shows the events
 * of every activity linked to it (crm_activity_links).
 *
 * Users are ERP users; access follows CRM visibility:
 *   - crm.view_all: every activity in the company;
 *   - otherwise: activities assigned to or created by the user, plus those on
 *     records the user can see.
 * Reminders and assignment notices use the ERP notifications table; the
 * reminder job (processDueActivityReminders) runs in the existing worker.
 */

const TABLE = "crm_activities";
type Ref = { entityType: CrmEntityType; entityId: string };
type ActivityEvent = Extract<CrmEventType, `activity.${string}`>;

const blank = (v: unknown) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");
const textOrNull = (v: string | null | undefined) => (blank(v) ? null : (v as string).trim());
const conflict = (id: string) => new BusinessRuleError("RECORD_VERSION_CONFLICT", "This activity was changed by someone else after you opened it. Reload to see the latest version, then try again.", { id });
const notFound = (id: string) => new BusinessRuleError("NOT_FOUND", "Activity not found.", { id });
const fmtDue = (dueAt: Date | null, allDay: boolean) => {
  const p = dueParts(dueAt, allDay);
  return p ? `${p.date}${p.time ? ` ${p.time}` : ""}` : "no due date";
};

// ── Access ───────────────────────────────────────────────────────

async function canSeeRecord(actor: CrmActor, ref: Ref) {
  try {
    await assertCrmEntityAccess(actor, ref.entityType, ref.entityId);
    return true;
  } catch {
    return false;
  }
}

/** Visible if: crm.view_all, or assigned to / created by the user, or the user can see its record. */
async function canAccess(actor: CrmActor, scope: CrmRecordScope, a: { assignedToUserId: string | null; createdByUserId: string; entityType: CrmEntityType; entityId: string }) {
  if (scope.mode === "ALL" || a.assignedToUserId === actor.userId || a.createdByUserId === actor.userId) return true;
  return canSeeRecord(actor, a);
}

export async function loadActivity(actor: CrmActor, id: string) {
  const row = await CrmActivityRepository.findOne(actor.companyId, id);
  if (!row) throw notFound(id);
  const scope = await getCrmRecordScope(actor);
  if (!(await canAccess(actor, scope, row))) throw notFound(id);
  return { row, scope };
}

/** Assignee must be an active ERP user of the company who can use the CRM (no separate CRM user list). */
async function assertAssignable(companyId: string, userId: string) {
  const user = await CrmActivityRepository.activeUser(companyId, userId);
  if (!user || !(await PermissionService.can(userId, "crm", "view"))) {
    throw new BusinessRuleError("VALIDATION_ERROR", "Choose an active user who has access to the CRM.", { fieldErrors: { assignedToUserId: "Choose an active CRM user." } });
  }
  return user;
}

// ── Related records ──────────────────────────────────────────────

type RecordsInfo = Awaited<ReturnType<typeof CrmActivityRepository.records>>;

function recordInfo(recs: RecordsInfo, ref: Ref) {
  switch (ref.entityType) {
    case "LEAD": {
      const r = recs.leads.find((x) => x.id === ref.entityId);
      return r ? { label: `${r.leadNumber} — ${r.fullName}`, archived: Boolean(r.archivedAt), merged: false, also: [r.crmCompanyId && { entityType: "COMPANY" as const, entityId: r.crmCompanyId }].filter(Boolean) as Ref[] } : null;
    }
    case "CONTACT": {
      const r = recs.contacts.find((x) => x.id === ref.entityId);
      return r ? { label: r.fullName, archived: Boolean(r.archivedAt), merged: Boolean(r.mergedIntoId), also: [r.crmCompanyId && { entityType: "COMPANY" as const, entityId: r.crmCompanyId }].filter(Boolean) as Ref[] } : null;
    }
    case "COMPANY": {
      const r = recs.companies.find((x) => x.id === ref.entityId);
      return r ? { label: r.name, archived: Boolean(r.archivedAt), merged: Boolean(r.mergedIntoId), also: [] as Ref[] } : null;
    }
    case "OPPORTUNITY": {
      const r = recs.opportunities.find((x) => x.id === ref.entityId);
      return r
        ? {
            label: `${r.opportunityNumber} — ${r.name}`,
            archived: Boolean(r.archivedAt),
            merged: false,
            also: [r.crmCompanyId && { entityType: "COMPANY" as const, entityId: r.crmCompanyId }, r.crmContactId && { entityType: "CONTACT" as const, entityId: r.crmContactId }].filter(Boolean) as Ref[],
          }
        : null;
    }
    default:
      return null;
  }
}

/**
 * Validates the record(s) an activity is created on and works out every
 * record it should show on: the primary record, any extra links given, and
 * automatically the primary record's company / contact.
 */
async function resolveLinks(actor: CrmActor, primary: Ref, extra: Ref[] = []) {
  const requested = [primary, ...extra.filter((r) => !(r.entityType === primary.entityType && r.entityId === primary.entityId))];
  const recs = await CrmActivityRepository.records(actor.companyId, requested);
  for (const [i, ref] of requested.entries()) {
    const info = recordInfo(recs, ref);
    const field = i === 0 ? "entityId" : "links";
    if (!info || !(await canSeeRecord(actor, ref))) throw new BusinessRuleError("VALIDATION_ERROR", "The related record was not found.", { fieldErrors: { [field]: "Choose a record you can see." } });
    if (info.merged) throw new BusinessRuleError("VALIDATION_ERROR", `"${info.label}" was merged into another record. Add the activity there.`, { fieldErrors: { [field]: "This record was merged." } });
    if (info.archived) throw new BusinessRuleError("VALIDATION_ERROR", `"${info.label}" is archived. Restore it before adding activities.`, { fieldErrors: { [field]: "This record is archived." } });
  }
  const primaryInfo = recordInfo(recs, primary)!;
  // Automatic links to the record's company / contact — skipped silently when the viewer can't see them.
  const auto: Ref[] = [];
  for (const ref of primaryInfo.also) if (await canSeeRecord(actor, ref)) auto.push(ref);
  const all = [...requested, ...auto];
  const unique = all.filter((r, i) => all.findIndex((x) => x.entityType === r.entityType && x.entityId === r.entityId) === i);
  return { links: unique, primaryLabel: primaryInfo.label };
}

/** Bumps "last activity" (and a lead's "last contacted" for conversations) on the linked records. */
async function touchLinkedRecords(tx: Prisma.TransactionClient, companyId: string, links: Ref[], when: Date, type: string) {
  const ids = (t: CrmEntityType) => links.filter((l) => l.entityType === t).map((l) => l.entityId);
  const stale = { OR: [{ lastActivityAt: null }, { lastActivityAt: { lt: when } }] };
  if (ids("CONTACT").length) await tx.crmContact.updateMany({ where: { companyId, id: { in: ids("CONTACT") }, ...stale }, data: { lastActivityAt: when } });
  if (ids("COMPANY").length) await tx.crmCompany.updateMany({ where: { companyId, id: { in: ids("COMPANY") }, ...stale }, data: { lastActivityAt: when } });
  if (ids("OPPORTUNITY").length) await tx.crmOpportunity.updateMany({ where: { companyId, id: { in: ids("OPPORTUNITY") }, ...stale }, data: { lastActivityAt: when } });
  if (ids("LEAD").length && ["CALL", "MEETING", "EMAIL", "SMS", "WHATSAPP", "APPOINTMENT"].includes(type)) {
    await tx.crmLead.updateMany({ where: { companyId, id: { in: ids("LEAD") }, OR: [{ lastContactedAt: null }, { lastContactedAt: { lt: when } }] }, data: { lastContactedAt: when } });
  }
}

// ── Presentation ─────────────────────────────────────────────────

async function labelsFor(companyId: string, rows: ActivityRow[]) {
  const refs = rows.flatMap((r) => r.links.map((l) => ({ entityType: l.entityType, entityId: l.entityId })));
  const recs = await CrmActivityRepository.records(companyId, refs);
  const userIds = [...new Set(rows.flatMap((r) => [r.completedByUserId, r.updatedByUserId]).filter((v): v is string => Boolean(v)))];
  const users = new Map((await CrmActivityRepository.userNames(userIds)).map((u) => [u.id, u.fullName]));
  return { recs, users };
}

export function presentActivity(row: ActivityRow, ctx: { recs: RecordsInfo; users: Map<string, string> }, actor: CrmActor, scope: CrmRecordScope, now = new Date()) {
  const links = row.links.map((l) => {
    const info = recordInfo(ctx.recs, l);
    return { entityType: l.entityType, entityId: l.entityId, isPrimary: l.isPrimary, label: info?.label ?? "Record", href: crmEntityHref(l.entityType, l.entityId), archived: info?.archived ?? false };
  });
  const isManager = scope.mode === "ALL";
  const open = isOpenStatus(row.status);
  return {
    ...row,
    typeLabel: activityTypeLabel(row.type),
    dueState: dueState(row, now),
    due: dueParts(row.dueAt, row.allDay),
    end: row.endAt ? businessDateParts(row.endAt).time : null,
    links,
    primary: links.find((l) => l.isPrimary) ?? links[0] ?? null,
    completedByName: row.completedByUserId ? (ctx.users.get(row.completedByUserId) ?? null) : null,
    updatedByName: row.updatedByUserId ? (ctx.users.get(row.updatedByUserId) ?? null) : null,
    permissions: {
      edit: open,
      complete: open,
      reopen: !open,
      delete: row.status !== "COMPLETED" && (isManager || row.createdByUserId === actor.userId),
    },
  };
}
export type ActivityDto = ReturnType<typeof presentActivity>;

async function presentOne(actor: CrmActor, scope: CrmRecordScope, row: ActivityRow) {
  return presentActivity(row, await labelsFor(actor.companyId, [row]), actor, scope);
}

// ── Reads ────────────────────────────────────────────────────────

function orderBy(sortBy: ActivitySortField, sortOrder: "asc" | "desc"): Prisma.CrmActivityOrderByWithRelationInput[] {
  if (sortBy === "dueAt") return [{ dueAt: { sort: sortOrder, nulls: "last" } }, { createdAt: "desc" }, { id: "asc" }];
  if (sortBy === "completedAt") return [{ completedAt: { sort: sortOrder, nulls: "last" } }, { id: "asc" }];
  return [{ [sortBy]: sortOrder }, { id: "asc" }];
}

export function buildActivityWhere(actor: CrmActor, scope: CrmRecordScope, f: ActivityFilter, search: string | undefined, now = new Date()): Prisma.CrmActivityWhereInput {
  const and: Prisma.CrmActivityWhereInput[] = [{ companyId: actor.companyId, deletedAt: null }];
  // A specific record's activities: access to that record was checked by the caller.
  if (f.entityType && f.entityId) and.push({ links: { some: { entityType: f.entityType, entityId: f.entityId } } });
  else if (scope.mode === "OWN") and.push({ OR: [{ assignedToUserId: actor.userId }, { createdByUserId: actor.userId }] });
  if (f.relatedType) and.push({ entityType: f.relatedType });
  if (f.types?.length) and.push({ type: { in: f.types } });
  if (f.statuses?.length) and.push({ status: { in: f.statuses } });
  if (f.state === "open") and.push({ status: { in: ["PENDING", "IN_PROGRESS"] } });
  if (f.state === "closed") and.push({ status: { in: ["COMPLETED", "CANCELLED"] } });
  if (f.priorities?.length) and.push({ priority: { in: f.priorities } });
  if (f.mine === "assigned") and.push({ assignedToUserId: actor.userId });
  if (f.mine === "created") and.push({ createdByUserId: actor.userId });
  const assignees: Prisma.CrmActivityWhereInput[] = [];
  if (f.assignedToUserIds?.length) assignees.push({ assignedToUserId: { in: f.assignedToUserIds } });
  if (f.unassigned) assignees.push({ assignedToUserId: null });
  if (assignees.length) and.push({ OR: assignees });
  if (f.createdByUserIds?.length) and.push({ createdByUserId: { in: f.createdByUserIds } });
  if (f.due) and.push(dueFilterWhere(f.due, now) as Prisma.CrmActivityWhereInput);
  if (f.dueFrom || f.dueTo) and.push({ dueAt: { ...(f.dueFrom ? { gte: businessDayStart(f.dueFrom) } : {}), ...(f.dueTo ? { lte: businessDayEnd(f.dueTo) } : {}) } });
  if (search) and.push({ OR: [{ subject: { contains: search, mode: "insensitive" } }, { description: { contains: search, mode: "insensitive" } }, { outcome: { contains: search, mode: "insensitive" } }] });
  return { AND: and };
}

export async function listActivities(actor: CrmActor, f: ActivityFilter, sort: { sortBy: ActivitySortField; sortOrder: "asc" | "desc" }, page: { skip: number; take: number; search?: string }) {
  if (f.entityType && f.entityId) await assertCrmEntityAccess(actor, f.entityType, f.entityId);
  const scope = await getCrmRecordScope(actor);
  const now = new Date();
  const where = buildActivityWhere(actor, scope, f, page.search, now);
  const [rows, totalCount] = await Promise.all([CrmActivityRepository.findMany(where, orderBy(sort.sortBy, sort.sortOrder), page.skip, page.take), CrmActivityRepository.count(where)]);
  const ctx = await labelsFor(actor.companyId, rows);
  return { data: rows.map((r) => presentActivity(r, ctx, actor, scope, now)), totalCount };
}

export async function getActivity(actor: CrmActor, id: string) {
  const { row, scope } = await loadActivity(actor, id);
  return presentOne(actor, scope, row);
}

/** My Tasks: counts per section for the signed-in user's open items (cheap counts, no rows). */
export async function myTaskCounts(actor: CrmActor) {
  const scope = await getCrmRecordScope(actor);
  const now = new Date();
  const base = (due: "overdue" | "today" | "upcoming" | "no_due_date") => CrmActivityRepository.count(buildActivityWhere(actor, scope, activityFilter({ mine: "assigned", due }), undefined, now));
  const [overdue, today, upcoming, noDueDate] = await Promise.all([base("overdue"), base("today"), base("upcoming"), base("no_due_date")]);
  return { overdue, today, upcoming, noDueDate };
}
const activityFilter = (f: Partial<ActivityFilter>) => f as ActivityFilter;

/** Everything the composer needs: types, priorities, reminders, outcome suggestions. */
export async function getActivityMeta(actor: CrmActor) {
  const suggestions = await optionSuggestions(actor.companyId);
  return {
    types: ACTIVITY_TYPE_KEYS.map((key) => ({ key, ...ACTIVITY_TYPES[key] })),
    statuses: Object.entries(ACTIVITY_STATUSES).map(([key, s]) => ({ key, ...s })),
    priorities: ACTIVITY_PRIORITY_KEYS.map((key) => ({ key, ...ACTIVITY_PRIORITIES[key] })),
    reminders: REMINDER_OPTIONS,
    outcomes: { activity_call_outcome: suggestions.activity_call_outcome ?? [], activity_meeting_outcome: suggestions.activity_meeting_outcome ?? [] },
  };
}

// ── Mutations ────────────────────────────────────────────────────

function emit(ctx: CrmMutationContext, id: string, eventType: ActivityEvent, summary: string, payload: Record<string, unknown> = {}) {
  ctx.emit({ entityType: "ACTIVITY", entityId: id, eventType, summary, payload });
}

async function notifyAssignee(ctx: CrmMutationContext, actor: CrmActor, a: { id: string; subject: string; type: string; dueAt: Date | null; allDay: boolean }, assigneeId: string | null) {
  if (!assigneeId || assigneeId === actor.userId) return;
  const by = (await CrmActivityRepository.userNames([actor.userId]))[0]?.fullName ?? "Someone";
  await createNotification(
    { companyId: actor.companyId, userId: assigneeId, title: `${activityTypeLabel(a.type)} assigned to you`, body: `${by}: ${a.subject} — due ${fmtDue(a.dueAt, a.allDay)}`, relatedModule: "CRM_ACTIVITY", relatedRecordId: a.id },
    ctx.tx
  );
}

/** Reminder columns for a due date + offset. A reminder whose time has already passed is not scheduled. */
function reminderColumns(dueAt: Date | null, allDay: boolean, offset: number | null | undefined, now = new Date()) {
  if (offset === null || offset === undefined || !dueAt) return { reminderOffsetMinutes: null, reminderAt: null, reminderState: null, reminderSentAt: null };
  const at = reminderTime(dueAt, allDay, offset);
  if (at.getTime() < now.getTime() - 60_000) {
    throw new BusinessRuleError("VALIDATION_ERROR", "That reminder time has already passed. Choose a later due date or a shorter reminder.", { fieldErrors: { reminderMinutes: "This reminder time has passed." } });
  }
  return { reminderOffsetMinutes: offset, reminderAt: at, reminderState: "PENDING", reminderSentAt: null };
}

/**
 * Create a scheduled activity (task, call, meeting, appointment…) or log one
 * that already happened. Links to the record's company / contact are added
 * automatically. With `source` + `externalRef` (future integrations) the
 * same external item is only logged once.
 */
export async function createActivity(actor: CrmActor, raw: unknown) {
  const input = createActivitySchema.parse(raw);
  const type = input.type as ActivityType;
  const def = ACTIVITY_TYPES[type];
  const mode = input.mode ?? (def.schedulable ? "schedule" : "log");
  if (mode === "schedule" && !def.schedulable) throw new BusinessRuleError("VALIDATION_ERROR", `${def.label} can only be logged, not scheduled.`, { fieldErrors: { mode: "Log it instead." } });
  if (mode === "log" && !def.loggable) throw new BusinessRuleError("VALIDATION_ERROR", `A ${def.label.toLowerCase()} is scheduled, not logged. Create it and mark it complete.`, { fieldErrors: { mode: "Schedule it instead." } });
  if (input.source && input.externalRef) {
    const existing = await CrmActivityRepository.findByExternalRef(actor.companyId, input.source, input.externalRef);
    if (existing) return getActivity(actor, existing.id);
  }
  const { links } = await resolveLinks(actor, { entityType: input.entityType, entityId: input.entityId }, input.links);
  const now = new Date();

  const data: Prisma.CrmActivityUncheckedCreateInput = {
    companyId: actor.companyId,
    type,
    subject: input.subject,
    description: textOrNull(input.description),
    priority: input.priority ?? "NORMAL",
    entityType: input.entityType,
    entityId: input.entityId,
    outcome: textOrNull(input.outcome),
    direction: def.hasDirection ? (input.direction ?? (mode === "log" ? "OUTBOUND" : null)) : null,
    durationMinutes: input.durationMinutes ?? null,
    location: textOrNull(input.location),
    source: input.source ?? "MANUAL",
    externalRef: input.externalRef ?? null,
    metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
    createdByUserId: actor.userId,
  };

  if (mode === "schedule") {
    const assignee = input.assignedToUserId === undefined ? actor.userId : input.assignedToUserId;
    if (assignee) await assertAssignable(actor.companyId, assignee);
    const due = input.dueDate ? dueFromParts(input.dueDate, input.dueTime) : null;
    Object.assign(data, {
      status: input.status ?? "PENDING",
      assignedToUserId: assignee,
      dueAt: due?.dueAt ?? null,
      allDay: due?.allDay ?? false,
      originalDueAt: due?.dueAt ?? null,
      endAt: due && input.endTime && def.hasEnd ? businessDateTime(input.dueDate!, input.endTime) : null,
      ...reminderColumns(due?.dueAt ?? null, due?.allDay ?? false, input.reminderMinutes, now),
    });
  } else {
    if (input.reminderMinutes !== undefined && input.reminderMinutes !== null) throw new BusinessRuleError("VALIDATION_ERROR", "A logged activity can't have a reminder.", { fieldErrors: { reminderMinutes: "Remove the reminder." } });
    const occurred = input.occurredDate ? businessDateTime(input.occurredDate, input.occurredTime ?? businessDateParts(now).time) : now;
    if (occurred.getTime() > now.getTime() + 5 * 60_000) throw new BusinessRuleError("VALIDATION_ERROR", "A logged activity can't be in the future. Schedule it instead.", { fieldErrors: { occurredDate: "Choose a past date." } });
    if (input.assignedToUserId) await assertAssignable(actor.companyId, input.assignedToUserId);
    Object.assign(data, {
      status: "COMPLETED",
      assignedToUserId: input.assignedToUserId ?? actor.userId,
      dueAt: occurred,
      allDay: false,
      endAt: def.hasEnd && input.endTime && input.occurredDate ? businessDateTime(input.occurredDate, input.endTime) : null,
      completedAt: occurred,
      completedByUserId: actor.userId,
    });
  }

  const created = await runCrmMutation(actor, async (ctx) => {
    const row = await CrmActivityRepository.create(data, ctx.tx);
    await CrmActivityRepository.createLinks(
      links.map((l, i) => ({ companyId: actor.companyId, activityId: row.id, entityType: l.entityType, entityId: l.entityId, isPrimary: i === 0 })),
      ctx.tx
    );
    await ctx.audit({ tableName: TABLE, recordId: row.id, action: "CREATE", newValues: { ...data, links } });
    const label = activityTypeLabel(type);
    if (mode === "log") {
      emit(ctx, row.id, (def.logEvent ?? "activity.logged") as ActivityEvent, `${label}: ${row.subject}${row.outcome ? ` · ${row.outcome}` : ""}`, { type, outcome: row.outcome, direction: row.direction, occurredAt: row.completedAt });
      await touchLinkedRecords(ctx.tx, actor.companyId, links, row.completedAt!, type);
    } else {
      emit(ctx, row.id, "activity.created", `${label}: ${row.subject} — due ${fmtDue(row.dueAt, row.allDay)}`, { type, dueAt: row.dueAt, allDay: row.allDay, priority: row.priority, assignedToUserId: row.assignedToUserId });
      if (row.assignedToUserId && row.assignedToUserId !== actor.userId) {
        emit(ctx, row.id, "activity.assigned", `Assigned to ${row.assignedTo?.fullName ?? "user"}`, { fromUserId: null, toUserId: row.assignedToUserId });
        await notifyAssignee(ctx, actor, row, row.assignedToUserId);
      }
      await touchLinkedRecords(ctx.tx, actor.companyId, links, now, type);
    }
    return row;
  });
  return getActivity(actor, created.id);
}

async function versioned(ctx: CrmMutationContext, row: ActivityRow, expected: number | undefined, data: Prisma.CrmActivityUncheckedUpdateManyInput, actor: CrmActor) {
  const { count } = await CrmActivityRepository.updateVersioned(row.id, expected ?? row.version, { ...data, updatedByUserId: actor.userId }, ctx.tx);
  if (count === 0) throw conflict(row.id);
  return (await CrmActivityRepository.findOne(actor.companyId, row.id, ctx.tx))!;
}

function assertOpen(row: ActivityRow, verb: string) {
  if (!isOpenStatus(row.status)) throw new BusinessRuleError("INVALID_STATE_TRANSITION", `This activity is ${ACTIVITY_STATUSES[row.status as keyof typeof ACTIVITY_STATUSES]?.label.toLowerCase() ?? row.status}. Reopen it before ${verb}.`, { status: row.status });
}

/** Due date / assignee changes inside the same mutation (shared by update, reschedule, assign). */
async function applyReschedule(ctx: CrmMutationContext, actor: CrmActor, row: ActivityRow, next: { dueAt: Date | null; allDay: boolean; endAt: Date | null; reminderMinutes: number | null }, reason: string | null) {
  const changed = (row.dueAt?.getTime() ?? null) !== (next.dueAt?.getTime() ?? null) || row.allDay !== next.allDay;
  const data: Prisma.CrmActivityUncheckedUpdateManyInput = {
    dueAt: next.dueAt,
    allDay: next.allDay,
    endAt: next.endAt,
    ...reminderColumns(next.dueAt, next.allDay, next.reminderMinutes),
  };
  if (changed) {
    data.rescheduleCount = { increment: 1 };
    if (!row.originalDueAt && next.dueAt) data.originalDueAt = row.dueAt ?? next.dueAt;
  }
  return { data, changed, summary: `${fmtDue(row.dueAt, row.allDay)} → ${fmtDue(next.dueAt, next.allDay)}${reason ? ` · ${reason}` : ""}`, payload: { from: row.dueAt, fromAllDay: row.allDay, to: next.dueAt, toAllDay: next.allDay, reason, originalDueAt: row.originalDueAt ?? row.dueAt } };
}

function nextDue(row: ActivityRow, input: { dueDate?: string | null; dueTime?: string | null; endTime?: string | null }) {
  const cur = dueParts(row.dueAt, row.allDay);
  const date = input.dueDate === undefined ? (cur?.date ?? null) : input.dueDate;
  const time = input.dueTime === undefined ? (input.dueDate === undefined ? (cur?.time ?? null) : null) : input.dueTime;
  if (!date) return { dueAt: null, allDay: false, endAt: null };
  const due = dueFromParts(date, time);
  const def = ACTIVITY_TYPES[row.type as ActivityType];
  if (due.allDay || !def?.hasEnd) return { ...due, endAt: null };
  if (input.endTime !== undefined) return { ...due, endAt: input.endTime ? businessDateTime(date, input.endTime) : null };
  // Moving a meeting keeps its length.
  const length = row.endAt && row.dueAt && !row.allDay ? row.endAt.getTime() - row.dueAt.getTime() : null;
  return { ...due, endAt: length !== null ? new Date(due.dueAt.getTime() + length) : null };
}

/** Edit subject / details / priority / status; due date and assignee changes are recorded as reschedule / assignment. */
export async function updateActivity(actor: CrmActor, id: string, raw: unknown) {
  const input = updateActivitySchema.parse(raw);
  const { row, scope } = await loadActivity(actor, id);
  if (input.version !== row.version) throw conflict(id);
  assertOpen(row, "editing it");
  const data: Prisma.CrmActivityUncheckedUpdateManyInput = {};
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  const track = <K extends keyof ActivityRow>(k: K, v: unknown) => {
    if (v !== undefined && v !== row[k]) {
      (data as Record<string, unknown>)[k] = v;
      changes[k] = { from: row[k], to: v };
    }
  };
  track("subject", input.subject);
  if (input.description !== undefined) track("description", textOrNull(input.description));
  track("priority", input.priority);
  track("status", input.status);
  if (input.outcome !== undefined) track("outcome", textOrNull(input.outcome));
  track("direction", input.direction);
  track("durationMinutes", input.durationMinutes);
  if (input.location !== undefined) track("location", textOrNull(input.location));

  const dueTouched = input.dueDate !== undefined || input.dueTime !== undefined || input.endTime !== undefined || input.reminderMinutes !== undefined;
  const assigneeTouched = input.assignedToUserId !== undefined && input.assignedToUserId !== row.assignedToUserId;
  if (assigneeTouched && input.assignedToUserId) await assertAssignable(actor.companyId, input.assignedToUserId);
  if (!Object.keys(data).length && !dueTouched && !assigneeTouched) return presentOne(actor, scope, row);

  const after = await runCrmMutation(actor, async (ctx) => {
    let resched: Awaited<ReturnType<typeof applyReschedule>> | null = null;
    if (dueTouched) {
      const next = nextDue(row, input);
      resched = await applyReschedule(ctx, actor, row, { ...next, reminderMinutes: input.reminderMinutes === undefined ? row.reminderOffsetMinutes : input.reminderMinutes }, null);
      Object.assign(data, resched.data);
    }
    if (assigneeTouched) data.assignedToUserId = input.assignedToUserId;
    const updated = await versioned(ctx, row, input.version, data, actor);
    await ctx.audit({ tableName: TABLE, recordId: id, action: "UPDATE", oldValues: { ...row, links: undefined }, newValues: { ...updated, links: undefined } });
    if (Object.keys(changes).length) emit(ctx, id, "activity.updated", `Updated ${Object.keys(changes).join(", ")}`, { changes });
    if (resched?.changed) emit(ctx, id, "activity.rescheduled", resched.summary, resched.payload);
    if (assigneeTouched) {
      emit(ctx, id, "activity.assigned", `${row.assignedTo?.fullName ?? "Unassigned"} → ${updated.assignedTo?.fullName ?? "Unassigned"}`, { fromUserId: row.assignedToUserId, toUserId: updated.assignedToUserId });
      await notifyAssignee(ctx, actor, updated, updated.assignedToUserId);
    }
    return updated;
  });
  return presentOne(actor, scope, after);
}

/** Complete. Completing an already-completed activity changes nothing (idempotent). The original due date is kept. */
export async function completeActivity(actor: CrmActor, id: string, raw: unknown) {
  const input = completeActivitySchema.parse(raw ?? {});
  const { row, scope } = await loadActivity(actor, id);
  if (row.status === "COMPLETED") return presentOne(actor, scope, row);
  if (row.status === "CANCELLED") throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This activity was cancelled. Reopen it before completing it.");
  const now = new Date();
  const at = input.completedDate ? businessDateTime(input.completedDate, input.completedTime ?? businessDateParts(now).time) : now;
  if (at.getTime() > now.getTime() + 5 * 60_000) throw new BusinessRuleError("VALIDATION_ERROR", "Completion can't be in the future.", { fieldErrors: { completedDate: "Choose today or earlier." } });
  const note = textOrNull(input.note);
  const after = await runCrmMutation(actor, async (ctx) => {
    const updated = await versioned(
      ctx,
      row,
      input.version,
      {
        status: "COMPLETED",
        completedAt: at,
        completedByUserId: actor.userId,
        ...(input.outcome !== undefined ? { outcome: textOrNull(input.outcome) } : {}),
        ...(note ? { metadata: { ...((row.metadata as Record<string, unknown>) ?? {}), completionNote: note } } : {}),
        // A pending reminder is no longer needed.
        ...(row.reminderState === "PENDING" ? { reminderState: "CANCELLED" } : {}),
      },
      actor
    );
    await ctx.audit({ tableName: TABLE, recordId: id, action: "UPDATE", oldValues: { status: row.status, completedAt: null }, newValues: { status: "COMPLETED", completedAt: at, completedByUserId: actor.userId, outcome: updated.outcome } });
    emit(ctx, id, "activity.completed", `${activityTypeLabel(row.type)}: ${row.subject}${updated.outcome ? ` · ${updated.outcome}` : ""}`, { type: row.type, outcome: updated.outcome, note, dueAt: row.dueAt, completedAt: at, wasOverdue: dueState(row, at) === "OVERDUE" });
    await touchLinkedRecords(ctx.tx, actor.companyId, row.links, at, row.type);
    return updated;
  });
  return presentOne(actor, scope, after);
}

/** Completed / cancelled → pending again; a future reminder is scheduled again. */
export async function reopenActivity(actor: CrmActor, id: string, raw: unknown) {
  const input = simpleActionSchema.parse(raw ?? {});
  const { row, scope } = await loadActivity(actor, id);
  if (isOpenStatus(row.status)) return presentOne(actor, scope, row);
  const reminderBack = row.reminderAt && row.reminderState === "CANCELLED" && row.reminderAt.getTime() > Date.now() ? { reminderState: "PENDING" } : {};
  const after = await runCrmMutation(actor, async (ctx) => {
    const updated = await versioned(ctx, row, input.version, { status: "PENDING", completedAt: null, completedByUserId: null, ...reminderBack }, actor);
    await ctx.audit({ tableName: TABLE, recordId: id, action: "UPDATE", oldValues: { status: row.status, completedAt: row.completedAt }, newValues: { status: "PENDING" } });
    emit(ctx, id, "activity.reopened", `${ACTIVITY_STATUSES[row.status as keyof typeof ACTIVITY_STATUSES]?.label ?? row.status} → Pending${textOrNull(input.reason) ? ` · ${textOrNull(input.reason)}` : ""}`, { fromStatus: row.status, reason: textOrNull(input.reason) });
    return updated;
  });
  return presentOne(actor, scope, after);
}

export async function cancelActivity(actor: CrmActor, id: string, raw: unknown) {
  const input = simpleActionSchema.parse(raw ?? {});
  const { row, scope } = await loadActivity(actor, id);
  if (row.status === "CANCELLED") return presentOne(actor, scope, row);
  assertOpen(row, "cancelling it");
  const reason = textOrNull(input.reason);
  const after = await runCrmMutation(actor, async (ctx) => {
    const updated = await versioned(ctx, row, input.version, { status: "CANCELLED", ...(row.reminderState === "PENDING" ? { reminderState: "CANCELLED" } : {}) }, actor);
    await ctx.audit({ tableName: TABLE, recordId: id, action: "UPDATE", oldValues: { status: row.status }, newValues: { status: "CANCELLED", reason } });
    emit(ctx, id, "activity.cancelled", `${row.subject}${reason ? ` · ${reason}` : ""}`, { fromStatus: row.status, reason });
    return updated;
  });
  return presentOne(actor, scope, after);
}

/** New due date (and optionally time / reminder); the first due date and every change stay in history. */
export async function rescheduleActivity(actor: CrmActor, id: string, raw: unknown) {
  const input = rescheduleActivitySchema.parse(raw);
  const { row, scope } = await loadActivity(actor, id);
  assertOpen(row, "rescheduling it");
  const next = nextDue(row, { dueDate: input.dueDate, dueTime: input.dueTime ?? null, endTime: input.endTime });
  const reason = textOrNull(input.reason);
  const after = await runCrmMutation(actor, async (ctx) => {
    const r = await applyReschedule(ctx, actor, row, { ...next, reminderMinutes: input.reminderMinutes === undefined ? row.reminderOffsetMinutes : input.reminderMinutes }, reason);
    if (!r.changed && input.reminderMinutes === undefined) return row;
    const updated = await versioned(ctx, row, input.version, r.data, actor);
    await ctx.audit({ tableName: TABLE, recordId: id, action: "UPDATE", oldValues: { dueAt: row.dueAt, allDay: row.allDay, reminderAt: row.reminderAt }, newValues: { dueAt: updated.dueAt, allDay: updated.allDay, reminderAt: updated.reminderAt, reason } });
    if (r.changed) emit(ctx, id, "activity.rescheduled", r.summary, r.payload);
    return updated;
  });
  return presentOne(actor, scope, after);
}

export async function assignActivity(actor: CrmActor, id: string, raw: unknown) {
  const input = assignActivitySchema.parse(raw);
  const { row, scope } = await loadActivity(actor, id);
  assertOpen(row, "reassigning it");
  if (input.assignedToUserId === row.assignedToUserId) return presentOne(actor, scope, row);
  if (input.assignedToUserId) await assertAssignable(actor.companyId, input.assignedToUserId);
  const after = await runCrmMutation(actor, async (ctx) => {
    const updated = await versioned(ctx, row, input.version, { assignedToUserId: input.assignedToUserId }, actor);
    await ctx.audit({ tableName: TABLE, recordId: id, action: "UPDATE", oldValues: { assignedToUserId: row.assignedToUserId }, newValues: { assignedToUserId: input.assignedToUserId } });
    emit(ctx, id, "activity.assigned", `${row.assignedTo?.fullName ?? "Unassigned"} → ${updated.assignedTo?.fullName ?? "Unassigned"}`, { fromUserId: row.assignedToUserId, toUserId: input.assignedToUserId });
    await notifyAssignee(ctx, actor, updated, input.assignedToUserId);
    return updated;
  });
  return presentOne(actor, scope, after);
}

/** Soft delete by its creator or a manager. Completed activities are history and can't be deleted. */
export async function deleteActivity(actor: CrmActor, id: string) {
  const { row, scope } = await loadActivity(actor, id);
  if (row.status === "COMPLETED") throw new BusinessRuleError("INVALID_STATE_TRANSITION", "Completed activities are kept as history and can't be deleted.");
  if (row.createdByUserId !== actor.userId && scope.mode !== "ALL") throw new BusinessRuleError("PERMISSION_DENIED", "Only the person who created this activity or a manager can delete it.");
  await runCrmMutation(actor, async (ctx) => {
    const { count } = await CrmActivityRepository.updateVersioned(id, row.version, { deletedAt: new Date(), deletedByUserId: actor.userId, updatedByUserId: actor.userId, ...(row.reminderState === "PENDING" ? { reminderState: "CANCELLED" } : {}) }, ctx.tx);
    if (count === 0) throw conflict(id);
    await ctx.audit({ tableName: TABLE, recordId: id, action: "DELETE", oldValues: { subject: row.subject, type: row.type, status: row.status } });
    emit(ctx, id, "activity.deleted", `${activityTypeLabel(row.type)}: ${row.subject}`, { type: row.type, status: row.status });
  });
}

// ── Bulk ─────────────────────────────────────────────────────────

/** Each record is checked and saved on its own; anything not changed is listed with the reason. */
export async function bulkActivityAction(actor: CrmActor, raw: unknown) {
  const input = bulkActivitySchema.parse(raw);
  const ids = [...new Set(input.ids)];
  const skipped: { id: string; reason: string }[] = [];
  let updated = 0;
  for (const id of ids) {
    try {
      const before = await CrmActivityRepository.findOne(actor.companyId, id);
      if (!before) throw notFound(id);
      if (input.action === "assign") {
        if (before.assignedToUserId === input.assignedToUserId) throw new BusinessRuleError("VALIDATION_ERROR", "Already assigned to this user");
        await assignActivity(actor, id, { assignedToUserId: input.assignedToUserId, version: before.version });
      } else if (input.action === "complete") {
        if (before.status === "COMPLETED") throw new BusinessRuleError("VALIDATION_ERROR", "Already completed");
        await completeActivity(actor, id, { outcome: input.outcome, version: before.version });
      } else if (input.action === "reschedule") {
        await rescheduleActivity(actor, id, { dueDate: input.dueDate, dueTime: input.dueTime, version: before.version });
      } else if (input.action === "priority") {
        if (before.priority === input.priority) throw new BusinessRuleError("VALIDATION_ERROR", "Already this priority");
        await updateActivity(actor, id, { priority: input.priority, version: before.version });
      } else if (input.action === "cancel") {
        if (before.status === "CANCELLED") throw new BusinessRuleError("VALIDATION_ERROR", "Already cancelled");
        await cancelActivity(actor, id, { reason: input.reason, version: before.version });
      }
      updated++;
    } catch (e) {
      if (!(e instanceof BusinessRuleError)) throw e;
      skipped.push({ id, reason: e.code === "NOT_FOUND" ? "Not found or not visible to you" : e.message.replace(/\.$/, "") });
    }
  }
  return { requested: ids.length, updated, skipped };
}

// ── Reminders (worker job) ───────────────────────────────────────

/**
 * Sends due reminders as ERP in-app notifications. Run every minute by the
 * worker (crm-import.worker.ts → "activity.reminders"). Each reminder is
 * claimed with a conditional update (PENDING → SENT) in the same transaction
 * as its notification, so retries or several workers never send it twice.
 * Reminders of activities that are no longer open (or deleted) are cancelled.
 */
export async function processDueActivityReminders(now: Date = new Date(), batch = 200) {
  const due = await CrmActivityRepository.dueReminders(now, batch);
  let sent = 0;
  let cancelled = 0;
  for (const a of due) {
    if (a.deletedAt || !isOpenStatus(a.status)) {
      const r = await prisma.crmActivity.updateMany({ where: { id: a.id, reminderState: "PENDING" }, data: { reminderState: "CANCELLED" } });
      cancelled += r.count;
      continue;
    }
    const delivered = await prisma.$transaction(async (tx) => {
      const claim = await tx.crmActivity.updateMany({ where: { id: a.id, reminderState: "PENDING", reminderAt: a.reminderAt }, data: { reminderState: "SENT", reminderSentAt: now } });
      if (claim.count === 0) return false;
      const recipient = (a.assignedToUserId && (await tx.user.findFirst({ where: { id: a.assignedToUserId, status: "ACTIVE" }, select: { id: true } }))?.id) || a.createdByUserId;
      await createNotification(
        { companyId: a.companyId, userId: recipient, title: `Reminder: ${activityTypeLabel(a.type)} due ${dueState(a, now) === "OVERDUE" ? "now" : fmtDue(a.dueAt, a.allDay)}`, body: a.subject, relatedModule: "CRM_ACTIVITY", relatedRecordId: a.id },
        tx
      );
      await tx.crmEvent.create({
        data: { companyId: a.companyId, actorUserId: null, entityType: "ACTIVITY", entityId: a.id, eventType: "activity.reminder_sent", summary: `Reminder sent — due ${fmtDue(a.dueAt, a.allDay)}`, payload: { recipientUserId: recipient, reminderAt: a.reminderAt } },
      });
      return true;
    });
    if (delivered) sent++;
  }
  return { checked: due.length, sent, cancelled };
}

/** For My Tasks headings and tests: today / tomorrow in business time. */
export function businessDays(now = new Date()) {
  const today = businessDateParts(now).date;
  return { today, tomorrow: addCalendarDays(today, 1) };
}
