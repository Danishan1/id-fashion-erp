import { Prisma } from "@prisma/client";
import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { PermissionService } from "@/core/rbac/PermissionService";
import { loadContactForActor } from "@/modules/crm/contacts/crm-contacts.service";
import { smsInfo, validateTemplateContent } from "@/modules/crm/templates/template-engine";
import { TEMPLATE_CHANNELS, type ChannelType } from "@/modules/crm/templates/template-registry";
import { loadCampaign } from "@/modules/sales-marketing/campaigns/campaign-common";
import { checkTemplateForDelivery, recipientValues, renderForRecipient, sampleRender, strictRenderProblems } from "@/modules/sales-marketing/delivery/delivery-render";
import type { SalesActor } from "@/modules/sales-marketing/enquiries/sales-enquiry.service";
import { auditContent, CONTENTS_TABLE, recordContentCampaignEvent, userNames } from "./content-common";
import { ASSET_MIME, ATTACHMENT_CHANNELS, contentCreateSchema, contentPreviewSchema, contentVersionSchema, CONTENT_CHANNELS, isAssetMime, MAX_ATTACHMENT_TOTAL_BYTES, type ContentChannel } from "./content-registry";
import { approvedTemplateVersion, attachmentProblems } from "./content-resolver";
import { reviewStates, statusOf } from "./content-review.service";

/**
 * Campaign-specific content (Phase 11): a campaign's own wording made from a
 * CRM template, with approved library files attached. The shared template is
 * never modified. Every save is a new immutable version; only an approved
 * version is ever sent, and a run keeps the version it started with.
 */

const OPEN_RUN = ["PREPARING", "SCHEDULED", "QUEUED", "RUNNING"] as const;
const closedCampaign = (status: string) => status === "COMPLETED" || status === "CANCELLED";

async function loadContent(actor: SalesActor, id: string) {
  const c = await prisma.marketingCampaignContent.findFirst({ where: { id, companyId: actor.companyId } });
  if (!c) throw new BusinessRuleError("NOT_FOUND", "Campaign content not found.", { id });
  const campaign = await loadCampaign(actor, c.campaignId).catch(() => {
    throw new BusinessRuleError("NOT_FOUND", "Campaign content not found.", { id });
  });
  return { c, campaign };
}

/** Errors that block saving a version (CRM template rules + delivery rules + attachments). */
async function contentErrors(actor: SalesActor, channelType: string, input: { subject: string | null; body: string; providerMetadata: Record<string, string> }, assetVersionIds: string[]) {
  const v = validateTemplateContent({ channelType, subject: input.subject, body: input.body, providerMetadata: input.providerMetadata });
  const errors = v.errors.map((e) => e.message);
  errors.push(...checkTemplateForDelivery({ subject: input.subject, body: input.body, variables: v.variables }));
  if (assetVersionIds.length) {
    if (!ATTACHMENT_CHANNELS.has(channelType as ContentChannel)) errors.push(`${TEMPLATE_CHANNELS[channelType as ChannelType]?.label ?? channelType} messages can't carry files.`);
    const versions = await prisma.marketingAssetVersion.findMany({ where: { id: { in: assetVersionIds }, companyId: actor.companyId }, include: { asset: { select: { name: true, status: true } } } });
    if (versions.length !== new Set(assetVersionIds).size) errors.push("An attachment wasn't found.");
    for (const av of versions) {
      if (av.asset.status !== "ACTIVE") errors.push(`"${av.asset.name}" is archived.`);
      if (!isAssetMime(av.mimeType) || !ASSET_MIME[av.mimeType].attachable) errors.push(`"${av.asset.name}" (${av.mimeType}) can't be attached to messages.`);
    }
    const total = versions.reduce((s, x) => s + x.fileSizeBytes, 0);
    if (total > MAX_ATTACHMENT_TOTAL_BYTES) errors.push(`Attachments total ${(total / 1048576).toFixed(1)} MB; the limit is ${MAX_ATTACHMENT_TOTAL_BYTES / 1048576} MB.`);
  }
  return { errors, warnings: v.warnings.map((w) => w.message), variables: v.variables };
}

export async function listCampaignContents(actor: SalesActor, campaignId: string) {
  await PermissionService.assert(actor.userId, "marketing_content", "view");
  const campaign = await loadCampaign(actor, campaignId);
  const rows = await prisma.marketingCampaignContent.findMany({
    where: { campaignId: campaign.id, companyId: actor.companyId },
    include: { currentVersion: { select: { id: true, versionNumber: true } }, approvedVersion: { select: { versionNumber: true } }, sourceTemplate: { select: { id: true, name: true } }, _count: { select: { channels: true } } },
    orderBy: { createdAt: "asc" },
  });
  const states = await reviewStates(rows.map((r) => r.currentVersionId).filter((x): x is string => Boolean(x)), "CONTENT_VERSION");
  return {
    campaign: { id: campaign.id, code: campaign.code, status: campaign.status },
    contents: rows.map((r) => ({
      id: r.id,
      name: r.name,
      channelType: r.channelType,
      locale: r.locale,
      status: r.status,
      template: r.sourceTemplate,
      currentVersionNumber: r.currentVersion?.versionNumber ?? null,
      currentReview: r.currentVersion ? statusOf(states, r.currentVersion.id) : "DRAFT",
      approvedVersionNumber: r.approvedVersion?.versionNumber ?? null,
      channelCount: r._count.channels,
    })),
  };
}

export async function createCampaignContent(actor: SalesActor, campaignId: string, raw: unknown) {
  await PermissionService.assert(actor.userId, "marketing_content", "create");
  const input = contentCreateSchema.parse(raw);
  const campaign = await loadCampaign(actor, campaignId);
  if (closedCampaign(campaign.status)) throw new BusinessRuleError("INVALID_STATE_TRANSITION", `The campaign is ${campaign.status.toLowerCase()}.`);
  const t = await prisma.crmMessageTemplate.findFirst({ where: { id: input.templateId, companyId: actor.companyId }, include: { currentVersion: true } });
  if (!t || !(CONTENT_CHANNELS as readonly string[]).includes(t.channelType)) throw new BusinessRuleError("VALIDATION_ERROR", "Choose an email, SMS or WhatsApp template.", { fieldErrors: { templateId: "Not found." } });
  if (t.status === "ARCHIVED") throw new BusinessRuleError("VALIDATION_ERROR", "That template is archived.", { fieldErrors: { templateId: "Archived." } });
  // Start from the version approved for marketing when there is one, else the current text.
  const source = (await approvedTemplateVersion(t.id)) ?? t.currentVersion;
  if (!source) throw new BusinessRuleError("VALIDATION_ERROR", "That template has no text yet.");
  return prisma.$transaction(async (tx) => {
    const c = await tx.marketingCampaignContent.create({ data: { companyId: actor.companyId, campaignId: campaign.id, name: input.name, channelType: t.channelType, locale: input.locale, sourceTemplateId: t.id, createdByUserId: actor.userId } });
    const v = await tx.marketingCampaignContentVersion.create({
      data: { companyId: actor.companyId, contentId: c.id, versionNumber: 1, sourceTemplateVersionId: source.id, subject: source.subject, body: source.body, variables: source.variables, providerMetadata: (source.providerMetadata ?? {}) as Prisma.InputJsonValue, changeNote: `From template "${t.name}" v${source.versionNumber}`, createdByUserId: actor.userId },
    });
    await tx.marketingCampaignContent.update({ where: { id: c.id }, data: { currentVersionId: v.id, currentVersionNumber: 1 } });
    await auditContent(tx, actor, CONTENTS_TABLE, c.id, "CREATE", null, { campaignId: campaign.id, name: c.name, templateId: t.id, templateVersion: source.versionNumber });
    await recordContentCampaignEvent(tx, actor, campaign.id, "CONTENT_CREATED", null, { contentId: c.id, name: c.name, template: t.name, templateVersion: source.versionNumber });
    return { id: c.id };
  });
}

/** Save = a new version (the previous ones, and their approvals, stay as they were). */
export async function saveContentVersion(actor: SalesActor, id: string, raw: unknown) {
  await PermissionService.assert(actor.userId, "marketing_content", "edit");
  const input = contentVersionSchema.parse(raw);
  const { c, campaign } = await loadContent(actor, id);
  if (c.status !== "ACTIVE") throw new BusinessRuleError("INVALID_STATE_TRANSITION", "Restore this content before editing it.");
  if (closedCampaign(campaign.status)) throw new BusinessRuleError("INVALID_STATE_TRANSITION", `The campaign is ${campaign.status.toLowerCase()}.`);
  const ch = TEMPLATE_CHANNELS[c.channelType as ChannelType];
  const subject = ch?.subject === "required" ? input.subject?.trim() || null : null;
  const providerMetadata = Object.fromEntries(Object.entries(input.providerMetadata).filter(([, v]) => v));
  const assetVersionIds = [...new Set(input.assetVersionIds)];
  const { errors, variables } = await contentErrors(actor, c.channelType, { subject, body: input.body, providerMetadata }, assetVersionIds);
  if (errors.length) throw new BusinessRuleError("VALIDATION_ERROR", errors.join(" "), { errors });
  const current = c.currentVersionId ? await prisma.marketingCampaignContentVersion.findUnique({ where: { id: c.currentVersionId }, include: { assets: { select: { assetVersionId: true }, orderBy: { position: "asc" } } } }) : null;
  const locale = input.locale ?? c.locale;
  const unchanged =
    current &&
    current.subject === subject &&
    current.body === input.body &&
    JSON.stringify(current.providerMetadata ?? {}) === JSON.stringify(providerMetadata) &&
    JSON.stringify(current.assets.map((a) => a.assetVersionId)) === JSON.stringify(assetVersionIds) &&
    locale === c.locale;
  if (unchanged) throw new BusinessRuleError("VALIDATION_ERROR", "Nothing changed since the current version.");
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.marketingCampaignContent.updateMany({ where: { id: c.id, version: input.version, status: "ACTIVE" }, data: { version: { increment: 1 } } });
    if (count === 0) throw new BusinessRuleError("RECORD_VERSION_CONFLICT", "Someone saved this content just now. Reload to see their version before saving yours.");
    const n = c.currentVersionNumber + 1;
    const v = await tx.marketingCampaignContentVersion.create({
      data: { companyId: actor.companyId, contentId: c.id, versionNumber: n, sourceTemplateVersionId: current?.sourceTemplateVersionId ?? (await tx.crmMessageTemplate.findUniqueOrThrow({ where: { id: c.sourceTemplateId } })).currentVersionId!, subject, body: input.body, variables, providerMetadata: providerMetadata as Prisma.InputJsonValue, changeNote: input.changeNote || null, createdByUserId: actor.userId },
    });
    if (assetVersionIds.length) await tx.marketingContentVersionAsset.createMany({ data: assetVersionIds.map((assetVersionId, position) => ({ companyId: actor.companyId, contentVersionId: v.id, assetVersionId, position })) });
    await tx.marketingCampaignContent.update({ where: { id: c.id }, data: { currentVersionId: v.id, currentVersionNumber: n, locale, updatedByUserId: actor.userId } });
    await auditContent(tx, actor, CONTENTS_TABLE, c.id, "UPDATE", { versionNumber: c.currentVersionNumber }, { versionNumber: n, attachments: assetVersionIds.length, locale, changeNote: input.changeNote ?? null });
    await recordContentCampaignEvent(tx, actor, c.campaignId, "CONTENT_VERSION_SAVED", input.changeNote || null, { contentId: c.id, name: c.name, versionNumber: n });
    return { id: c.id, versionNumber: n, versionId: v.id };
  });
}

export async function setContentArchived(actor: SalesActor, id: string, archived: boolean, version: number) {
  await PermissionService.assert(actor.userId, "marketing_content", archived ? "delete" : "edit");
  const { c, campaign } = await loadContent(actor, id);
  if (archived === (c.status === "ARCHIVED")) throw new BusinessRuleError("INVALID_STATE_TRANSITION", archived ? "Already archived." : "Not archived.");
  if (!archived && closedCampaign(campaign.status)) throw new BusinessRuleError("INVALID_STATE_TRANSITION", `The campaign is ${campaign.status.toLowerCase()}.`);
  if (archived) {
    const open = await prisma.marketingDeliveryRun.count({ where: { campaignChannel: { contentId: c.id }, status: { in: [...OPEN_RUN] } } });
    if (open) throw new BusinessRuleError("REFERENCED_RECORD_IN_USE", "A delivery run of this content is scheduled or sending. Cancel it first.");
  }
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.marketingCampaignContent.updateMany({ where: { id: c.id, version }, data: archived ? { status: "ARCHIVED", archivedAt: new Date(), version: { increment: 1 } } : { status: "ACTIVE", archivedAt: null, version: { increment: 1 } } });
    if (count === 0) throw new BusinessRuleError("RECORD_VERSION_CONFLICT", "Someone changed this content just now. Reload.");
    await auditContent(tx, actor, CONTENTS_TABLE, c.id, archived ? "DELETE" : "UPDATE", { status: c.status }, { status: archived ? "ARCHIVED" : "ACTIVE" });
    await recordContentCampaignEvent(tx, actor, c.campaignId, archived ? "CONTENT_ARCHIVED" : "CONTENT_RESTORED", null, { contentId: c.id, name: c.name });
  });
  return getCampaignContent(actor, id);
}

export async function getCampaignContent(actor: SalesActor, id: string) {
  await PermissionService.assert(actor.userId, "marketing_content", "view");
  const { c, campaign } = await loadContent(actor, id);
  const [versions, template, channels] = await Promise.all([
    prisma.marketingCampaignContentVersion.findMany({ where: { contentId: c.id }, orderBy: { versionNumber: "desc" }, include: { sourceTemplateVersion: { select: { versionNumber: true } }, assets: { orderBy: { position: "asc" }, include: { assetVersion: { include: { asset: { select: { id: true, code: true, name: true } } } } } } } }),
    prisma.crmMessageTemplate.findUniqueOrThrow({ where: { id: c.sourceTemplateId }, select: { id: true, name: true, status: true } }),
    prisma.marketingCampaignChannel.findMany({ where: { contentId: c.id }, include: { connection: { select: { name: true, providerKey: true } }, runs: { select: { id: true, runNumber: true, status: true, contentVersionId: true }, orderBy: { runNumber: "desc" }, take: 10 } } }),
  ]);
  const states = await reviewStates(versions.map((v) => v.id), "CONTENT_VERSION");
  const assetStates = await reviewStates(versions.flatMap((v) => v.assets.map((a) => a.assetVersionId)), "ASSET_VERSION");
  const names = await userNames([...versions.map((v) => v.createdByUserId), ...[...states.values()].flatMap((s) => [s.decidedBy, s.submittedBy])]);
  const current = versions.find((v) => v.id === c.currentVersionId) ?? null;
  const currentCheck = current ? await contentErrors(actor, c.channelType, { subject: current.subject, body: current.body, providerMetadata: (current.providerMetadata ?? {}) as Record<string, string> }, current.assets.map((a) => a.assetVersionId)) : null;
  return {
    id: c.id,
    name: c.name,
    channelType: c.channelType,
    locale: c.locale,
    status: c.status,
    version: c.version,
    campaign: { id: campaign.id, code: campaign.code, name: campaign.name, status: campaign.status },
    template,
    currentVersionId: c.currentVersionId,
    approvedVersionId: c.approvedVersionId,
    providerFields: TEMPLATE_CHANNELS[c.channelType as ChannelType]?.providerFields ?? [],
    subjectRequired: TEMPLATE_CHANNELS[c.channelType as ChannelType]?.subject === "required",
    attachmentsAllowed: ATTACHMENT_CHANNELS.has(c.channelType as ContentChannel),
    currentCheck: currentCheck ? { errors: currentCheck.errors, warnings: currentCheck.warnings } : null,
    versions: versions.map((v) => {
      const s = states.get(v.id);
      return {
        id: v.id,
        versionNumber: v.versionNumber,
        subject: v.subject,
        body: v.body,
        variables: v.variables,
        providerMetadata: (v.providerMetadata ?? {}) as Record<string, string>,
        changeNote: v.changeNote,
        templateVersionNumber: v.sourceTemplateVersion.versionNumber,
        createdBy: names.get(v.createdByUserId) ?? "—",
        createdByMe: v.createdByUserId === actor.userId,
        createdAt: v.createdAt.toISOString(),
        review: statusOf(states, v.id),
        submittedByMe: s?.submittedBy === actor.userId,
        decidedBy: s?.decidedBy ? (names.get(s.decidedBy) ?? "—") : null,
        decisionComment: s?.comment ?? null,
        attachments: v.assets.map((a) => ({ assetId: a.assetVersion.asset.id, code: a.assetVersion.asset.code, name: a.assetVersion.asset.name, assetVersionId: a.assetVersionId, versionNumber: a.assetVersion.versionNumber, fileName: a.assetVersion.originalFileName, mimeType: a.assetVersion.mimeType, fileSizeBytes: a.assetVersion.fileSizeBytes, review: statusOf(assetStates, a.assetVersionId) })),
      };
    }),
    channels: channels.map((ch) => ({ id: ch.id, connection: ch.connection.name, isActive: ch.isActive, runs: ch.runs.map((r) => ({ ...r, contentVersionNumber: versions.find((v) => v.id === r.contentVersionId)?.versionNumber ?? null })) })),
  };
}

/**
 * Renders a version with sample data, or with a CRM contact the viewer can
 * see (needs CRM view). Writes and sends nothing.
 */
export async function previewContent(actor: SalesActor, id: string, raw: unknown) {
  await PermissionService.assert(actor.userId, "marketing_content", "view");
  const input = contentPreviewSchema.parse(raw ?? {});
  const { c } = await loadContent(actor, id);
  const versionId = input.versionId ?? c.currentVersionId;
  const v = versionId ? await prisma.marketingCampaignContentVersion.findFirst({ where: { id: versionId, contentId: c.id }, include: { assets: { orderBy: { position: "asc" }, include: { assetVersion: { include: { asset: { select: { id: true, name: true } } } } } } } }) : null;
  if (!v) throw new BusinessRuleError("NOT_FOUND", "Version not found.");
  let rendered;
  let basis: "sample" | "contact" = "sample";
  if (input.contactId) {
    await PermissionService.assert(actor.userId, "crm", "view");
    const contact = await loadContactForActor({ ...actor, branchId: actor.branchId ?? null }, input.contactId); // CRM visibility
    const values = (await recipientValues(actor.companyId, [contact.id], actor.userId)).get(contact.id) ?? {};
    rendered = renderForRecipient(v, values, "company.name" in values);
    basis = "contact";
  } else rendered = sampleRender(v);
  const strict = strictRenderProblems(rendered);
  const attachments = v.assets.map((a) => ({ assetId: a.assetVersion.asset.id, assetVersionId: a.assetVersionId, name: a.assetVersion.asset.name, fileName: a.assetVersion.originalFileName, mimeType: a.assetVersion.mimeType, fileSizeBytes: a.assetVersion.fileSizeBytes }));
  return {
    basis,
    versionNumber: v.versionNumber,
    subject: rendered.subject,
    body: rendered.body,
    issues: [...rendered.issues.map((i) => ({ severity: i.severity, message: i.message })), ...strict.map((m) => ({ severity: "error" as const, message: m }))],
    missing: rendered.missing,
    sms: c.channelType === "SMS" ? smsInfo(rendered.body) : null,
    attachments,
    attachmentProblems: await attachmentProblems(c.channelType, attachments, null),
    unsubscribeFooter: c.channelType === "EMAIL",
  };
}
