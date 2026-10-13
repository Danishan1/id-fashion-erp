import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/core/db/client";
import type { ChannelType, NormalizedIdentity, OutboundTemplateRef, SendResult } from "@/core/communication/CommunicationProvider";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { logger } from "@/core/logging/logger";
import type { ListQuery } from "@/lib/list-query";
import { assertCaptureRateLimit } from "../capture/capture-rate-limit";
import { channelCapabilities, providerChannel, providerOf } from "../conversations/crm-channels.service";
import { CHANNEL_TYPE_LABELS } from "../conversations/conversation-registry";
import type { CrmActor } from "../core/crm-actor";
import { runCrmMutation, type CrmMutationContext, type CrmSystemActor } from "../core/crm-mutation";
import { emailKey, nameKey, phoneKey } from "../core/crm-normalize";
import { listOptionValues } from "../settings/crm-settings.service";
import { buildTemplateContext } from "./template-context";
import { checkRenderedLengths, extractVariables, renderTemplateContent, renderWithSampleData, smsInfo, validateTemplateContent, type RenderContext, type RenderedTemplate } from "./template-engine";
import {
  SAMPLE_VALUES,
  TEMPLATE_ACTIONS,
  TEMPLATE_CATEGORY_LIST_KEY,
  TEMPLATE_CHANNEL_TYPES,
  TEMPLATE_CHANNELS,
  TEMPLATE_ENTITIES,
  TEMPLATE_ENTITY_KEYS,
  TEMPLATE_STATUSES,
  TEMPLATE_VARIABLES,
  UNAVAILABLE_ENTITIES,
  canApplyTemplateAction,
  isTemplateChannel,
  type TemplateAction,
  type TemplateIssue,
  type TemplateStatus,
} from "./template-registry";
import {
  createTemplateSchema,
  draftContentSchema,
  duplicateTemplateSchema,
  previewStoredSchema,
  restoreVersionSchema,
  templateStatusActionSchema,
  testSendSchema,
  updateTemplateSchema,
  type TemplateFilter,
} from "./template.schema";
import { templateUsage, templateUsageCounts } from "./template-usage";
// Phase 18: workflows using a template count as live references (blocks archiving).
import "../workflows/workflow-template-usage";

/**
 * CRM message templates (Phase 12) — the one service every sender uses:
 * the Inbox composer today, sequences / workflows / reminders later.
 *
 *   Template (crm_message_templates) ── current version ──► immutable versions
 *         │                                                  (crm_message_template_versions)
 *         ▼
 *   renderTemplate(templateId, context) → rendered subject/body + issues
 *         ▼
 *   Conversation service (Phase 11: permissions, DND, capabilities)
 *         ▼
 *   ChannelProvider adapter → provider
 *
 * Rules: content changes always add a version (history is never rewritten;
 * a DB trigger refuses UPDATE/DELETE on versions); only ACTIVE templates can
 * be used to send; ACTIVE templates must stay free of errors; archiving
 * keeps everything (messages keep the version they were written from).
 */

const TABLE = "crm_message_templates";
const VERSIONS = "crm_message_template_versions";

const LIST_SELECT = {
  id: true,
  name: true,
  channelType: true,
  status: true,
  description: true,
  currentVersionNumber: true,
  categoryId: true,
  category: { select: { id: true, value: true, isActive: true } },
  createdByUserId: true,
  updatedByUserId: true,
  createdAt: true,
  updatedAt: true,
  version: true,
} satisfies Prisma.CrmMessageTemplateSelect;

const DETAIL_INCLUDE = {
  category: { select: { id: true, value: true, isActive: true } },
  currentVersion: true,
} satisfies Prisma.CrmMessageTemplateInclude;

type TemplateRow = Prisma.CrmMessageTemplateGetPayload<{ include: typeof DETAIL_INCLUDE }>;
type VersionRow = Prisma.CrmMessageTemplateVersionGetPayload<object>;

export interface TemplateEventPayload {
  schemaVersion: 1;
  templateId: string;
  channelType: string;
  status: string;
  versionNumber: number;
  [k: string]: unknown;
}

const notFound = (id: string) => new BusinessRuleError("NOT_FOUND", "Template not found.", { id });
const conflict = (id: string) => new BusinessRuleError("RECORD_VERSION_CONFLICT", "This template was changed by someone else. Reload it and try again.", { id });
const invalid = (message: string, errors: TemplateIssue[], warnings: TemplateIssue[] = []) => new BusinessRuleError("CRM_TEMPLATE_INVALID", message, { errors, warnings });
const searchTextOf = (name: string, description: string | null) => nameKey(`${name} ${description ?? ""}`);

function payload(t: { id: string; channelType: string; status: string; currentVersionNumber: number }, extra: Record<string, unknown> = {}): TemplateEventPayload {
  return { schemaVersion: 1, templateId: t.id, channelType: t.channelType, status: t.status, versionNumber: t.currentVersionNumber, ...extra };
}

function emitTemplate(ctx: CrmMutationContext, t: { id: string; channelType: string; status: string; currentVersionNumber: number }, eventType: Parameters<CrmMutationContext["emit"]>[0]["eventType"], summary: string, extra: Record<string, unknown> = {}) {
  ctx.emit({ entityType: "TEMPLATE", entityId: t.id, eventType, summary: summary.slice(0, 500), payload: payload(t, extra) });
}

async function userNames(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  if (!unique.length) return new Map();
  const rows = await prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, fullName: true } });
  return new Map(rows.map((r) => [r.id, r.fullName]));
}

async function loadTemplate(companyId: string, id: string, tx: Prisma.TransactionClient = prisma): Promise<TemplateRow> {
  const row = await tx.crmMessageTemplate.findFirst({ where: { id, companyId }, include: DETAIL_INCLUDE });
  if (!row) throw notFound(id);
  return row;
}

async function assertCategory(companyId: string, categoryId: string | null, keepId?: string | null) {
  if (!categoryId) return;
  const cat = await prisma.crmOptionValue.findFirst({ where: { id: categoryId, companyId, listKey: TEMPLATE_CATEGORY_LIST_KEY }, select: { isActive: true } });
  if (!cat) throw new BusinessRuleError("VALIDATION_ERROR", "Choose a template category from the list.", { fieldErrors: { categoryId: "Unknown category." } });
  if (!cat.isActive && categoryId !== keepId) throw new BusinessRuleError("VALIDATION_ERROR", "That category is archived. Choose another one.", { fieldErrors: { categoryId: "Archived category." } });
}

async function assertUniqueName(companyId: string, name: string, exceptId?: string) {
  const clash = await prisma.crmMessageTemplate.findFirst({ where: { companyId, nameKey: nameKey(name), status: { not: "ARCHIVED" }, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { id: true } });
  if (clash) throw new BusinessRuleError("VALIDATION_ERROR", `A template called "${name}" already exists.`, { fieldErrors: { name: "Name already used." } });
}

function isUniqueViolation(e: unknown) {
  return (e as { code?: string })?.code === "P2002";
}

function nameClash(name: string) {
  return new BusinessRuleError("VALIDATION_ERROR", `A template called "${name}" already exists.`, { fieldErrors: { name: "Name already used." } });
}

/** Must the content be error-free? ACTIVE templates always; drafts may be saved with errors. */
function assertContentValid(status: string, channelType: string, content: { subject: string | null; body: string; providerMetadata: Record<string, string> }) {
  const v = validateTemplateContent({ channelType, ...content });
  if (status === "ACTIVE" && !v.valid) throw invalid("Fix the template's errors first — an active template must be ready to send.", v.errors, v.warnings);
  // Even drafts can't store an unusable channel or provider setting.
  const hard = v.errors.filter((e) => e.code === "INVALID_CHANNEL" || e.code === "INVALID_PROVIDER_FIELD" || e.code === "SUBJECT_NOT_ALLOWED");
  if (hard.length) throw invalid(hard[0].message, hard, []);
  return v;
}

const contentOf = (v: Pick<VersionRow, "subject" | "body" | "providerMetadata">) => ({ subject: v.subject, body: v.body, providerMetadata: (v.providerMetadata ?? {}) as Record<string, string> });

function sameContent(a: { subject: string | null; body: string; providerMetadata: Record<string, string> }, b: { subject: string | null; body: string; providerMetadata: Record<string, string> }) {
  const norm = (m: Record<string, string>) => JSON.stringify(Object.entries(m).sort());
  return (a.subject ?? null) === (b.subject ?? null) && a.body === b.body && norm(a.providerMetadata) === norm(b.providerMetadata);
}

async function createVersion(ctx: CrmMutationContext, actor: CrmActor, t: { id: string; companyId: string }, number: number, content: { subject: string | null; body: string; providerMetadata: Record<string, string> }, changeNote: string | null, restoredFromId: string | null = null) {
  const version = await ctx.tx.crmMessageTemplateVersion.create({
    data: {
      companyId: t.companyId,
      templateId: t.id,
      versionNumber: number,
      subject: content.subject,
      body: content.body,
      variables: extractVariables(content.subject, content.body),
      providerMetadata: content.providerMetadata,
      changeNote,
      restoredFromId,
      createdByUserId: actor.userId,
    },
  });
  await ctx.audit({ tableName: VERSIONS, recordId: version.id, action: "CREATE", newValues: { templateId: t.id, versionNumber: number, subject: content.subject, body: content.body, providerMetadata: content.providerMetadata, changeNote, restoredFromId } });
  return version;
}

// ── Presenters ───────────────────────────────────────────────────

function presentVersion(v: VersionRow, names: Map<string, string>, extra: { usageCount?: number; restoredFromNumber?: number | null } = {}) {
  return {
    id: v.id,
    templateId: v.templateId,
    versionNumber: v.versionNumber,
    subject: v.subject,
    body: v.body,
    variables: v.variables,
    providerMetadata: (v.providerMetadata ?? {}) as Record<string, string>,
    changeNote: v.changeNote,
    restoredFromId: v.restoredFromId,
    restoredFromNumber: extra.restoredFromNumber ?? null,
    createdBy: { id: v.createdByUserId, name: names.get(v.createdByUserId) ?? null },
    createdAt: v.createdAt,
    usageCount: extra.usageCount ?? 0,
  };
}
export type TemplateVersionDto = ReturnType<typeof presentVersion>;

function presentListRow(t: Prisma.CrmMessageTemplateGetPayload<{ select: typeof LIST_SELECT }>, names: Map<string, string>, usage: Map<string, number>) {
  return {
    id: t.id,
    name: t.name,
    channelType: t.channelType,
    channelLabel: CHANNEL_TYPE_LABELS[t.channelType as ChannelType] ?? t.channelType,
    status: t.status as TemplateStatus,
    description: t.description,
    category: t.category ? { id: t.category.id, name: t.category.value, archived: !t.category.isActive } : null,
    currentVersionNumber: t.currentVersionNumber,
    usageCount: usage.get(t.id) ?? 0,
    createdBy: { id: t.createdByUserId, name: names.get(t.createdByUserId) ?? null },
    updatedBy: t.updatedByUserId ? { id: t.updatedByUserId, name: names.get(t.updatedByUserId) ?? null } : { id: t.createdByUserId, name: names.get(t.createdByUserId) ?? null },
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    version: t.version,
  };
}
export type TemplateListRow = ReturnType<typeof presentListRow>;

// ── Meta ─────────────────────────────────────────────────────────

/** Everything the editor / list need: channels, statuses, variables (grouped), categories, test channels. */
export async function templateMeta(actor: CrmActor) {
  const [options, channels] = await Promise.all([
    listOptionValues(actor.companyId),
    prisma.crmChannel.findMany({ where: { companyId: actor.companyId, channelType: { in: TEMPLATE_CHANNEL_TYPES } }, select: { id: true, name: true, channelType: true, provider: true, status: true, config: true }, orderBy: { name: "asc" } }),
  ]);
  const categories = options.filter((o) => o.listKey === TEMPLATE_CATEGORY_LIST_KEY).sort((a, b) => a.sortOrder - b.sortOrder || a.value.localeCompare(b.value));
  return {
    channels: TEMPLATE_CHANNEL_TYPES.map((key) => ({ key, ...TEMPLATE_CHANNELS[key] })),
    statuses: Object.entries(TEMPLATE_STATUSES).map(([key, s]) => ({ key, ...s })),
    actions: TEMPLATE_ACTIONS,
    entities: TEMPLATE_ENTITY_KEYS.map((key) => ({ key, label: TEMPLATE_ENTITIES[key].label, variables: TEMPLATE_VARIABLES.filter((v) => v.entity === key).map(({ key: k, label, sample }) => ({ key: k, label, sample })) })),
    unavailable: Object.entries(UNAVAILABLE_ENTITIES).map(([key, reason]) => ({ key, reason })),
    categories: categories.map((c) => ({ id: c.id, name: c.value, archived: !c.isActive, sortOrder: c.sortOrder })),
    categoryListKey: TEMPLATE_CATEGORY_LIST_KEY,
    // Channels a test can go through (same provider adapters the Inbox uses).
    testChannels: channels.map((c) => {
      const caps = channelCapabilities(c);
      return { id: c.id, name: c.name, channelType: c.channelType, canSend: caps.canSend, reason: caps.canSend ? null : caps.sendUnavailableReason };
    }),
  };
}

// ── List / read ──────────────────────────────────────────────────

export async function listTemplates(actor: CrmActor, filter: TemplateFilter, sort: { sortBy: string; sortOrder: "asc" | "desc" }, query: Pick<ListQuery, "skip" | "take" | "search">) {
  const and: Prisma.CrmMessageTemplateWhereInput[] = [{ companyId: actor.companyId }];
  if (filter.usable) and.push({ status: "ACTIVE" });
  else if (filter.statuses.length) and.push({ status: { in: filter.statuses } });
  else and.push({ status: { not: "ARCHIVED" } });
  if (filter.channels.length) and.push({ channelType: { in: filter.channels } });
  if (filter.categoryIds.length) and.push({ categoryId: { in: filter.categoryIds } });
  const term = query.search?.trim();
  if (term) {
    const key = nameKey(term);
    and.push({ OR: [{ searchText: { contains: key } }, { currentVersion: { is: { body: { contains: term, mode: "insensitive" } } } }, { currentVersion: { is: { subject: { contains: term, mode: "insensitive" } } } }] });
  }
  const where: Prisma.CrmMessageTemplateWhereInput = { AND: and };
  const orderBy: Prisma.CrmMessageTemplateOrderByWithRelationInput[] = [{ [sort.sortBy]: sort.sortOrder }, { id: "asc" }];
  const [rows, totalCount] = await Promise.all([prisma.crmMessageTemplate.findMany({ where, select: LIST_SELECT, orderBy, skip: query.skip, take: query.take }), prisma.crmMessageTemplate.count({ where })]);
  const [names, usage] = await Promise.all([
    userNames(rows.flatMap((r) => [r.createdByUserId, r.updatedByUserId])),
    templateUsageCounts(
      actor.companyId,
      rows.map((r) => r.id)
    ),
  ]);
  return { data: rows.map((r) => presentListRow(r, names, usage)), totalCount };
}

export async function getTemplate(actor: CrmActor, id: string) {
  const t = await loadTemplate(actor.companyId, id);
  const [usage, versionCount, duplicatedFrom] = await Promise.all([
    templateUsage(actor.companyId, id),
    prisma.crmMessageTemplateVersion.count({ where: { templateId: id } }),
    t.duplicatedFromId ? prisma.crmMessageTemplate.findFirst({ where: { id: t.duplicatedFromId, companyId: actor.companyId }, select: { id: true, name: true } }) : null,
  ]);
  const names = await userNames([t.createdByUserId, t.updatedByUserId, t.activatedByUserId, t.archivedByUserId, t.currentVersion?.createdByUserId]);
  const current = t.currentVersion;
  const validation = current ? validateTemplateContent({ channelType: t.channelType, ...contentOf(current) }) : null;
  return {
    id: t.id,
    name: t.name,
    channelType: t.channelType,
    channelLabel: CHANNEL_TYPE_LABELS[t.channelType as ChannelType] ?? t.channelType,
    status: t.status as TemplateStatus,
    description: t.description,
    category: t.category ? { id: t.category.id, name: t.category.value, archived: !t.category.isActive } : null,
    currentVersion: current ? presentVersion(current, names, { usageCount: usage.reduce((s, u) => s + (u.byVersion[current.versionNumber] ?? 0), 0) }) : null,
    currentVersionNumber: t.currentVersionNumber,
    versionCount,
    validation,
    usage,
    usageCount: usage.reduce((s, u) => s + u.count, 0),
    lastUsedAt: usage.reduce<Date | null>((max, u) => (u.lastUsedAt && (!max || u.lastUsedAt > max) ? u.lastUsedAt : max), null),
    duplicatedFrom,
    createdBy: { id: t.createdByUserId, name: names.get(t.createdByUserId) ?? null },
    updatedBy: t.updatedByUserId ? { id: t.updatedByUserId, name: names.get(t.updatedByUserId) ?? null } : null,
    activatedAt: t.activatedAt,
    activatedBy: t.activatedByUserId ? { id: t.activatedByUserId, name: names.get(t.activatedByUserId) ?? null } : null,
    archivedAt: t.archivedAt,
    archivedBy: t.archivedByUserId ? { id: t.archivedByUserId, name: names.get(t.archivedByUserId) ?? null } : null,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    version: t.version,
  };
}
export type TemplateDetailDto = Awaited<ReturnType<typeof getTemplate>>;

// ── Create / update / duplicate ──────────────────────────────────

export async function createTemplate(actor: CrmActor, raw: unknown) {
  const input = createTemplateSchema.parse(raw);
  if (!isTemplateChannel(input.channelType)) throw invalid(`${CHANNEL_TYPE_LABELS[input.channelType]} templates aren't supported yet.`, [{ code: "INVALID_CHANNEL", severity: "error", source: "template", message: "Choose Email, SMS or WhatsApp.", field: "channelType" }]);
  await assertCategory(actor.companyId, input.categoryId);
  await assertUniqueName(actor.companyId, input.name);
  const content = { subject: input.subject ?? null, body: input.body, providerMetadata: input.providerMetadata };
  assertContentValid("DRAFT", input.channelType, content);
  try {
    return await runCrmMutation(actor, async (ctx) => {
      const t = await ctx.tx.crmMessageTemplate.create({
        data: { companyId: actor.companyId, name: input.name, nameKey: nameKey(input.name), channelType: input.channelType, categoryId: input.categoryId, description: input.description, status: "DRAFT", searchText: searchTextOf(input.name, input.description ?? null), createdByUserId: actor.userId },
      });
      const v = await createVersion(ctx, actor, t, 1, content, input.changeNote ?? "First version");
      const after = await ctx.tx.crmMessageTemplate.update({ where: { id: t.id }, data: { currentVersionId: v.id, currentVersionNumber: 1 } });
      await ctx.audit({ tableName: TABLE, recordId: t.id, action: "CREATE", newValues: { name: t.name, channelType: t.channelType, categoryId: t.categoryId, status: "DRAFT", versionNumber: 1 } });
      emitTemplate(ctx, after, "template.created", `${after.name} (${CHANNEL_TYPE_LABELS[after.channelType as ChannelType]})`);
      return { id: t.id };
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw nameClash(input.name);
    throw e;
  }
}

/**
 * Details (name, category, description) change in place, with an audit row.
 * Content (subject, body, provider settings) never changes in place: it adds
 * version N+1 and makes it current. An ACTIVE template's new version must be
 * error-free. Archived templates are read-only (restore first).
 */
export async function updateTemplate(actor: CrmActor, id: string, raw: unknown) {
  const input = updateTemplateSchema.parse(raw);
  const t = await loadTemplate(actor.companyId, id);
  if (t.version !== input.version) throw conflict(id);
  if (t.status === "ARCHIVED") throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This template is archived. Restore it before editing.", { status: t.status });
  const name = input.name ?? t.name;
  if (input.name !== undefined && nameKey(input.name) !== t.nameKey) await assertUniqueName(actor.companyId, input.name, id);
  if (input.categoryId !== undefined) await assertCategory(actor.companyId, input.categoryId, t.categoryId);
  const before = t.currentVersion ? contentOf(t.currentVersion) : { subject: null, body: "", providerMetadata: {} };
  const next = {
    subject: input.subject !== undefined ? input.subject : before.subject,
    body: input.body ?? before.body,
    providerMetadata: input.providerMetadata ?? before.providerMetadata,
  };
  const contentChanged = !sameContent(before, next);
  if (contentChanged) assertContentValid(t.status, t.channelType, next);
  const details: Prisma.CrmMessageTemplateUncheckedUpdateManyInput = {};
  if (input.name !== undefined && input.name !== t.name) Object.assign(details, { name: input.name, nameKey: nameKey(input.name) });
  if (input.categoryId !== undefined && input.categoryId !== t.categoryId) details.categoryId = input.categoryId;
  if (input.description !== undefined && input.description !== t.description) details.description = input.description;
  if (!contentChanged && !Object.keys(details).length) return { id, versionCreated: false, versionNumber: t.currentVersionNumber };
  try {
    return await runCrmMutation(actor, async (ctx) => {
      const number = t.currentVersionNumber + (contentChanged ? 1 : 0);
      const { count } = await ctx.tx.crmMessageTemplate.updateMany({
        where: { id, version: input.version },
        data: { ...details, searchText: searchTextOf(name, details.description !== undefined ? (details.description as string | null) : t.description), updatedByUserId: actor.userId, version: { increment: 1 } },
      });
      if (!count) throw conflict(id);
      if (Object.keys(details).length) {
        await ctx.audit({ tableName: TABLE, recordId: id, action: "UPDATE", oldValues: Object.fromEntries(Object.keys(details).map((k) => [k, (t as Record<string, unknown>)[k]])), newValues: details as Record<string, unknown> });
      }
      let after = await ctx.tx.crmMessageTemplate.findUniqueOrThrow({ where: { id } });
      if (Object.keys(details).length) emitTemplate(ctx, after, "template.updated", Object.keys(details).filter((k) => k !== "nameKey").map((k) => (k === "categoryId" ? "category" : k)).join(", ") + " changed", { fields: Object.keys(details).filter((k) => k !== "nameKey") });
      if (contentChanged) {
        const v = await createVersion(ctx, actor, t, number, next, input.changeNote ?? null);
        after = await ctx.tx.crmMessageTemplate.update({ where: { id }, data: { currentVersionId: v.id, currentVersionNumber: number } });
        await ctx.audit({ tableName: TABLE, recordId: id, action: "UPDATE", oldValues: { currentVersionNumber: t.currentVersionNumber }, newValues: { event: "template.version_created", currentVersionNumber: number, changeNote: input.changeNote } });
        emitTemplate(ctx, after, "template.version_created", `Version ${number}${input.changeNote ? ` — ${input.changeNote}` : ""}`, { versionId: v.id, previousVersionNumber: t.currentVersionNumber });
      }
      return { id, versionCreated: contentChanged, versionNumber: number };
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw nameClash(name);
    throw e;
  }
}

/** A new DRAFT template (own id, own history starting at version 1) with the source's current content. */
export async function duplicateTemplate(actor: CrmActor, id: string, raw: unknown) {
  const input = duplicateTemplateSchema.parse(raw ?? {});
  const source = await loadTemplate(actor.companyId, id);
  if (!source.currentVersion) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This template has no content to copy.");
  let name = input.name ?? `${source.name} (copy)`;
  if (!input.name) {
    for (let n = 2; await prisma.crmMessageTemplate.findFirst({ where: { companyId: actor.companyId, nameKey: nameKey(name), status: { not: "ARCHIVED" } }, select: { id: true } }); n++) name = `${source.name} (copy ${n})`;
  } else await assertUniqueName(actor.companyId, name);
  const keepCategory = source.category?.isActive ? source.categoryId : null;
  try {
    return await runCrmMutation(actor, async (ctx) => {
      const t = await ctx.tx.crmMessageTemplate.create({
        data: { companyId: actor.companyId, name, nameKey: nameKey(name), channelType: source.channelType, categoryId: keepCategory, description: source.description, status: "DRAFT", searchText: searchTextOf(name, source.description), duplicatedFromId: source.id, createdByUserId: actor.userId },
      });
      const v = await createVersion(ctx, actor, t, 1, contentOf(source.currentVersion!), `Copied from "${source.name}" version ${source.currentVersionNumber}`);
      const after = await ctx.tx.crmMessageTemplate.update({ where: { id: t.id }, data: { currentVersionId: v.id, currentVersionNumber: 1 } });
      await ctx.audit({ tableName: TABLE, recordId: t.id, action: "CREATE", newValues: { event: "template.duplicated", name, duplicatedFromId: source.id, duplicatedFromVersion: source.currentVersionNumber } });
      emitTemplate(ctx, after, "template.created", `${name} — copied from "${source.name}"`, { duplicatedFromId: source.id });
      emitTemplate(ctx, source, "template.duplicated", `Copied to "${name}"`, { duplicateId: t.id });
      return { id: t.id };
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw nameClash(name);
    throw e;
  }
}

// ── Lifecycle ────────────────────────────────────────────────────

const ACTION_EVENT = { activate: "template.activated", deactivate: "template.deactivated", archive: "template.archived", restore: "template.restored" } as const;

export async function changeTemplateStatus(actor: CrmActor, id: string, action: TemplateAction, raw: unknown) {
  const input = templateStatusActionSchema.parse(raw);
  const t = await loadTemplate(actor.companyId, id);
  if (t.version !== input.version) throw conflict(id);
  if (!canApplyTemplateAction(t.status, action)) {
    const msg = { activate: "Only a draft template can be activated.", deactivate: "Only an active template can be deactivated.", archive: "This template is already archived.", restore: "Only an archived template can be restored." }[action];
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", msg, { status: t.status });
  }
  if (action === "activate") {
    if (!t.currentVersion) throw invalid("Write the template before activating it.", []);
    const v = validateTemplateContent({ channelType: t.channelType, ...contentOf(t.currentVersion) });
    if (!v.valid) throw invalid("Fix the template's errors before activating it.", v.errors, v.warnings);
  }
  if (action === "archive") {
    const live = (await templateUsage(actor.companyId, id)).flatMap((u) => u.activeReferences.map((r) => ({ ...r, usage: u.label })));
    if (live.length) throw new BusinessRuleError("REFERENCED_RECORD_IN_USE", `This template is used by ${live.length} active automation${live.length === 1 ? "" : "s"}. Stop using it there first.`, { references: live });
  }
  if (action === "restore") await assertUniqueName(actor.companyId, t.name, id);
  const to = TEMPLATE_ACTIONS[action].to;
  const now = new Date();
  try {
    return await runCrmMutation(actor, async (ctx) => {
      const data: Prisma.CrmMessageTemplateUncheckedUpdateManyInput = { status: to, updatedByUserId: actor.userId, version: { increment: 1 } };
      if (action === "activate") Object.assign(data, { activatedAt: now, activatedByUserId: actor.userId });
      if (action === "archive") Object.assign(data, { archivedAt: now, archivedByUserId: actor.userId });
      if (action === "restore") Object.assign(data, { archivedAt: null, archivedByUserId: null });
      const { count } = await ctx.tx.crmMessageTemplate.updateMany({ where: { id, version: input.version, status: t.status }, data });
      if (!count) throw conflict(id);
      const after = await ctx.tx.crmMessageTemplate.findUniqueOrThrow({ where: { id } });
      await ctx.audit({ tableName: TABLE, recordId: id, action: "UPDATE", oldValues: { status: t.status }, newValues: { event: ACTION_EVENT[action], status: to } });
      emitTemplate(ctx, after, ACTION_EVENT[action], `${TEMPLATE_STATUSES[t.status as TemplateStatus].label} → ${TEMPLATE_STATUSES[to].label}`, { from: t.status, to });
      return { id, status: to };
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw nameClash(t.name);
    throw e;
  }
}

// ── Versions ─────────────────────────────────────────────────────

/** Version history, newest first (content included — templates are small). */
export async function listTemplateVersions(actor: CrmActor, id: string) {
  const t = await loadTemplate(actor.companyId, id);
  const [versions, usage] = await Promise.all([prisma.crmMessageTemplateVersion.findMany({ where: { templateId: t.id }, orderBy: { versionNumber: "desc" } }), templateUsage(actor.companyId, id)]);
  const names = await userNames(versions.map((v) => v.createdByUserId));
  const numberOf = new Map(versions.map((v) => [v.id, v.versionNumber]));
  return versions.map((v) => ({
    ...presentVersion(v, names, { usageCount: usage.reduce((s, u) => s + (u.byVersion[v.versionNumber] ?? 0), 0), restoredFromNumber: v.restoredFromId ? (numberOf.get(v.restoredFromId) ?? null) : null }),
    isCurrent: v.id === t.currentVersionId,
  }));
}

export async function getTemplateVersion(actor: CrmActor, id: string, versionId: string) {
  const t = await loadTemplate(actor.companyId, id);
  const v = await prisma.crmMessageTemplateVersion.findFirst({ where: { id: versionId, templateId: t.id } });
  if (!v) throw new BusinessRuleError("NOT_FOUND", "Version not found.", { id: versionId });
  const names = await userNames([v.createdByUserId]);
  const restored = v.restoredFromId ? await prisma.crmMessageTemplateVersion.findFirst({ where: { id: v.restoredFromId }, select: { versionNumber: true } }) : null;
  return { ...presentVersion(v, names, { restoredFromNumber: restored?.versionNumber ?? null }), isCurrent: v.id === t.currentVersionId, validation: validateTemplateContent({ channelType: t.channelType, ...contentOf(v) }) };
}

/** Restoring copies an old version into a NEW version (history is never rewritten). */
export async function restoreTemplateVersion(actor: CrmActor, id: string, versionId: string, raw: unknown) {
  const input = restoreVersionSchema.parse(raw);
  const t = await loadTemplate(actor.companyId, id);
  if (t.version !== input.version) throw conflict(id);
  if (t.status === "ARCHIVED") throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This template is archived. Restore the template before restoring a version.");
  const old = await prisma.crmMessageTemplateVersion.findFirst({ where: { id: versionId, templateId: t.id } });
  if (!old) throw new BusinessRuleError("NOT_FOUND", "Version not found.", { id: versionId });
  if (old.id === t.currentVersionId) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "That's already the current version.");
  assertContentValid(t.status, t.channelType, contentOf(old));
  return runCrmMutation(actor, async (ctx) => {
    const number = t.currentVersionNumber + 1;
    const { count } = await ctx.tx.crmMessageTemplate.updateMany({ where: { id, version: input.version }, data: { updatedByUserId: actor.userId, version: { increment: 1 } } });
    if (!count) throw conflict(id);
    const note = input.changeNote ?? `Restored version ${old.versionNumber}`;
    const v = await createVersion(ctx, actor, t, number, contentOf(old), note, old.id);
    const after = await ctx.tx.crmMessageTemplate.update({ where: { id }, data: { currentVersionId: v.id, currentVersionNumber: number } });
    await ctx.audit({ tableName: TABLE, recordId: id, action: "UPDATE", oldValues: { currentVersionNumber: t.currentVersionNumber }, newValues: { event: "template.version_restored", currentVersionNumber: number, restoredFromVersion: old.versionNumber } });
    emitTemplate(ctx, after, "template.version_restored", `Version ${old.versionNumber} restored as version ${number}`, { versionId: v.id, restoredFromVersionId: old.id, restoredFromVersionNumber: old.versionNumber });
    return { id, versionNumber: number, versionId: v.id };
  });
}

// ── Rendering (the reusable contract) ────────────────────────────

/** Context for rendering: built-in sample values, CRM record ids, or ready-made values (automation). */
export type TemplateRenderContextInput = { sample: true } | { refs: unknown } | { values: Record<string, string | null>; entities: (keyof typeof TEMPLATE_ENTITIES)[] };

async function resolveContext(actor: CrmActor | CrmSystemActor, input: TemplateRenderContextInput): Promise<RenderContext> {
  if ("sample" in input) return { values: SAMPLE_VALUES, available: "all" };
  if ("values" in input) return { values: input.values, available: new Set(input.entities) };
  return buildTemplateContext(actor, input.refs);
}

/** Provider-level issues from the channel's adapter (if it implements validateTemplate). */
async function providerIssues(companyId: string, channelId: string | undefined, channelType: string, rendered: { subject: string | null; body: string }, providerMetadata: Record<string, string>, variables: string[]): Promise<TemplateIssue[]> {
  if (!channelId) return [];
  const ch = await prisma.crmChannel.findFirst({ where: { id: channelId, companyId }, select: { id: true, provider: true, channelType: true, config: true } });
  if (!ch) throw new BusinessRuleError("NOT_FOUND", "Channel not found.", { id: channelId });
  if (ch.channelType !== channelType) return [{ code: "CHANNEL_MISMATCH", severity: "error", source: "template", message: `This is a ${CHANNEL_TYPE_LABELS[channelType as ChannelType]} template; that channel is ${CHANNEL_TYPE_LABELS[ch.channelType as ChannelType]}.`, field: "channelType" }];
  const provider = providerOf(ch);
  const found = provider.validateTemplate?.({ channelType: ch.channelType as ChannelType, config: (ch.config ?? {}) as Record<string, unknown> }, { channelType: ch.channelType as ChannelType, subject: rendered.subject, body: rendered.body, providerMetadata, variables }) ?? [];
  return found.map((i) => ({ code: i.code, severity: i.severity, source: "provider" as const, message: i.message }));
}

export interface TemplateRenderResult {
  template: { id: string; name: string; channelType: string; status: TemplateStatus };
  version: { id: string; versionNumber: number };
  subject: string | null;
  body: string;
  errors: TemplateIssue[];
  warnings: TemplateIssue[];
  /** True when there are no errors (warnings don't block). */
  ok: boolean;
  parameters: RenderedTemplate["parameters"];
  missing: RenderedTemplate["missing"];
  sms?: ReturnType<typeof smsInfo>;
  providerMetadata: Record<string, string>;
}

function finish(t: { id: string; name: string; channelType: string; status: string }, v: VersionRow, rendered: RenderedTemplate, basis: "sample" | "actual", extra: TemplateIssue[] = []): TemplateRenderResult {
  const content = contentOf(v);
  const structural = validateTemplateContent({ channelType: t.channelType, ...content });
  const subject = TEMPLATE_CHANNELS[t.channelType as ChannelType]?.subject === "required" ? rendered.subject : null;
  // Structural issues (unknown variables…) come from the parser in `rendered` too: keep one copy of each.
  const all = [...structural.errors, ...rendered.issues, ...checkRenderedLengths(t.channelType, { subject, body: rendered.body }, basis), ...extra];
  const seen = new Set<string>();
  const unique = all.filter((i) => {
    const k = `${i.code}|${i.field ?? ""}|${i.variable ?? ""}|${i.message}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  // Length warnings computed on sample data are replaced by the real ones.
  const filtered = basis === "actual" ? unique.filter((i) => !(i.message.includes("with sample data"))) : unique;
  const errors = filtered.filter((i) => i.severity === "error");
  const warnings = filtered.filter((i) => i.severity === "warning");
  return {
    template: { id: t.id, name: t.name, channelType: t.channelType, status: t.status as TemplateStatus },
    version: { id: v.id, versionNumber: v.versionNumber },
    subject,
    body: rendered.body,
    errors,
    warnings,
    ok: errors.length === 0,
    parameters: rendered.parameters,
    missing: rendered.missing,
    ...(TEMPLATE_CHANNELS[t.channelType as ChannelType]?.smsSegments ? { sms: smsInfo(rendered.body) } : {}),
    providerMetadata: content.providerMetadata,
  };
}

/**
 * THE reusable entry point: render a stored template (current version unless
 * `versionId`) against a context. Sequences / workflows / reminders call this
 * with a CrmSystemActor and record ids or ready-made values; the Inbox calls
 * it with the user and the conversation. `requireUsable` refuses DRAFT /
 * ARCHIVED templates (sending); previews pass false.
 */
export async function renderTemplate(actor: CrmActor | CrmSystemActor, templateId: string, context: TemplateRenderContextInput, opts: { versionId?: string; requireUsable?: boolean; channelId?: string } = {}): Promise<TemplateRenderResult> {
  const t = await loadTemplate(actor.companyId, templateId);
  if (opts.requireUsable && t.status !== "ACTIVE") throw new BusinessRuleError("INVALID_STATE_TRANSITION", t.status === "ARCHIVED" ? "This template is archived and can't be used for new messages." : "This template is a draft. Activate it before using it.", { status: t.status });
  const v = opts.versionId ? await prisma.crmMessageTemplateVersion.findFirst({ where: { id: opts.versionId, templateId: t.id } }) : t.currentVersion;
  if (!v) throw new BusinessRuleError("NOT_FOUND", "Version not found.", { id: opts.versionId });
  const ctx = await resolveContext(actor, context);
  const rendered = renderTemplateContent(contentOf(v), ctx);
  const basis = "sample" in context ? "sample" : "actual";
  const prov = await providerIssues(actor.companyId, opts.channelId, t.channelType, { subject: rendered.subject, body: rendered.body }, contentOf(v).providerMetadata, v.variables);
  return finish(t, v, rendered, basis, prov);
}

/** Preview a stored template: sample data by default, or real records the user can see. */
export async function previewTemplate(actor: CrmActor, id: string, raw: unknown) {
  const input = previewStoredSchema.parse(raw ?? {});
  const context: TemplateRenderContextInput = input.context && !input.sample ? { refs: input.context } : { sample: true };
  return renderTemplate(actor, id, context, { versionId: input.versionId, channelId: input.channelId });
}

/** Validate a stored template (CRM rules, plus the provider's rules when a channel is given). */
export async function validateStoredTemplate(actor: CrmActor, id: string, raw: unknown) {
  const input = previewStoredSchema.parse(raw ?? {});
  const r = await renderTemplate(actor, id, { sample: true }, { versionId: input.versionId, channelId: input.channelId });
  const v = await prisma.crmMessageTemplateVersion.findUniqueOrThrow({ where: { id: r.version.id }, select: { variables: true } });
  return { valid: r.ok, errors: r.errors, warnings: r.warnings, variables: v.variables, sms: r.sms, version: r.version };
}

/** Preview / validate unsaved editor content. */
export async function previewDraft(actor: CrmActor, raw: unknown) {
  const parsed = draftContentSchema.parse(raw);
  const input = { ...parsed, subject: parsed.subject ?? null };
  if (input.categoryId) await assertCategory(actor.companyId, input.categoryId, input.categoryId);
  const structural = validateTemplateContent({ channelType: input.channelType, subject: input.subject, body: input.body, providerMetadata: input.providerMetadata });
  const ctx = input.context && !input.sample ? await buildTemplateContext(actor, input.context) : { values: SAMPLE_VALUES, available: "all" as const };
  const isEmail = isTemplateChannel(input.channelType) && TEMPLATE_CHANNELS[input.channelType].subject === "required";
  const rendered = renderTemplateContent({ subject: isEmail ? input.subject : null, body: input.body }, ctx);
  const basis = input.context && !input.sample ? "actual" : "sample";
  const lengths = basis === "actual" ? checkRenderedLengths(input.channelType, rendered, "actual") : [];
  const prov = await providerIssues(actor.companyId, input.channelId, input.channelType, rendered, input.providerMetadata, structural.variables);
  const all = [...structural.errors, ...structural.warnings.filter((w) => basis === "sample" || !w.message.includes("with sample data")), ...rendered.issues.filter((i) => i.code === "NO_VALUE" || i.code === "NO_CONTEXT"), ...lengths, ...prov];
  const errors = all.filter((i) => i.severity === "error");
  return { subject: rendered.subject, body: rendered.body, errors, warnings: all.filter((i) => i.severity === "warning"), ok: errors.length === 0, valid: errors.length === 0, variables: structural.variables, missing: rendered.missing, parameters: rendered.parameters, ...(structural.sms ? { sms: basis === "actual" ? smsInfo(rendered.body) : structural.sms } : {}) };
}

// ── Test send ────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function testRecipient(channelType: string, to: string): NormalizedIdentity {
  if (channelType === "EMAIL") {
    if (!EMAIL_RE.test(to) || !emailKey(to)) throw new BusinessRuleError("VALIDATION_ERROR", "Enter one valid email address.", { fieldErrors: { to: "Invalid email address." } });
    return { kind: "EMAIL", value: to.trim(), displayName: null };
  }
  if (channelType === "SMS" || channelType === "WHATSAPP") {
    const digits = to.replace(/\D/g, "");
    if (/[,;]/.test(to) || digits.length < 8 || digits.length > 15 || !phoneKey(to)) throw new BusinessRuleError("VALIDATION_ERROR", "Enter one phone number with country code, e.g. +91 98100 12345.", { fieldErrors: { to: "Invalid phone number." } });
    return { kind: "PHONE", value: to.trim(), displayName: null };
  }
  return { kind: "PROVIDER_ID", value: to.trim(), displayName: null };
}

export const TEST_SEND_PER_MINUTE = 5;
export const TEST_MARK = "[TEST]";

/**
 * Sends ONE test message to an address the user typed, through the same
 * provider adapter the Inbox uses. It is not a CRM conversation or message
 * (nothing is stored in crm_messages): it's logged as an audit row + a
 * template.test_sent event, and marked as a test — "[TEST]" in the subject
 * (email) or at the start of the text, and `test: true` for the provider.
 * Limited to a few per user per minute; never a list of recipients.
 */
export async function sendTemplateTest(actor: CrmActor, id: string, raw: unknown) {
  const input = testSendSchema.parse(raw);
  assertCaptureRateLimit(`template-test:${actor.userId}`, TEST_SEND_PER_MINUTE);
  const t = await loadTemplate(actor.companyId, id);
  if (t.status === "ARCHIVED") throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This template is archived. Restore it to send a test.");
  const channel = await prisma.crmChannel.findFirst({ where: { id: input.channelId, companyId: actor.companyId } });
  if (!channel) throw new BusinessRuleError("NOT_FOUND", "Channel not found.", { id: input.channelId });
  if (channel.channelType !== t.channelType) throw new BusinessRuleError("VALIDATION_ERROR", `Choose a ${CHANNEL_TYPE_LABELS[t.channelType as ChannelType]} channel for this template.`, { fieldErrors: { channelId: "Wrong channel type." } });
  const caps = channelCapabilities(channel);
  if (!caps.canSend) throw new BusinessRuleError("CRM_CHANNEL_UNAVAILABLE", caps.sendUnavailableReason ?? "This channel can't send messages.", { channelId: channel.id });
  const recipient = testRecipient(t.channelType, input.to);
  const context: TemplateRenderContextInput = input.context && !input.sample ? { refs: input.context } : { sample: true };
  const r = await renderTemplate(actor, id, context, { versionId: input.versionId, channelId: channel.id });
  if (!r.ok) throw invalid("The test wasn't sent — fix the template's errors first.", r.errors, r.warnings);
  const provider = providerOf(channel);
  const pc = providerChannel(channel, channel.secretEncrypted);
  const check = provider.validateRecipient(pc, recipient);
  if (!check.ok) throw new BusinessRuleError("VALIDATION_ERROR", check.reason, { fieldErrors: { to: check.reason } });
  const subject = r.subject ? `${TEST_MARK} ${r.subject}` : null;
  const body = subject ? r.body : `${TEST_MARK} ${r.body}`;
  const version = (await prisma.crmMessageTemplateVersion.findUniqueOrThrow({ where: { id: r.version.id } }))!;
  const templateRef: OutboundTemplateRef = { templateId: t.id, versionId: version.id, versionNumber: version.versionNumber, name: t.name, providerMetadata: r.providerMetadata, parameters: r.parameters };
  const testId = randomUUID();
  let result: SendResult;
  try {
    result = await provider.sendMessage(pc, { idempotencyKey: testId, conversation: { id: `template-test-${t.id}`, threadRef: null }, to: recipient, subject, body, attachments: [], replyToProviderMessageId: null, metadata: {}, template: templateRef, test: true });
  } catch (e) {
    logger.error("CRM channel provider threw during a template test send", { provider: provider.key, channelId: channel.id, templateId: t.id, error: e instanceof Error ? e.name : "unknown" });
    result = { ok: false, errorCode: "PROVIDER_ERROR", errorMessage: "The provider failed unexpectedly.", retryable: true };
  }
  await runCrmMutation(actor, async (ctx) => {
    const outcome = result.ok ? { ok: true, providerMessageId: result.providerMessageId } : { ok: false, errorCode: result.errorCode };
    await ctx.audit({ tableName: TABLE, recordId: t.id, action: "UPDATE", newValues: { event: "template.test_sent", test: true, testId, to: recipient.value, channelId: channel.id, versionNumber: version.versionNumber, sample: "sample" in context, ...outcome } });
    if (result.ok) emitTemplate(ctx, t, "template.test_sent", `Test sent to ${recipient.value} via ${channel.name} (version ${version.versionNumber})`, { testId, to: recipient.value, channelId: channel.id, testedVersionNumber: version.versionNumber, providerMessageId: result.providerMessageId });
  });
  if (!result.ok) throw new BusinessRuleError("CRM_CHANNEL_UNAVAILABLE", `Test not sent: ${result.errorMessage}`, { errorCode: result.errorCode, retryable: result.retryable });
  return { ok: true as const, testId, to: recipient.value, channel: { id: channel.id, name: channel.name }, providerMessageId: result.providerMessageId, status: result.status, subject, body, versionNumber: version.versionNumber, warnings: r.warnings };
}

// ── Inbox (Phase 11) integration ─────────────────────────────────

export interface ConversationTemplateUse {
  templateId: string;
  versionId: string;
  versionNumber: number;
  name: string;
  /** The user changed the inserted text before sending. */
  edited: boolean;
  ref: OutboundTemplateRef;
}

/**
 * Called by the conversation send service when a reply was written from a
 * template: the template must be ACTIVE and for this channel type, and the
 * version must belong to it. Re-renders that version for the conversation so
 * the message records whether the user edited the text, and so providers get
 * the template's parameters. The message itself stores the final text.
 */
export async function resolveTemplateForConversationSend(actor: CrmActor, input: { templateId: string; templateVersionId: string; conversationId: string; channelType: string; subject: string | null; body: string }): Promise<ConversationTemplateUse> {
  const t = await loadTemplate(actor.companyId, input.templateId);
  if (t.status !== "ACTIVE") throw new BusinessRuleError("INVALID_STATE_TRANSITION", t.status === "ARCHIVED" ? "That template was archived. Choose another template or send without one." : "That template is no longer active. Choose another template or send without one.", { status: t.status });
  if (t.channelType !== input.channelType) throw new BusinessRuleError("VALIDATION_ERROR", `That's a ${CHANNEL_TYPE_LABELS[t.channelType as ChannelType]} template — this conversation is ${CHANNEL_TYPE_LABELS[input.channelType as ChannelType] ?? input.channelType}.`);
  const r = await renderTemplate(actor, t.id, { refs: { conversationId: input.conversationId } }, { versionId: input.templateVersionId });
  const edited = r.body.trim() !== input.body.trim() || (r.subject ?? "").trim() !== (input.subject ?? "").trim();
  return {
    templateId: t.id,
    versionId: r.version.id,
    versionNumber: r.version.versionNumber,
    name: t.name,
    edited,
    ref: { templateId: t.id, versionId: r.version.id, versionNumber: r.version.versionNumber, name: t.name, providerMetadata: r.providerMetadata, parameters: edited ? [] : r.parameters },
  };
}

// ── Facade for other modules ─────────────────────────────────────

/**
 * Stable contract for future consumers (sequences, workflows, reminders,
 * campaigns). They store a templateId and call these — never the tables.
 *
 *   const r = await TemplateService.renderTemplate(crmSystemActor(companyId), templateId,
 *     { refs: { opportunityId, contactId } }, { requireUsable: true });
 *   if (r.ok) → send r.subject / r.body through the conversation / provider layer,
 *               recording r.template.id + r.version.id with the message.
 */
export const TemplateService = {
  getTemplate,
  listTemplates,
  validateTemplate: validateStoredTemplate,
  validateContent: validateTemplateContent,
  renderTemplate,
  previewTemplate,
  previewWithSampleData: renderWithSampleData,
  sendTest: sendTemplateTest,
  usage: templateUsage,
};
