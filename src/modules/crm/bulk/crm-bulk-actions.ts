import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { registerAction, registerEntity } from "@/modules/bulk-actions/bulk-registry";
import { BulkItemError } from "@/modules/bulk-actions/bulk-safety";
import type { BulkActionDefinition, BulkActor, BulkItemContext, BulkItemOutcome, BulkParamField } from "@/modules/bulk-actions/bulk-types";
import { archiveCompany, assignCompany, changeCompanyStatus, changeCompanyTags, restoreCompany, updateCompany } from "../companies/crm-companies.service";
import { archiveContact, assignContact, changeContactTags, restoreContact, updateContact } from "../contacts/crm-contacts.service";
import { archiveLead, assignLead, changeLeadStatus, changeLeadTags, restoreLead, updateLead } from "../leads/lead.service";
import { archiveOpportunity, assignOpportunity, changeOpportunityStage, changeOpportunityTags, restoreOpportunity, updateOpportunity } from "../opportunities/crm-opportunities.service";
import { listPipelines } from "../pipelines/crm-pipelines.service";
import { listCompanyStatuses, listLeadSources, listLeadStatuses } from "../settings/crm-settings.service";
import { listTags } from "../tags/crm-tags.service";
import { runWorkflowManually } from "../workflows/crm-workflows.service";
import { definitionEntities } from "../workflows/workflow-definition";
import { runWorkflowAction } from "../workflows/workflow-actions";
import { loadRecordSnapshot } from "../workflows/workflow-context";
import type { WorkflowDefinition } from "../workflows/workflow-definition";
import { CRM_BULK_ENTITIES, crmBulkEntity, crmEntityWhere, type CrmBulkEntityKey } from "./crm-bulk-entities";
import { EXPORT_MAX_ROWS, exportOutcome, exportRows, writeExportFile } from "./crm-bulk-export";

/**
 * Phase 14 — the CRM's bulk actions. Every per-record step calls the SAME
 * service function the UI and the workflow engine use (assignLead,
 * changeOpportunityStage, archiveContact, …), as the user who started the
 * job, so record visibility, field validation, stage rules, optimistic
 * locking, audit log and timeline events apply to each record exactly as if
 * it were done by hand. Nothing here writes CRM tables directly.
 *
 * Deliberately not offered:
 *   - permanent delete — CRM records have no delete service (archive is the
 *     supported removal); registered as unavailable with that reason;
 *   - sequence enrolment — the sales-sequence engine (Phase 17) doesn't exist
 *     yet; registered as unavailable (interface only).
 */

const PERM = {
  view: { module: "crm", action: "view" },
  edit: { module: "crm", action: "edit" },
  export: { module: "crm", action: "export" },
  settingsEdit: { module: "crm_settings", action: "edit" },
} as const;

const MAX_MUTATION = 5_000;
const LABEL: Record<CrmBulkEntityKey, { one: string; many: string }> = {
  LEAD: { one: "lead", many: "leads" },
  CONTACT: { one: "contact", many: "contacts" },
  COMPANY: { one: "company", many: "companies" },
  OPPORTUNITY: { one: "opportunity", many: "opportunities" },
};

const uuid = z.string().uuid();
const blankToUndef = (v: unknown) => (v === "" || v === null ? undefined : v);

// ── Shared lookups for parameter fields ──────────────────────────

async function activeUsers(companyId: string) {
  const rows = await prisma.user.findMany({ where: { companyId, status: "ACTIVE" }, select: { id: true, fullName: true }, orderBy: { fullName: "asc" }, take: 1000 });
  return rows.map((u) => ({ value: u.id, label: u.fullName }));
}

async function assertActiveUser(companyId: string, userId: string) {
  const u = await prisma.user.findFirst({ where: { id: userId, companyId, status: "ACTIVE" }, select: { fullName: true } });
  if (!u) throw new BusinessRuleError("VALIDATION_ERROR", "The selected owner is not an active user in this company.", { fieldErrors: { ownerUserId: "Choose an active user." } });
  return u.fullName;
}

/** Minimal current state of one record AS THE ACTOR SEES IT (null = gone / not visible). */
async function loadState(actor: BulkActor, entityType: CrmBulkEntityKey, id: string) {
  const base = await crmEntityWhere(actor, entityType, { archived: "include" });
  const where = { AND: [base, { id }] };
  switch (entityType) {
    case "LEAD":
      return prisma.crmLead.findFirst({ where: where as Prisma.CrmLeadWhereInput, select: { id: true, ownerUserId: true, archivedAt: true, version: true, statusId: true, convertedAt: true } });
    case "CONTACT":
      return prisma.crmContact.findFirst({ where: where as Prisma.CrmContactWhereInput, select: { id: true, ownerUserId: true, archivedAt: true, version: true } });
    case "COMPANY":
      return prisma.crmCompany.findFirst({ where: where as Prisma.CrmCompanyWhereInput, select: { id: true, ownerUserId: true, archivedAt: true, version: true, statusId: true } });
    case "OPPORTUNITY":
      return prisma.crmOpportunity.findFirst({ where: where as Prisma.CrmOpportunityWhereInput, select: { id: true, ownerUserId: true, archivedAt: true, version: true, stageId: true, status: true } });
  }
}
type RecordState = NonNullable<Awaited<ReturnType<typeof loadState>>> & { statusId?: string | null; stageId?: string | null; convertedAt?: Date | null; status?: string };

async function requireState(ctx: BulkItemContext<unknown>, entityType: CrmBulkEntityKey): Promise<RecordState> {
  const s = await loadState(ctx.actor, entityType, ctx.item.entityId);
  if (!s) throw new BulkItemError("The record no longer exists or is no longer visible to you.", "NOT_FOUND");
  return s as RecordState;
}

const skipped = (message: string): BulkItemOutcome => ({ status: "SKIPPED", message });
const done = (message?: string, result?: Record<string, unknown>): BulkItemOutcome => ({ status: "SUCCEEDED", ...(message ? { message } : {}), ...(result ? { result } : {}) });

// ── Service adapters per entity ──────────────────────────────────

const SERVICES = {
  LEAD: { assign: assignLead, tags: changeLeadTags, archive: archiveLead, restore: restoreLead },
  CONTACT: { assign: assignContact, tags: changeContactTags, archive: archiveContact, restore: restoreContact },
  COMPANY: { assign: assignCompany, tags: changeCompanyTags, archive: archiveCompany, restore: restoreCompany },
  OPPORTUNITY: { assign: assignOpportunity, tags: changeOpportunityTags, archive: archiveOpportunity, restore: restoreOpportunity },
} as const;

async function currentTagIds(companyId: string, entityType: CrmBulkEntityKey, entityId: string) {
  const rows = await prisma.crmEntityTag.findMany({ where: { companyId, entityType, entityId }, select: { tagId: true } });
  return new Set(rows.map((r) => r.tagId));
}

// ── Common actions (all four entities) ───────────────────────────

const assignSchema = z.object({ ownerUserId: z.preprocess(blankToUndef, uuid.nullable().optional()) }).strict();
const tagsSchema = z
  .object({
    tagIds: z.array(uuid).max(50).default([]),
    tagNames: z.array(z.string().trim().min(1).max(40)).max(50).default([]),
  })
  .strict()
  .refine((v) => v.tagIds.length + v.tagNames.length > 0, { message: "Choose at least one tag.", path: ["tagIds"] });
const removeTagsSchema = z.object({ tagIds: z.array(uuid).min(1, "Choose at least one tag.").max(50) }).strict();
const emptySchema = z.object({}).strict();
const exportSchema = z.object({ format: z.enum(["CSV", "XLSX"]).default("XLSX") }).strict();
const workflowSchema = z.object({ workflowId: uuid }).strict();
const templateSchema = z.object({ templateId: uuid }).strict();

function commonActions(entityType: CrmBulkEntityKey): BulkActionDefinition<never>[] {
  const L = LABEL[entityType];
  const svc = SERVICES[entityType];
  const key = (k: string) => `${entityType.toLowerCase()}.${k}`;
  const tagOptions = async (actor: BulkActor) => (await listTags(actor.companyId, undefined, 300)).map((t) => ({ value: t.id, label: t.name }));

  const assign: BulkActionDefinition<z.infer<typeof assignSchema>> = {
    key: key("assign"),
    entityType,
    kind: "assign",
    label: "Assign owner",
    description: `Give the selected ${L.many} a new owner (or leave them unassigned).`,
    permissions: [PERM.edit],
    paramsSchema: assignSchema,
    fields: async (actor) => [{ key: "ownerUserId", label: "New owner", type: "user", allowNone: true, noneLabel: "Unassigned", options: await activeUsers(actor.companyId) }],
    confirmation: "confirm",
    retrySafe: true,
    cancellable: true,
    maxItems: MAX_MUTATION,
    prepare: async (actor, p) => {
      if (!p.ownerUserId) return { params: { ownerUserId: null }, summary: "Owner → Unassigned" };
      return { params: p, summary: `Owner → ${await assertActiveUser(actor.companyId, p.ownerUserId)}` };
    },
    executeItem: async (ctx) => {
      const s = await requireState(ctx, entityType);
      const target = ctx.params.ownerUserId ?? null;
      if (s.archivedAt) return skipped("Archived — restore it first.");
      if (s.ownerUserId === target) return skipped("Already assigned to this owner.");
      await svc.assign(ctx.actor, ctx.item.entityId, { ownerUserId: target });
      return done();
    },
  };

  const addTags: BulkActionDefinition<z.infer<typeof tagsSchema>> = {
    key: key("add_tags"),
    entityType,
    kind: "tags",
    label: "Add tags",
    description: `Add tags to the selected ${L.many}. New tag names are created once.`,
    permissions: [PERM.edit],
    paramsSchema: tagsSchema,
    fields: async (actor) => [{ key: "tagIds", label: "Tags", type: "tags", allowNew: true, options: await tagOptions(actor) }],
    confirmation: "none",
    retrySafe: true,
    cancellable: true,
    maxItems: MAX_MUTATION,
    prepare: async (actor, p) => {
      const found = p.tagIds.length ? await prisma.crmTag.findMany({ where: { companyId: actor.companyId, id: { in: p.tagIds } }, select: { id: true, name: true } }) : [];
      if (found.length !== new Set(p.tagIds).size) throw new BusinessRuleError("VALIDATION_ERROR", "One or more tags no longer exist.", { fieldErrors: { tagIds: "Choose existing tags." } });
      return { params: p, summary: `Add tags: ${[...found.map((t) => t.name), ...p.tagNames].join(", ")}` };
    },
    executeItem: async (ctx) => {
      const s = await requireState(ctx, entityType);
      if (s.archivedAt) return skipped("Archived — restore it first.");
      const before = await currentTagIds(ctx.actor.companyId, entityType, ctx.item.entityId);
      const after = await svc.tags(ctx.actor, ctx.item.entityId, { addTagIds: ctx.params.tagIds, addTagNames: ctx.params.tagNames, removeTagIds: [] });
      const added = after.filter((t) => !before.has(t.id)).length;
      return added ? done(`${added} tag(s) added.`) : skipped("Already has these tags.");
    },
  };

  const removeTags: BulkActionDefinition<z.infer<typeof removeTagsSchema>> = {
    key: key("remove_tags"),
    entityType,
    kind: "tags",
    label: "Remove tags",
    description: `Remove tags from the selected ${L.many}. The tags themselves are kept.`,
    permissions: [PERM.edit],
    paramsSchema: removeTagsSchema,
    fields: async (actor) => [{ key: "tagIds", label: "Tags to remove", type: "tags", allowNew: false, options: await tagOptions(actor) }],
    confirmation: "none",
    retrySafe: true,
    cancellable: true,
    maxItems: MAX_MUTATION,
    prepare: async (actor, p) => {
      const found = await prisma.crmTag.findMany({ where: { companyId: actor.companyId, id: { in: p.tagIds } }, select: { name: true } });
      return { params: p, summary: `Remove tags: ${found.map((t) => t.name).join(", ") || "(deleted tags)"}` };
    },
    executeItem: async (ctx) => {
      const s = await requireState(ctx, entityType);
      if (s.archivedAt) return skipped("Archived — restore it first.");
      const before = await currentTagIds(ctx.actor.companyId, entityType, ctx.item.entityId);
      if (!ctx.params.tagIds.some((t) => before.has(t))) return skipped("Doesn't have these tags.");
      await svc.tags(ctx.actor, ctx.item.entityId, { addTagIds: [], addTagNames: [], removeTagIds: ctx.params.tagIds });
      return done();
    },
  };

  const archive: BulkActionDefinition<Record<string, never>> = {
    key: key("archive"),
    entityType,
    kind: "archive",
    label: "Archive",
    description: `Archive the selected ${L.many}. Nothing is deleted: history, notes and links stay and each record can be restored.`,
    permissions: [PERM.edit],
    paramsSchema: emptySchema,
    destructive: true,
    confirmation: "type_count",
    retrySafe: true,
    cancellable: true,
    maxItems: MAX_MUTATION,
    prepare: async (_a, p) => ({ params: p, summary: `Archive ${L.many}` }),
    executeItem: async (ctx) => {
      const s = await requireState(ctx, entityType);
      if (s.archivedAt) return skipped("Already archived.");
      await svc.archive(ctx.actor, ctx.item.entityId);
      return done();
    },
  };

  const restore: BulkActionDefinition<Record<string, never>> = {
    key: key("restore"),
    entityType,
    kind: "restore",
    label: "Restore",
    description: `Restore archived ${L.many}. Records that aren't archived are skipped.`,
    permissions: [PERM.edit],
    paramsSchema: emptySchema,
    confirmation: "confirm",
    retrySafe: true,
    cancellable: true,
    maxItems: MAX_MUTATION,
    prepare: async (_a, p) => ({ params: p, summary: `Restore ${L.many}` }),
    executeItem: async (ctx) => {
      const s = await requireState(ctx, entityType);
      if (!s.archivedAt) return skipped("Not archived.");
      await svc.restore(ctx.actor, ctx.item.entityId);
      return done();
    },
  };

  const del: BulkActionDefinition<Record<string, never>> = {
    key: key("delete"),
    entityType,
    kind: "delete",
    label: "Delete permanently",
    description: `Permanently delete ${L.many}.`,
    permissions: [{ module: "crm", action: "delete" }],
    paramsSchema: emptySchema,
    destructive: true,
    confirmation: "type_count",
    retrySafe: false,
    cancellable: true,
    maxItems: MAX_MUTATION,
    unavailableReason: `CRM ${L.many} can't be deleted permanently — their history, documents and ERP links must be kept. Use Archive instead (it can be undone).`,
  };

  const exportAction: BulkActionDefinition<z.infer<typeof exportSchema>> = {
    key: key("export"),
    entityType,
    kind: "export",
    label: "Export",
    description: `Export the selected ${L.many} to Excel or CSV in the background. The file can be downloaded by you for ${7} days.`,
    permissions: [PERM.export],
    paramsSchema: exportSchema,
    fields: async () => [
      { key: "format", label: "Format", type: "select", required: true, options: [{ value: "XLSX", label: "Excel (.xlsx)" }, { value: "CSV", label: "CSV (.csv)" }] },
    ],
    confirmation: "none",
    retrySafe: true,
    cancellable: true,
    maxItems: EXPORT_MAX_ROWS,
    prepare: async (_a, p) => ({ params: p, summary: `Export to ${p.format === "CSV" ? "CSV" : "Excel"}` }),
    executeBatch: async (ctx) => {
      const rows = await exportRows(ctx.actor, entityType, ctx.items.map((i) => i.entityId));
      return new Map(ctx.items.map((i) => [i.id, exportOutcome(rows.get(i.entityId))]));
    },
    finalize: async (ctx) => writeExportFile(ctx.job, entityType, ctx.params.format, crmBulkEntity(entityType).pluralLabel),
  };

  const enrolWorkflow: BulkActionDefinition<z.infer<typeof workflowSchema>> = {
    key: key("enroll_workflow"),
    entityType,
    kind: "workflow",
    label: "Start a workflow",
    description: `Start an active workflow on each selected ${L.one} now (Phase 18). The workflow's re-entry rule applies: records already in it are skipped.`,
    permissions: [PERM.edit, PERM.settingsEdit],
    paramsSchema: workflowSchema,
    fields: async (actor) => [{ key: "workflowId", label: "Workflow", type: "select", required: true, options: await workflowOptions(actor, entityType) }],
    confirmation: "confirm",
    // A start that crashed mid-way may already have created an execution; don't re-run it blindly.
    retrySafe: false,
    cancellable: true,
    maxItems: 2_000,
    prepare: async (actor, p) => {
      const opts = await workflowOptions(actor, entityType);
      const w = opts.find((o) => o.value === p.workflowId);
      if (!w) throw new BusinessRuleError("VALIDATION_ERROR", `Choose an active workflow that runs on ${L.many}.`, { fieldErrors: { workflowId: "Not an active workflow for this record type." } });
      return { params: p, summary: `Start workflow "${w.label}"` };
    },
    executeItem: async (ctx) => {
      await requireState(ctx, entityType);
      try {
        const exec = await runWorkflowManually(ctx.actor, ctx.params.workflowId, { entityType, entityId: ctx.item.entityId });
        return done(`Execution ${String(exec.status).toLowerCase()}.`, { executionId: exec.id });
      } catch (e) {
        // Re-entry rule: "already in this workflow" / "runs once per record" is a skip, not a failure.
        if (e instanceof BusinessRuleError && e.code === "INVALID_STATE_TRANSITION" && /already/i.test(e.message)) return skipped(e.message);
        throw e;
      }
    },
  };

  const enrolSequence: BulkActionDefinition<Record<string, never>> = {
    key: key("enroll_sequence"),
    entityType,
    kind: "sequence",
    label: "Enrol in a sequence",
    description: `Add the selected ${L.many} to a sales sequence.`,
    permissions: [PERM.edit],
    paramsSchema: emptySchema,
    confirmation: "confirm",
    retrySafe: false,
    cancellable: true,
    maxItems: MAX_MUTATION,
    unavailableReason: "Sales sequences are not built yet (planned for a later phase). This action will appear here when they are.",
  };

  return [assign, addTags, removeTags, archive, restore, exportAction, enrolWorkflow, enrolSequence, del] as unknown as BulkActionDefinition<never>[];
}

async function workflowOptions(actor: BulkActor, entityType: CrmBulkEntityKey) {
  const rows = await prisma.crmWorkflow.findMany({
    where: { companyId: actor.companyId, status: "PUBLISHED", publishedVersionId: { not: null } },
    select: { id: true, name: true, publishedVersion: { select: { definition: true } } },
    orderBy: { name: "asc" },
    take: 500,
  });
  return rows
    .filter((w) => {
      try {
        return definitionEntities(w.publishedVersion!.definition as unknown as WorkflowDefinition).includes(entityType);
      } catch {
        return false;
      }
    })
    .map((w) => ({ value: w.id, label: w.name }));
}

// ── Communication (Phases 11/12 via the Phase 18 action runner) ───

/**
 * Sends an active template into the record's contact's latest conversation on
 * the template's channel — the exact code path a workflow uses
 * ("Send message from template"): template must be active and usable, the
 * contact's do-not-contact / consent rules are checked by the messaging
 * service, and the message id is derived from the job item so a retry never
 * sends twice. New conversations are not started.
 */
function sendTemplateAction(entityType: CrmBulkEntityKey): BulkActionDefinition<z.infer<typeof templateSchema>> {
  const L = LABEL[entityType];
  return {
    key: `${entityType.toLowerCase()}.send_template`,
    entityType,
    kind: "communication",
    label: "Send message from template",
    description: `Send an approved template to each selected ${L.one}'s contact, in their latest conversation on the template's channel. Do-not-contact and consent rules are always respected.`,
    permissions: [PERM.edit],
    paramsSchema: templateSchema,
    fields: async (actor) => {
      const ts = await prisma.crmMessageTemplate.findMany({ where: { companyId: actor.companyId, status: "ACTIVE" }, select: { id: true, name: true, channelType: true }, orderBy: { name: "asc" }, take: 500 });
      return [{ key: "templateId", label: "Template", type: "select", required: true, options: ts.map((t) => ({ value: t.id, label: t.name, group: t.channelType })) }] satisfies BulkParamField[];
    },
    destructive: true,
    confirmation: "type_count",
    // Message ids are derived from the job item: re-running can't create a second message.
    retrySafe: true,
    cancellable: true,
    maxItems: 1_000,
    prepare: async (actor, p) => {
      const t = await prisma.crmMessageTemplate.findFirst({ where: { id: p.templateId, companyId: actor.companyId }, select: { name: true, status: true, channelType: true } });
      if (!t || t.status !== "ACTIVE") throw new BusinessRuleError("VALIDATION_ERROR", "Choose an active message template.", { fieldErrors: { templateId: "Not an active template." } });
      return { params: p, summary: `Send "${t.name}" (${t.channelType})`, warnings: ["Contacts without a conversation on this channel, and contacts who opted out, are reported as failed and not messaged."] };
    },
    executeItem: async (ctx) => {
      await requireState(ctx, entityType);
      const record = await loadRecordSnapshot(ctx.actor.companyId, entityType, ctx.item.entityId);
      const r = await runWorkflowAction("message.send", {
        companyId: ctx.actor.companyId,
        actor: ctx.actor,
        workflow: { id: ctx.job.id, name: "Bulk job" },
        execution: { id: ctx.job.id },
        step: { idempotencyKey: ctx.idempotencyKey, nodeId: "bulk" },
        entityType,
        entityId: ctx.item.entityId,
        record,
        trigger: null,
        params: { templateId: ctx.params.templateId },
        dryRun: false,
      });
      return done(r.summary, { messageId: r.output.messageId ?? null, conversationId: r.output.conversationId ?? null });
    },
  };
}

// ── Entity-specific actions ──────────────────────────────────────

const leadStatusSchema = z.object({ statusId: uuid }).strict();
const leadUpdateSchema = z
  .object({
    temperature: z.preprocess(blankToUndef, z.enum(["COLD", "WARM", "HOT"]).optional()),
    score: z.preprocess(blankToUndef, z.coerce.number().int().min(0).max(100).optional()),
    sourceId: z.preprocess(blankToUndef, uuid.optional()),
    nextFollowUpAt: z.preprocess(blankToUndef, z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date").optional()),
  })
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: "Set at least one field to change.", path: ["temperature"] });

const contactUpdateSchema = z
  .object({
    designation: z.preprocess(blankToUndef, z.string().trim().max(100).optional()),
    department: z.preprocess(blankToUndef, z.string().trim().max(100).optional()),
    sourceId: z.preprocess(blankToUndef, uuid.optional()),
  })
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: "Set at least one field to change.", path: ["designation"] });

const companyStatusSchema = z.object({ statusId: uuid }).strict();
const companyUpdateSchema = z
  .object({
    industry: z.preprocess(blankToUndef, z.string().trim().max(100).optional()),
    companyType: z.preprocess(blankToUndef, z.string().trim().max(100).optional()),
    sourceId: z.preprocess(blankToUndef, uuid.optional()),
  })
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: "Set at least one field to change.", path: ["industry"] });

const oppStageSchema = z.object({ stageId: uuid }).strict();
const oppUpdateSchema = z
  .object({
    probability: z.preprocess(blankToUndef, z.coerce.number().int().min(0).max(100).optional()),
    expectedCloseDate: z.preprocess(blankToUndef, z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date").optional()),
  })
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: "Set at least one field to change.", path: ["probability"] });

async function sourceOptions(companyId: string) {
  return (await listLeadSources(companyId)).filter((s) => s.isActive).map((s) => ({ value: s.id, label: s.name }));
}
async function assertActiveSource(companyId: string, id: string | undefined) {
  if (!id) return null;
  const s = (await listLeadSources(companyId)).find((x) => x.id === id);
  if (!s || !s.isActive) throw new BusinessRuleError("VALIDATION_ERROR", "Choose an active source.", { fieldErrors: { sourceId: "Not an active source." } });
  return s.name;
}

/** "Field → value" summary of an update patch, with ids shown by name. */
function patchSummary(patch: Record<string, unknown>, names: Record<string, string> = {}, labels: Record<string, string> = {}) {
  return Object.entries(patch)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${labels[k] ?? k} → ${names[k] ?? String(v)}`)
    .join(", ");
}

/** Generic "update fields" executor: compares, then calls the entity's update service with the current version. */
function updateExecutor<P extends Record<string, unknown>>(entityType: CrmBulkEntityKey, current: (id: string) => Promise<Record<string, unknown> | null>, update: (actor: BulkActor, id: string, raw: unknown) => Promise<unknown>, toInput: (p: P) => Record<string, unknown>) {
  return async (ctx: BulkItemContext<P>): Promise<BulkItemOutcome> => {
    const s = await requireState(ctx, entityType);
    if (s.archivedAt) return skipped("Archived — restore it first.");
    const input = toInput(ctx.params);
    const now = (await current(ctx.item.entityId)) ?? {};
    const changes = Object.fromEntries(Object.entries(input).filter(([k, v]) => v !== undefined && String(now[k] ?? "") !== String(v)));
    if (!Object.keys(changes).length) return skipped("Already has these values.");
    await update(ctx.actor, ctx.item.entityId, { ...changes, version: s.version });
    return done(`Updated: ${Object.keys(changes).join(", ")}.`);
  };
}

const dayKey = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

function leadActions(): BulkActionDefinition<never>[] {
  const status: BulkActionDefinition<z.infer<typeof leadStatusSchema>> = {
    key: "lead.change_status",
    entityType: "LEAD",
    kind: "status",
    label: "Change status",
    description: "Move the selected leads to another status. Converted leads are skipped; converting needs the Convert step.",
    permissions: [PERM.edit],
    paramsSchema: leadStatusSchema,
    fields: async (actor) => [{ key: "statusId", label: "New status", type: "select", required: true, options: (await listLeadStatuses(actor.companyId)).filter((s) => s.isActive && s.kind !== "CONVERTED").map((s) => ({ value: s.id, label: s.name })) }],
    confirmation: "confirm",
    retrySafe: true,
    cancellable: true,
    maxItems: MAX_MUTATION,
    prepare: async (actor, p) => {
      const st = (await listLeadStatuses(actor.companyId)).find((s) => s.id === p.statusId);
      if (!st || !st.isActive) throw new BusinessRuleError("VALIDATION_ERROR", "Choose an active status.", { fieldErrors: { statusId: "Not an active status." } });
      if (st.kind === "CONVERTED") throw new BusinessRuleError("VALIDATION_ERROR", "Use Convert to mark leads as converted.", { fieldErrors: { statusId: "Use Convert instead." } });
      return { params: p, summary: `Status → ${st.name}` };
    },
    executeItem: async (ctx) => {
      const s = await requireState(ctx, "LEAD");
      if (s.archivedAt) return skipped("Archived — restore it first.");
      if (s.convertedAt) return skipped("Already converted.");
      if (s.statusId === ctx.params.statusId) return skipped("Already in this status.");
      await changeLeadStatus(ctx.actor, ctx.item.entityId, { statusId: ctx.params.statusId });
      return done();
    },
  };

  const update: BulkActionDefinition<z.infer<typeof leadUpdateSchema>> = {
    key: "lead.update_fields",
    entityType: "LEAD",
    kind: "update",
    label: "Update fields",
    description: "Set temperature, score, source or next follow-up date on the selected leads. Fields left empty are not changed.",
    permissions: [PERM.edit],
    paramsSchema: leadUpdateSchema,
    fields: async (actor) => [
      { key: "temperature", label: "Temperature", type: "select", options: [{ value: "HOT", label: "Hot" }, { value: "WARM", label: "Warm" }, { value: "COLD", label: "Cold" }], placeholder: "Leave as is" },
      { key: "score", label: "Score (0–100)", type: "number", min: 0, max: 100 },
      { key: "sourceId", label: "Source", type: "select", options: await sourceOptions(actor.companyId), placeholder: "Leave as is" },
      { key: "nextFollowUpAt", label: "Next follow-up", type: "date" },
    ],
    confirmation: "confirm",
    retrySafe: true,
    cancellable: true,
    maxItems: MAX_MUTATION,
    prepare: async (actor, p) => {
      const source = await assertActiveSource(actor.companyId, p.sourceId);
      return { params: p, summary: patchSummary(p, source ? { sourceId: source } : {}, { temperature: "Temperature", score: "Score", sourceId: "Source", nextFollowUpAt: "Next follow-up" }) };
    },
    executeItem: updateExecutor(
      "LEAD",
      async (id) => {
        const r = await prisma.crmLead.findUnique({ where: { id }, select: { temperature: true, score: true, sourceId: true, nextFollowUpAt: true } });
        return r ? { ...r, nextFollowUpAt: r.nextFollowUpAt ? r.nextFollowUpAt.toISOString() : null } : null;
      },
      updateLead,
      (p) => ({ temperature: p.temperature, score: p.score, sourceId: p.sourceId, nextFollowUpAt: p.nextFollowUpAt ? new Date(`${p.nextFollowUpAt}T09:00:00.000Z`).toISOString() : undefined })
    ),
  };
  return [status, update] as unknown as BulkActionDefinition<never>[];
}

function contactActions(): BulkActionDefinition<never>[] {
  const update: BulkActionDefinition<z.infer<typeof contactUpdateSchema>> = {
    key: "contact.update_fields",
    entityType: "CONTACT",
    kind: "update",
    label: "Update fields",
    description: "Set designation, department or source on the selected contacts. Fields left empty are not changed.",
    permissions: [PERM.edit],
    paramsSchema: contactUpdateSchema,
    fields: async (actor) => [
      { key: "designation", label: "Designation", type: "text", maxLength: 100 },
      { key: "department", label: "Department", type: "text", maxLength: 100 },
      { key: "sourceId", label: "Source", type: "select", options: await sourceOptions(actor.companyId), placeholder: "Leave as is" },
    ],
    confirmation: "confirm",
    retrySafe: true,
    cancellable: true,
    maxItems: MAX_MUTATION,
    prepare: async (actor, p) => {
      const source = await assertActiveSource(actor.companyId, p.sourceId);
      return { params: p, summary: patchSummary(p, source ? { sourceId: source } : {}, { designation: "Designation", department: "Department", sourceId: "Source" }) };
    },
    executeItem: updateExecutor("CONTACT", (id) => prisma.crmContact.findUnique({ where: { id }, select: { designation: true, department: true, sourceId: true } }), updateContact, (p) => ({ ...p })),
  };
  return [update] as unknown as BulkActionDefinition<never>[];
}

function companyActions(): BulkActionDefinition<never>[] {
  const status: BulkActionDefinition<z.infer<typeof companyStatusSchema>> = {
    key: "company.change_status",
    entityType: "COMPANY",
    kind: "status",
    label: "Change status",
    description: "Move the selected companies to another status.",
    permissions: [PERM.edit],
    paramsSchema: companyStatusSchema,
    fields: async (actor) => [{ key: "statusId", label: "New status", type: "select", required: true, options: (await listCompanyStatuses(actor.companyId)).filter((s) => s.isActive).map((s) => ({ value: s.id, label: s.name })) }],
    confirmation: "confirm",
    retrySafe: true,
    cancellable: true,
    maxItems: MAX_MUTATION,
    prepare: async (actor, p) => {
      const st = (await listCompanyStatuses(actor.companyId)).find((s) => s.id === p.statusId);
      if (!st || !st.isActive) throw new BusinessRuleError("VALIDATION_ERROR", "Choose an active status.", { fieldErrors: { statusId: "Not an active status." } });
      return { params: p, summary: `Status → ${st.name}` };
    },
    executeItem: async (ctx) => {
      const s = await requireState(ctx, "COMPANY");
      if (s.archivedAt) return skipped("Archived — restore it first.");
      if (s.statusId === ctx.params.statusId) return skipped("Already in this status.");
      await changeCompanyStatus(ctx.actor, ctx.item.entityId, { statusId: ctx.params.statusId });
      return done();
    },
  };
  const update: BulkActionDefinition<z.infer<typeof companyUpdateSchema>> = {
    key: "company.update_fields",
    entityType: "COMPANY",
    kind: "update",
    label: "Update fields",
    description: "Set industry, company type or source on the selected companies. Fields left empty are not changed.",
    permissions: [PERM.edit],
    paramsSchema: companyUpdateSchema,
    fields: async (actor) => [
      { key: "industry", label: "Industry", type: "text", maxLength: 100 },
      { key: "companyType", label: "Company type", type: "text", maxLength: 100 },
      { key: "sourceId", label: "Source", type: "select", options: await sourceOptions(actor.companyId), placeholder: "Leave as is" },
    ],
    confirmation: "confirm",
    retrySafe: true,
    cancellable: true,
    maxItems: MAX_MUTATION,
    prepare: async (actor, p) => {
      const source = await assertActiveSource(actor.companyId, p.sourceId);
      return { params: p, summary: patchSummary(p, source ? { sourceId: source } : {}, { industry: "Industry", companyType: "Type", sourceId: "Source" }) };
    },
    executeItem: updateExecutor("COMPANY", (id) => prisma.crmCompany.findUnique({ where: { id }, select: { industry: true, companyType: true, sourceId: true } }), updateCompany, (p) => ({ ...p })),
  };
  return [status, update] as unknown as BulkActionDefinition<never>[];
}

function opportunityActions(): BulkActionDefinition<never>[] {
  const stage: BulkActionDefinition<z.infer<typeof oppStageSchema>> = {
    key: "opportunity.change_stage",
    entityType: "OPPORTUNITY",
    kind: "stage",
    label: "Move to stage",
    description: "Move the selected opportunities to a stage (possibly in another pipeline). Stage rules and required fields are checked for each one; those that don't qualify fail with the reason.",
    permissions: [PERM.edit],
    paramsSchema: oppStageSchema,
    fields: async (actor) => {
      const pipes = await listPipelines(actor.companyId);
      return [
        {
          key: "stageId",
          label: "Stage",
          type: "select",
          required: true,
          options: pipes.filter((p) => p.status === "ACTIVE").flatMap((p) => p.stages.filter((s) => s.status === "ACTIVE").map((s) => ({ value: s.id, label: s.name, group: p.name }))),
        },
      ];
    },
    confirmation: "confirm",
    retrySafe: true,
    cancellable: true,
    maxItems: MAX_MUTATION,
    prepare: async (actor, p) => {
      const pipes = await listPipelines(actor.companyId);
      const pipe = pipes.find((x) => x.stages.some((s) => s.id === p.stageId));
      const st = pipe?.stages.find((s) => s.id === p.stageId);
      if (!pipe || !st || st.status !== "ACTIVE" || pipe.status !== "ACTIVE") throw new BusinessRuleError("VALIDATION_ERROR", "Choose an active stage.", { fieldErrors: { stageId: "Not an active stage." } });
      return { params: p, summary: `Stage → ${pipe.name} / ${st.name}` };
    },
    executeItem: async (ctx) => {
      const s = await requireState(ctx, "OPPORTUNITY");
      if (s.archivedAt) return skipped("Archived — restore it first.");
      if (s.stageId === ctx.params.stageId) return skipped("Already in this stage.");
      await changeOpportunityStage(ctx.actor, ctx.item.entityId, { stageId: ctx.params.stageId });
      return done();
    },
  };
  const update: BulkActionDefinition<z.infer<typeof oppUpdateSchema>> = {
    key: "opportunity.update_fields",
    entityType: "OPPORTUNITY",
    kind: "update",
    label: "Update fields",
    description: "Set probability or expected close date on the selected opportunities. Fields left empty are not changed. Closed opportunities fail with the reason.",
    permissions: [PERM.edit],
    paramsSchema: oppUpdateSchema,
    fields: async () => [
      { key: "probability", label: "Probability %", type: "number", min: 0, max: 100 },
      { key: "expectedCloseDate", label: "Expected close date", type: "date" },
    ],
    confirmation: "confirm",
    retrySafe: true,
    cancellable: true,
    maxItems: MAX_MUTATION,
    prepare: async (_a, p) => ({ params: p, summary: patchSummary(p, {}, { probability: "Probability", expectedCloseDate: "Expected close" }) }),
    executeItem: updateExecutor(
      "OPPORTUNITY",
      async (id) => {
        const r = await prisma.crmOpportunity.findUnique({ where: { id }, select: { probability: true, expectedCloseDate: true } });
        return r ? { probability: r.probability, expectedCloseDate: dayKey(r.expectedCloseDate) } : null;
      },
      updateOpportunity,
      (p) => ({ ...p })
    ),
  };
  return [stage, update] as unknown as BulkActionDefinition<never>[];
}

// ── Registration ─────────────────────────────────────────────────

let registered = false;

/** Idempotent: registers the CRM's bulk entities and actions once per process. */
export function registerCrmBulkActions() {
  if (registered) return;
  registered = true;
  for (const e of CRM_BULK_ENTITIES) registerEntity(crmBulkEntity(e));
  const specific: Record<CrmBulkEntityKey, BulkActionDefinition<never>[]> = {
    LEAD: [...leadActions(), sendTemplateAction("LEAD") as unknown as BulkActionDefinition<never>],
    CONTACT: [...contactActions(), sendTemplateAction("CONTACT") as unknown as BulkActionDefinition<never>],
    COMPANY: companyActions(),
    OPPORTUNITY: [...opportunityActions(), sendTemplateAction("OPPORTUNITY") as unknown as BulkActionDefinition<never>],
  };
  for (const e of CRM_BULK_ENTITIES) {
    const common = commonActions(e);
    // Order in menus: entity-specific first (status/stage/update), then the common ones.
    for (const def of [...specific[e], ...common]) registerAction(def);
  }
}
