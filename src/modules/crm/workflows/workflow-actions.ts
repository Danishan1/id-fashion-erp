import { createHash } from "node:crypto";
import type { CrmEntityType } from "@prisma/client";
import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { createNotification } from "@/core/notifications/NotificationService";
import { PermissionService } from "@/core/rbac/PermissionService";
import { decryptSecret } from "@/core/security/encryption";
import { createActivity } from "../activities/crm-activities.service";
import { cancelAppointment, completeAppointment, confirmAppointment, markNoShow } from "../appointments/crm-appointments.service";
import { assignCompany, changeCompanyStatus, changeCompanyTags } from "../companies/crm-companies.service";
import { assignContact, changeContactTags } from "../contacts/crm-contacts.service";
import { businessToday, addCalendarDays } from "../core/crm-dates";
import type { CrmActor } from "../core/crm-actor";
import { sendConversationMessage } from "../conversations/conversation-messaging.service";
import { assignConversation, changeConversationStatus } from "../conversations/crm-conversations.service";
import { assignLead, changeLeadStatus, changeLeadTags, updateLead } from "../leads/lead.service";
import { createNote } from "../notes/crm-notes.service";
import { assignOpportunity, changeOpportunityStage, changeOpportunityStatus, changeOpportunityTags, updateOpportunity } from "../opportunities/crm-opportunities.service";
import { buildTemplateContext } from "../templates/template-context";
import { renderTemplateContent } from "../templates/template-engine";
import { TemplateService } from "../templates/crm-templates.service";
import { WORKFLOW_ACTIONS, type WorkflowActionDef, type WorkflowActionKey } from "./workflow-action-catalog";
import { loadRecordSnapshot, type RecordSnapshot, type TriggerFacts } from "./workflow-context";
import { postSignedWebhook, WebhookBlockedError, WebhookCallError, assertWebhookUrlShape, resolveSafeAddress } from "./workflow-webhook";

/**
 * Server implementations of the workflow actions (catalog in
 * workflow-action-catalog.ts). Every action goes through an existing CRM
 * service AS THE RUN-AS USER — so permissions, record visibility, stage
 * rules, duplicate rules, do-not-contact and audit/timeline all apply exactly
 * as when a person does it. Workflows never write CRM tables directly.
 *
 * In test mode (`dryRun`) an action resolves and validates what it would do
 * (record exists, template renders, conversation found, URL allowed) and
 * returns a description — it never changes data, sends or calls anything.
 */

export interface ActionRunContext {
  companyId: string;
  /** The run-as user. */
  actor: CrmActor;
  workflow: { id: string; name: string };
  execution: { id: string };
  step: { idempotencyKey: string; nodeId: string };
  entityType: CrmEntityType;
  entityId: string;
  record: RecordSnapshot;
  trigger: TriggerFacts | null;
  params: Record<string, unknown>;
  dryRun: boolean;
}

export interface ActionResult {
  summary: string;
  output: Record<string, unknown>;
}

/**
 * retryable: the engine may run it again later (the failure was transient and
 * the action is safe to repeat). Otherwise the step fails for good.
 */
export class WorkflowActionError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryable: boolean
  ) {
    super(message);
    this.name = "WorkflowActionError";
  }
}

const TRANSIENT_CODES = new Set(["RECORD_VERSION_CONFLICT", "REQUEST_IN_PROGRESS", "RATE_LIMITED"]);

/** Maps any thrown error to a WorkflowActionError (business rule errors are permanent unless transient). */
export function toActionError(e: unknown, def: WorkflowActionDef): WorkflowActionError {
  if (e instanceof WorkflowActionError) return e;
  if (e instanceof BusinessRuleError) return new WorkflowActionError(e.message, e.code, def.retryable && TRANSIENT_CODES.has(e.code));
  if (e instanceof WebhookBlockedError) return new WorkflowActionError(e.message, "WEBHOOK_BLOCKED", false);
  if (e instanceof WebhookCallError) return new WorkflowActionError(e.message, e.status ? `WEBHOOK_HTTP_${e.status}` : "WEBHOOK_UNREACHABLE", false);
  const msg = e instanceof Error ? e.message : String(e);
  // Unknown errors (database / network): retry only actions that are safe to repeat.
  return new WorkflowActionError(msg || "Unexpected error.", "UNEXPECTED", def.retryable);
}

/** Deterministic UUID from the step's idempotency key — a retried send reuses the same message id. */
export function uuidFromKey(key: string): string {
  const h = createHash("sha256").update(key).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16)}${h.slice(18, 20)}-${h.slice(20, 32)}`;
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const strList = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "") : []);
const numOrUndef = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** Fills Phase 12 merge fields ({{contact.first_name|there}}) from the record, as the run-as user sees it. */
async function interpolate(ctx: ActionRunContext, text: string): Promise<string> {
  if (!text.includes("{{")) return text;
  const refs = { ...ctx.record.refs, userId: ctx.actor.userId };
  const rc = await buildTemplateContext(ctx.actor, refs).catch(() => null);
  if (!rc) return renderTemplateContent({ body: text }, { values: {}, available: new Set() }).body;
  return renderTemplateContent({ body: text }, rc).body;
}

async function freshVersion(ctx: ActionRunContext): Promise<number> {
  const snap = await loadRecordSnapshot(ctx.companyId, ctx.entityType, ctx.entityId);
  if (!snap.exists || snap.version === null) throw new WorkflowActionError("The record no longer exists.", "NOT_FOUND", false);
  return snap.version;
}

async function assertActiveUser(companyId: string, userId: string, label: string) {
  const u = await prisma.user.findFirst({ where: { id: userId, companyId, status: "ACTIVE" }, select: { id: true } });
  if (!u) throw new WorkflowActionError(`${label} is not an active user of this company.`, "VALIDATION_ERROR", false);
}

function recipientFor(ctx: ActionRunContext): string | null {
  switch (str(ctx.params.recipient)) {
    case "RECORD_OWNER":
      return ctx.record.ownerUserId;
    case "RUN_AS":
      return ctx.actor.userId;
    case "USER":
      return str(ctx.params.userId) || null;
    default:
      return null;
  }
}

function tagChanger(entityType: CrmEntityType) {
  switch (entityType) {
    case "LEAD":
      return changeLeadTags;
    case "CONTACT":
      return changeContactTags;
    case "COMPANY":
      return changeCompanyTags;
    case "OPPORTUNITY":
      return changeOpportunityTags;
    default:
      throw new WorkflowActionError("Tags can only be changed on leads, contacts, companies and opportunities.", "VALIDATION_ERROR", false);
  }
}

/** The CRM record a task / note goes on (activities and conversations resolve to their record). */
function parentRecord(ctx: ActionRunContext): { entityType: "LEAD" | "CONTACT" | "COMPANY" | "OPPORTUNITY" | "CONVERSATION"; entityId: string } {
  if (["LEAD", "CONTACT", "COMPANY", "OPPORTUNITY", "CONVERSATION"].includes(ctx.entityType)) return { entityType: ctx.entityType as "LEAD", entityId: ctx.entityId };
  const p = ctx.record.parent;
  if (p && ["LEAD", "CONTACT", "COMPANY", "OPPORTUNITY", "CONVERSATION"].includes(p.entityType)) return { entityType: p.entityType as "LEAD", entityId: p.entityId };
  throw new WorkflowActionError("This record has no lead, contact, company or opportunity to attach to.", "VALIDATION_ERROR", false);
}

/** The conversation a template message goes to. */
async function resolveConversation(ctx: ActionRunContext, channelType: string): Promise<{ id: string; channelId: string; status: string }> {
  if (ctx.entityType === "CONVERSATION") {
    const c = await prisma.crmConversation.findFirst({ where: { id: ctx.entityId, companyId: ctx.companyId }, select: { id: true, channelId: true, channelType: true, status: true } });
    if (!c) throw new WorkflowActionError("The conversation no longer exists.", "NOT_FOUND", false);
    if (c.channelType !== channelType) throw new WorkflowActionError(`The template is for ${channelType} but this conversation is ${c.channelType}.`, "VALIDATION_ERROR", false);
    return c;
  }
  const contactId = ctx.record.refs.contactId;
  if (!contactId) throw new WorkflowActionError("This record has no contact to message.", "NO_CONTACT", false);
  const c = await prisma.crmConversation.findFirst({
    where: { companyId: ctx.companyId, contactId, channelType, status: { not: "ARCHIVED" } },
    orderBy: [{ lastMessageAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
    select: { id: true, channelId: true, status: true },
  });
  if (!c) throw new WorkflowActionError(`The contact has no ${channelType} conversation yet. Messages go to an existing conversation (starting new ones isn't available yet).`, "NO_CONVERSATION", false);
  return c;
}

type Runner = (ctx: ActionRunContext) => Promise<ActionResult>;

const RUNNERS: Record<WorkflowActionKey, Runner> = {
  async "record.assign_owner"(ctx) {
    const userId = str(ctx.params.userId);
    await assertActiveUser(ctx.companyId, userId, "The owner");
    if (ctx.dryRun) return { summary: `Would assign the ${ctx.entityType.toLowerCase()} to the chosen user.`, output: { userId } };
    const input = { ownerUserId: userId };
    if (ctx.entityType === "LEAD") await assignLead(ctx.actor, ctx.entityId, input);
    else if (ctx.entityType === "CONTACT") await assignContact(ctx.actor, ctx.entityId, input);
    else if (ctx.entityType === "COMPANY") await assignCompany(ctx.actor, ctx.entityId, input);
    else if (ctx.entityType === "OPPORTUNITY") await assignOpportunity(ctx.actor, ctx.entityId, input);
    else throw new WorkflowActionError("Owners can only be set on leads, contacts, companies and opportunities.", "VALIDATION_ERROR", false);
    return { summary: "Owner assigned.", output: { userId } };
  },

  async "record.add_tags"(ctx) {
    const addTagIds = strList(ctx.params.tagIds);
    const addTagNames = str(ctx.params.tagNames)
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 20);
    const change = tagChanger(ctx.entityType);
    if (ctx.dryRun) return { summary: `Would add ${addTagIds.length + addTagNames.length} tag(s).`, output: { addTagIds, addTagNames } };
    const tags = await change(ctx.actor, ctx.entityId, { addTagIds, addTagNames, removeTagIds: [] });
    return { summary: "Tags added.", output: { tags: tags.map((t) => t.name) } };
  },

  async "record.remove_tags"(ctx) {
    const removeTagIds = strList(ctx.params.tagIds);
    const change = tagChanger(ctx.entityType);
    if (ctx.dryRun) return { summary: `Would remove ${removeTagIds.length} tag(s).`, output: { removeTagIds } };
    const tags = await change(ctx.actor, ctx.entityId, { addTagIds: [], addTagNames: [], removeTagIds });
    return { summary: "Tags removed.", output: { tags: tags.map((t) => t.name) } };
  },

  async "lead.change_status"(ctx) {
    const statusId = str(ctx.params.statusId);
    const status = await prisma.crmLeadStatus.findFirst({ where: { id: statusId, companyId: ctx.companyId }, select: { name: true, kind: true } });
    if (!status) throw new WorkflowActionError("The lead status no longer exists.", "NOT_FOUND", false);
    if (status.kind === "CONVERTED") throw new WorkflowActionError("Converting a lead needs the conversion step; a workflow can't set the converted status.", "VALIDATION_ERROR", false);
    if (ctx.dryRun) return { summary: `Would move the lead to "${status.name}".`, output: { statusId } };
    await changeLeadStatus(ctx.actor, ctx.entityId, { statusId });
    return { summary: `Status → ${status.name}.`, output: { statusId } };
  },

  async "lead.update"(ctx) {
    const patch: Record<string, unknown> = {};
    const temperature = str(ctx.params.temperature);
    if (temperature) patch.temperature = temperature;
    const score = numOrUndef(ctx.params.score);
    if (score !== undefined) patch.score = Math.max(0, Math.min(100, Math.round(score)));
    const days = numOrUndef(ctx.params.followUpInDays);
    if (days !== undefined) patch.nextFollowUpAt = new Date(Date.now() + Math.round(days) * 86_400_000).toISOString();
    if (!Object.keys(patch).length) throw new WorkflowActionError("Nothing to update — set at least one field.", "VALIDATION_ERROR", false);
    if (ctx.dryRun) return { summary: `Would update the lead: ${Object.keys(patch).join(", ")}.`, output: patch };
    await updateLead(ctx.actor, ctx.entityId, { ...patch, version: await freshVersion(ctx) });
    return { summary: `Lead updated (${Object.keys(patch).join(", ")}).`, output: patch };
  },

  async "company.change_status"(ctx) {
    const statusId = str(ctx.params.statusId);
    const status = await prisma.crmCompanyStatus.findFirst({ where: { id: statusId, companyId: ctx.companyId }, select: { name: true } });
    if (!status) throw new WorkflowActionError("The company status no longer exists.", "NOT_FOUND", false);
    if (ctx.dryRun) return { summary: `Would move the company to "${status.name}".`, output: { statusId } };
    await changeCompanyStatus(ctx.actor, ctx.entityId, { statusId });
    return { summary: `Status → ${status.name}.`, output: { statusId } };
  },

  async "opportunity.move_stage"(ctx) {
    const stageId = str(ctx.params.stageId);
    const stage = await prisma.crmPipelineStage.findFirst({ where: { id: stageId, companyId: ctx.companyId }, select: { name: true, pipelineId: true, archivedAt: true } });
    if (!stage || stage.archivedAt) throw new WorkflowActionError("The stage no longer exists or is archived.", "NOT_FOUND", false);
    if (ctx.dryRun) return { summary: `Would move the opportunity to "${stage.name}" (stage rules apply when it runs).`, output: { stageId } };
    await changeOpportunityStage(ctx.actor, ctx.entityId, { stageId, pipelineId: stage.pipelineId, reason: `Workflow: ${ctx.workflow.name}` });
    return { summary: `Stage → ${stage.name}.`, output: { stageId } };
  },

  async "opportunity.change_status"(ctx) {
    const status = str(ctx.params.status);
    const reason = await interpolate(ctx, str(ctx.params.reason));
    if (ctx.dryRun) return { summary: `Would mark the opportunity ${status.toLowerCase()}.`, output: { status, reason } };
    await changeOpportunityStatus(ctx.actor, ctx.entityId, { status, reason: reason || null });
    return { summary: `Status → ${status}.`, output: { status } };
  },

  async "opportunity.update"(ctx) {
    const patch: Record<string, unknown> = {};
    const p = numOrUndef(ctx.params.probability);
    if (p !== undefined) patch.probability = Math.max(0, Math.min(100, Math.round(p)));
    const days = numOrUndef(ctx.params.closeInDays);
    if (days !== undefined) patch.expectedCloseDate = addCalendarDays(businessToday(), Math.round(days));
    if (!Object.keys(patch).length) throw new WorkflowActionError("Nothing to update — set at least one field.", "VALIDATION_ERROR", false);
    if (ctx.dryRun) return { summary: `Would update the opportunity: ${Object.keys(patch).join(", ")}.`, output: patch };
    await updateOpportunity(ctx.actor, ctx.entityId, { ...patch, version: await freshVersion(ctx) });
    return { summary: `Opportunity updated (${Object.keys(patch).join(", ")}).`, output: patch };
  },

  async "task.create"(ctx) {
    const parent = parentRecord(ctx);
    const assignee = recipientFor(ctx);
    if (assignee) await assertActiveUser(ctx.companyId, assignee, "The assignee");
    const subject = (await interpolate(ctx, str(ctx.params.subject))).slice(0, 200) || "Follow up";
    const description = (await interpolate(ctx, str(ctx.params.description))) || undefined;
    const days = numOrUndef(ctx.params.dueInDays);
    const dueDate = days !== undefined ? addCalendarDays(businessToday(), Math.max(0, Math.round(days))) : null;
    const dueTime = dueDate && /^([01]\d|2[0-3]):[0-5]\d$/.test(str(ctx.params.dueTime)) ? str(ctx.params.dueTime) : null;
    const input = {
      type: str(ctx.params.type) || "TASK",
      mode: "schedule" as const,
      subject,
      description,
      priority: str(ctx.params.priority) || undefined,
      entityType: parent.entityType,
      entityId: parent.entityId,
      assignedToUserId: assignee,
      dueDate,
      dueTime,
      // Idempotent per source + reference: a retried step never creates a second task.
      source: "WORKFLOW",
      externalRef: ctx.step.idempotencyKey,
      metadata: { workflowId: ctx.workflow.id, executionId: ctx.execution.id },
    };
    if (ctx.dryRun) return { summary: `Would create "${subject}"${dueDate ? ` due ${dueDate}${dueTime ? ` ${dueTime}` : ""}` : ""}.`, output: { subject, dueDate, assignee } };
    const created = (await createActivity(ctx.actor, input)) as { id?: string };
    return { summary: `Task created: ${subject}.`, output: { activityId: created?.id ?? null, subject, dueDate } };
  },

  async "note.add"(ctx) {
    const body = (await interpolate(ctx, str(ctx.params.body))).slice(0, 5000);
    if (!body) throw new WorkflowActionError("The note is empty.", "VALIDATION_ERROR", false);
    const target = ctx.entityType === "ACTIVITY" ? parentRecord(ctx) : { entityType: ctx.entityType, entityId: ctx.entityId };
    if (ctx.dryRun) return { summary: "Would add a note.", output: { body } };
    const note = await createNote(ctx.actor, target.entityType, target.entityId, { body });
    return { summary: "Note added.", output: { noteId: (note as { id?: string }).id ?? null } };
  },

  async "appointment.change_status"(ctx) {
    const change = str(ctx.params.change);
    const reason = (await interpolate(ctx, str(ctx.params.reason))) || undefined;
    const row = await prisma.crmActivity.findFirst({ where: { id: ctx.entityId, companyId: ctx.companyId, deletedAt: null }, select: { type: true } });
    if (!row || row.type !== "APPOINTMENT") throw new WorkflowActionError("This record is not an appointment.", "VALIDATION_ERROR", false);
    if (ctx.dryRun) return { summary: `Would ${change.toLowerCase().replace("_", "-")} the appointment.`, output: { change } };
    if (change === "CONFIRM") await confirmAppointment(ctx.actor, ctx.entityId, {});
    else if (change === "CANCEL") await cancelAppointment(ctx.actor, ctx.entityId, { reason });
    else if (change === "COMPLETE") await completeAppointment(ctx.actor, ctx.entityId, { note: reason });
    else if (change === "NO_SHOW") await markNoShow(ctx.actor, ctx.entityId, { reason });
    else throw new WorkflowActionError("Unknown appointment change.", "VALIDATION_ERROR", false);
    return { summary: `Appointment: ${change}.`, output: { change } };
  },

  async "conversation.assign"(ctx) {
    const userId = str(ctx.params.userId);
    await assertActiveUser(ctx.companyId, userId, "The user");
    if (ctx.dryRun) return { summary: "Would assign the conversation.", output: { userId } };
    await assignConversation(ctx.actor, ctx.entityId, { version: await freshVersion(ctx), assignedToUserId: userId });
    return { summary: "Conversation assigned.", output: { userId } };
  },

  async "conversation.change_status"(ctx) {
    const status = str(ctx.params.status);
    if (ctx.dryRun) return { summary: `Would set the conversation to ${status.toLowerCase()}.`, output: { status } };
    await changeConversationStatus(ctx.actor, ctx.entityId, { version: await freshVersion(ctx), status });
    return { summary: `Conversation → ${status}.`, output: { status } };
  },

  async "message.send"(ctx) {
    const templateId = str(ctx.params.templateId);
    const t = await prisma.crmMessageTemplate.findFirst({ where: { id: templateId, companyId: ctx.companyId }, select: { channelType: true, status: true, name: true } });
    if (!t) throw new WorkflowActionError("The template no longer exists.", "NOT_FOUND", false);
    if (t.status !== "ACTIVE") throw new WorkflowActionError(`The template "${t.name}" is not active.`, "CRM_TEMPLATE_INVALID", false);
    const conv = await resolveConversation(ctx, t.channelType);
    const rendered = await TemplateService.renderTemplate(ctx.actor, templateId, { refs: { conversationId: conv.id, userId: ctx.actor.userId } }, { requireUsable: true, channelId: conv.channelId });
    if (!rendered.ok) throw new WorkflowActionError(`The template can't be sent: ${rendered.errors.map((e) => e.message).join(" ")}`, "CRM_TEMPLATE_INVALID", false);
    if (ctx.dryRun) return { summary: `Would send "${t.name}" (v${rendered.version.versionNumber}) in the conversation. Do-not-contact rules are checked when it runs.`, output: { conversationId: conv.id, preview: rendered.body.slice(0, 300) } };
    const msg = (await sendConversationMessage(ctx.actor, conv.id, {
      clientMessageId: uuidFromKey(ctx.step.idempotencyKey),
      subject: rendered.subject ?? undefined,
      body: rendered.body,
      templateId,
      templateVersionId: rendered.version.id,
    })) as { id: string; status: string; error?: { code: string | null; message: string } | null };
    if (msg.status === "FAILED") throw new WorkflowActionError(msg.error?.message ?? "The message could not be sent.", msg.error?.code ?? "MESSAGE_FAILED", false);
    return { summary: `Sent "${t.name}".`, output: { messageId: msg.id, conversationId: conv.id, status: msg.status, templateVersionId: rendered.version.id } };
  },

  async "notification.send"(ctx) {
    const mode = str(ctx.params.recipient);
    const ids = mode === "USERS" ? strList(ctx.params.userIds) : [mode === "RUN_AS" ? ctx.actor.userId : ctx.record.ownerUserId].filter((x): x is string => Boolean(x));
    if (!ids.length) throw new WorkflowActionError(mode === "RECORD_OWNER" ? "The record has no owner to notify." : "Choose who to notify.", "VALIDATION_ERROR", false);
    const users = await prisma.user.findMany({ where: { id: { in: ids }, companyId: ctx.companyId, status: "ACTIVE" }, select: { id: true } });
    if (!users.length) throw new WorkflowActionError("None of the users to notify are active.", "VALIDATION_ERROR", false);
    const title = (await interpolate(ctx, str(ctx.params.title))).slice(0, 200);
    const body = (await interpolate(ctx, str(ctx.params.body))).slice(0, 2000);
    if (ctx.dryRun) return { summary: `Would notify ${users.length} user(s): "${title}".`, output: { userIds: users.map((u) => u.id), title } };
    await prisma.$transaction(async (tx) => {
      for (const u of users) await createNotification({ companyId: ctx.companyId, userId: u.id, title, body }, tx);
    });
    return { summary: `Notified ${users.length} user(s).`, output: { userIds: users.map((u) => u.id) } };
  },

  async "webhook.post"(ctx) {
    const url = str(ctx.params.url);
    const parsed = assertWebhookUrlShape(url);
    await resolveSafeAddress(parsed);
    const extra = ctx.params.extra && typeof ctx.params.extra === "object" && !Array.isArray(ctx.params.extra) ? (ctx.params.extra as Record<string, unknown>) : {};
    const payload = {
      id: ctx.step.idempotencyKey,
      type: "crm.workflow.webhook",
      occurredAt: new Date().toISOString(),
      workflow: { id: ctx.workflow.id, name: ctx.workflow.name },
      execution: { id: ctx.execution.id },
      trigger: ctx.trigger ? { eventId: ctx.trigger.eventId ?? null, eventType: ctx.trigger.eventType ?? null } : null,
      record: { entityType: ctx.entityType, entityId: ctx.entityId, ...(ctx.params.includeRecord === true ? { fields: ctx.record.values } : {}) },
      data: extra,
    };
    if (ctx.dryRun) return { summary: `Would POST to ${parsed.origin}${parsed.pathname} (address checked and allowed).`, output: { host: parsed.host } };
    const wf = await prisma.crmWorkflow.findFirst({ where: { id: ctx.workflow.id, companyId: ctx.companyId }, select: { webhookSecretEnc: true } });
    if (!wf?.webhookSecretEnc) throw new WorkflowActionError("The workflow has no signing secret.", "VALIDATION_ERROR", false);
    const res = await postSignedWebhook(url, payload, { secret: decryptSecret(wf.webhookSecretEnc), idempotencyKey: ctx.step.idempotencyKey, eventId: ctx.step.idempotencyKey });
    return { summary: `Webhook answered ${res.status}.`, output: { host: parsed.host, status: res.status, durationMs: res.durationMs, response: res.bodyPreview.slice(0, 500) } };
  },
};

/**
 * Runs one action as the run-as user. Checks the user's ERP permission for
 * the action first (live — a suspended user or a removed permission stops
 * the workflow), then the record type, then hands over to the service.
 */
export async function runWorkflowAction(key: WorkflowActionKey, ctx: ActionRunContext): Promise<ActionResult> {
  const def = WORKFLOW_ACTIONS[key] as WorkflowActionDef;
  try {
    const allowed = await PermissionService.can(ctx.actor.userId, def.permission.module, def.permission.action);
    if (!allowed) throw new WorkflowActionError(`The run-as user no longer has ${def.permission.module}.${def.permission.action}, needed for "${def.label}".`, "PERMISSION_DENIED", false);
    if (!(def.entities as readonly string[]).includes(ctx.entityType)) throw new WorkflowActionError(`"${def.label}" can't run on this record type.`, "VALIDATION_ERROR", false);
    if (!ctx.record.exists) throw new WorkflowActionError("The record no longer exists.", "NOT_FOUND", false);
    return await RUNNERS[key](ctx);
  } catch (e) {
    throw toActionError(e, def);
  }
}
