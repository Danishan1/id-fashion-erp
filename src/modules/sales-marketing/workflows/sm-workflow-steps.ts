import { prisma } from "@/core/db/client";
import { PermissionService } from "@/core/rbac/PermissionService";
import { cancelActivity, completeActivity, createActivity } from "@/modules/crm/activities/crm-activities.service";
import type { StepCtx } from "./sm-workflow-engine";

/**
 * Phase 15 — reusable step helpers. Tasks are CRM tasks created through the
 * CRM activity service (idempotent per instance + key via source/externalRef,
 * so a re-run after a crash finds the same task); closing them goes through
 * the same service. Nothing here writes business tables directly.
 */

export const DAY_MS = 86_400_000;
export const HOUR_MS = 3_600_000;
/** Business date (India) n days after `from`. */
export const istDate = (from: Date, plusDays = 0) => new Date(from.getTime() + plusDays * DAY_MS + 330 * 60_000).toISOString().slice(0, 10);
export const earliest = (now: Date, ...dates: (Date | null | undefined)[]) => {
  const valid = dates.filter((d): d is Date => Boolean(d) && d!.getTime() > now.getTime());
  return valid.length ? new Date(Math.min(...valid.map((d) => d.getTime()))) : null;
};
/** Next check: the earliest due reminder, but at least every `maxMs`. */
export const nextCheck = (now: Date, maxMs: number, ...dates: (Date | null | undefined)[]) => earliest(now, new Date(now.getTime() + maxMs), ...dates)!;

type Tasks = Record<string, { id: string; status?: string }>;
const tasksOf = (ctx: StepCtx) => (ctx.data.tasks ?? {}) as Tasks;

export interface TaskSpec {
  key: string;
  entityType: "ENQUIRY" | "QUOTATION" | "CAMPAIGN";
  entityId: string;
  assigneeId: string | null;
  subject: string;
  description: string;
  dueDays: number;
}

/** Creates (once) a CRM task for the assignee. Returns why not, when it can't. */
export async function ensureTask(ctx: StepCtx, spec: TaskSpec): Promise<{ taskId: string | null; note: string }> {
  const existing = tasksOf(ctx)[spec.key];
  if (existing) return { taskId: existing.id, note: "Task already created." };
  if (!ctx.settings.createTask) return { taskId: null, note: "Tasks are switched off for this workflow." };
  if (!spec.assigneeId) return { taskId: null, note: "No owner to give the task to." };
  const assignee = await prisma.user.findFirst({ where: { id: spec.assigneeId, companyId: ctx.instance.companyId, status: "ACTIVE" }, select: { id: true } });
  if (!assignee || !(await PermissionService.can(assignee.id, "crm", "view"))) return { taskId: null, note: "The owner can't use CRM tasks — notified instead." };
  const task = (await createActivity(ctx.runAs as { companyId: string; userId: string; branchId: string | null }, {
    type: "TASK",
    mode: "schedule",
    entityType: spec.entityType,
    entityId: spec.entityId,
    subject: spec.subject.slice(0, 200),
    description: spec.description.slice(0, 5000),
    priority: "HIGH",
    assignedToUserId: assignee.id,
    dueDate: istDate(ctx.now, spec.dueDays),
    source: "SM_WORKFLOW",
    externalRef: `${ctx.instance.id}:${spec.key}`,
    metadata: { workflowInstanceId: ctx.instance.id, workflowKey: ctx.instance.workflowKey },
  })) as { id: string };
  ctx.data = { ...ctx.data, tasks: { ...tasksOf(ctx), [spec.key]: { id: task.id } } };
  return { taskId: task.id, note: "Task created." };
}

/** Current status of a task the workflow created (null = none / deleted). */
export async function taskStatus(ctx: StepCtx, key: string) {
  const t = tasksOf(ctx)[key];
  if (!t) return null;
  const row = await prisma.crmActivity.findFirst({ where: { id: t.id, companyId: ctx.instance.companyId, deletedAt: null }, select: { status: true, outcome: true, completedByUserId: true } });
  return row;
}

/** Completes (goal reached) or cancels (workflow cancelled) the open tasks this workflow created, through the CRM service. */
export async function closeTasks(ctx: StepCtx, how: "complete" | "cancel", note: string): Promise<string[]> {
  const done: string[] = [];
  for (const [key, t] of Object.entries(tasksOf(ctx))) {
    const row = await prisma.crmActivity.findFirst({ where: { id: t.id, companyId: ctx.instance.companyId, deletedAt: null }, select: { status: true } });
    if (!row || !["PENDING", "IN_PROGRESS"].includes(row.status)) continue;
    const actor = ctx.runAs as { companyId: string; userId: string; branchId: string | null };
    if (how === "complete") await completeActivity(actor, t.id, { outcome: "Done by workflow", note: note.slice(0, 2000) });
    else await cancelActivity(actor, t.id, { reason: note.slice(0, 300) });
    done.push(key);
  }
  return done;
}

/** Users who may approve (`module`.approve) — never the people excluded (preparer, submitter: separation of duties). */
export async function approversFor(companyId: string, module: string, exclude: (string | null | undefined)[]) {
  const users = await prisma.user.findMany({ where: { companyId, status: "ACTIVE", supportForPlatformUserId: null }, select: { id: true } });
  const out: string[] = [];
  for (const u of users) {
    if (exclude.includes(u.id)) continue;
    if (await PermissionService.can(u.id, module as never, "approve" as never)) out.push(u.id);
  }
  return out;
}
