import { prisma } from "@/core/db/client";
import { readStoredFile } from "@/core/file-storage/FileStorage";
import type { Db } from "./content-common";
import { ATTACHMENT_CHANNELS, ASSET_MIME, isAssetMime, MAX_ATTACHMENT_TOTAL_BYTES, type ContentChannel } from "./content-registry";
import { reviewStates } from "./content-review.service";

/**
 * The content interface for Phase 10 delivery (Phase 11). Delivery never
 * reads templates or assets directly: it asks this module which approved,
 * immutable versions a channel would send now, freezes their ids on the run,
 * and later loads exactly those. Rendering per recipient stays in
 * delivery-render.ts; sending stays in the provider adapters.
 *
 *  - Template channel  → the newest template version approved for marketing.
 *  - Content channel   → the campaign content's newest approved version and
 *                        the asset versions pinned to it.
 */

export interface ResolvedAttachment {
  assetId: string;
  assetVersionId: string;
  name: string;
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
}

export interface ResolvedContent {
  source: "TEMPLATE" | "CAMPAIGN_CONTENT";
  channelType: string;
  templateId: string;
  templateVersionId: string;
  templateVersionNumber: number;
  contentId: string | null;
  contentName: string | null;
  contentVersionId: string | null;
  contentVersionNumber: number | null;
  subject: string | null;
  body: string;
  variables: string[];
  providerMetadata: Record<string, string>;
  locale: string | null;
  attachments: ResolvedAttachment[];
}

const meta = (raw: unknown): Record<string, string> =>
  Object.fromEntries(Object.entries((raw ?? {}) as Record<string, unknown>).filter(([, x]) => typeof x === "string" && x.trim()).map(([k, x]) => [k, String(x).trim()]));

const today = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
};

/** Newest template version approved for marketing, or null. */
export async function approvedTemplateVersion(templateId: string, db: Db = prisma) {
  const versions = await db.crmMessageTemplateVersion.findMany({ where: { templateId }, orderBy: { versionNumber: "desc" }, select: { id: true, versionNumber: true }, take: 200 });
  const states = await reviewStates(versions.map((v) => v.id), "TEMPLATE_VERSION", db);
  const v = versions.find((x) => states.get(x.id)?.status === "APPROVED");
  return v ? db.crmMessageTemplateVersion.findUniqueOrThrow({ where: { id: v.id } }) : null;
}

async function attachmentsOf(contentVersionId: string, db: Db): Promise<ResolvedAttachment[]> {
  const links = await db.marketingContentVersionAsset.findMany({ where: { contentVersionId }, orderBy: { position: "asc" }, include: { assetVersion: { include: { asset: { select: { id: true, name: true } } } } } });
  return links.map((l) => ({ assetId: l.assetVersion.asset.id, assetVersionId: l.assetVersionId, name: l.assetVersion.asset.name, fileName: l.assetVersion.originalFileName, mimeType: l.assetVersion.mimeType, fileSizeBytes: l.assetVersion.fileSizeBytes }));
}

/** Are the attached files still usable (approved, active, unexpired, allowed on this channel)? */
export async function attachmentProblems(channelType: string, attachments: ResolvedAttachment[], providerAllowsAttachments: boolean | null, db: Db = prisma): Promise<string[]> {
  if (!attachments.length) return [];
  const out: string[] = [];
  if (!ATTACHMENT_CHANNELS.has(channelType as ContentChannel)) out.push(`${channelType.toLowerCase()} messages can't carry files.`);
  if (providerAllowsAttachments === false) out.push("This provider doesn't send attachments.");
  const states = await reviewStates(attachments.map((a) => a.assetVersionId), "ASSET_VERSION", db);
  const assets = await db.marketingAsset.findMany({ where: { id: { in: attachments.map((a) => a.assetId) } }, select: { id: true, status: true, expiresOn: true } });
  const byId = new Map(assets.map((a) => [a.id, a]));
  for (const a of attachments) {
    const asset = byId.get(a.assetId);
    if (states.get(a.assetVersionId)?.status !== "APPROVED") out.push(`Attachment "${a.name}" isn't approved.`);
    if (!asset || asset.status !== "ACTIVE") out.push(`Attachment "${a.name}" is archived.`);
    else if (asset.expiresOn && asset.expiresOn < today()) out.push(`Attachment "${a.name}" expired on ${asset.expiresOn.toISOString().slice(0, 10)}.`);
    if (!isAssetMime(a.mimeType) || !ASSET_MIME[a.mimeType].attachable) out.push(`"${a.name}" (${a.mimeType}) can't be attached to messages.`);
  }
  const total = attachments.reduce((s, a) => s + a.fileSizeBytes, 0);
  if (total > MAX_ATTACHMENT_TOTAL_BYTES) out.push(`Attachments total ${(total / 1048576).toFixed(1)} MB; the limit is ${MAX_ATTACHMENT_TOTAL_BYTES / 1048576} MB per message.`);
  return out;
}

/**
 * What a campaign channel would send now. `problems` lists everything that
 * blocks sending (no approved version, archived template / content, unusable
 * attachments); `content` is null when nothing approved exists.
 */
export async function resolveChannelContent(channel: { templateId: string; contentId: string | null; campaignId: string }, providerAllowsAttachments: boolean | null, db: Db = prisma): Promise<{ content: ResolvedContent | null; problems: string[] }> {
  if (channel.contentId) {
    const c = await db.marketingCampaignContent.findUnique({ where: { id: channel.contentId }, include: { approvedVersion: true } });
    if (!c || c.campaignId !== channel.campaignId) return { content: null, problems: ["The campaign content no longer exists."] };
    const problems: string[] = [];
    if (c.status !== "ACTIVE") problems.push(`Campaign content "${c.name}" is archived.`);
    if (!c.approvedVersion) return { content: null, problems: [...problems, `Campaign content "${c.name}" has no approved version yet. Submit it for review in the content editor.`] };
    const tv = await db.crmMessageTemplateVersion.findUniqueOrThrow({ where: { id: c.approvedVersion.sourceTemplateVersionId }, select: { versionNumber: true } });
    const attachments = await attachmentsOf(c.approvedVersion.id, db);
    problems.push(...(await attachmentProblems(c.channelType, attachments, providerAllowsAttachments, db)));
    return {
      content: {
        source: "CAMPAIGN_CONTENT",
        channelType: c.channelType,
        templateId: c.sourceTemplateId,
        templateVersionId: c.approvedVersion.sourceTemplateVersionId,
        templateVersionNumber: tv.versionNumber,
        contentId: c.id,
        contentName: c.name,
        contentVersionId: c.approvedVersion.id,
        contentVersionNumber: c.approvedVersion.versionNumber,
        subject: c.approvedVersion.subject,
        body: c.approvedVersion.body,
        variables: c.approvedVersion.variables,
        providerMetadata: meta(c.approvedVersion.providerMetadata),
        locale: c.locale,
        attachments,
      },
      problems,
    };
  }
  const t = await db.crmMessageTemplate.findUnique({ where: { id: channel.templateId }, select: { id: true, name: true, status: true, channelType: true } });
  if (!t) return { content: null, problems: ["The template no longer exists."] };
  const problems: string[] = [];
  if (t.status !== "ACTIVE") problems.push(`Template "${t.name}" is ${t.status.toLowerCase()} in the CRM.`);
  const v = await approvedTemplateVersion(t.id, db);
  if (!v) return { content: null, problems: [...problems, `Template "${t.name}" has no version approved for marketing. Submit it in Content Library → Templates.`] };
  const pm = meta(v.providerMetadata);
  return {
    content: { source: "TEMPLATE", channelType: t.channelType, templateId: t.id, templateVersionId: v.id, templateVersionNumber: v.versionNumber, contentId: null, contentName: null, contentVersionId: null, contentVersionNumber: null, subject: v.subject, body: v.body, variables: v.variables, providerMetadata: pm, locale: pm.language ?? null, attachments: [] },
    problems,
  };
}

/** The exact content a run froze (template version, or content version + its pinned files). */
export async function loadRunContent(run: { templateId: string; templateVersionId: string; contentVersionId: string | null; locale: string | null; channelType: string }, db: Db = prisma): Promise<ResolvedContent> {
  if (run.contentVersionId) {
    const v = await db.marketingCampaignContentVersion.findUniqueOrThrow({ where: { id: run.contentVersionId }, include: { content: { select: { id: true, name: true } }, sourceTemplateVersion: { select: { versionNumber: true } } } });
    return {
      source: "CAMPAIGN_CONTENT",
      channelType: run.channelType,
      templateId: run.templateId,
      templateVersionId: v.sourceTemplateVersionId,
      templateVersionNumber: v.sourceTemplateVersion.versionNumber,
      contentId: v.content.id,
      contentName: v.content.name,
      contentVersionId: v.id,
      contentVersionNumber: v.versionNumber,
      subject: v.subject,
      body: v.body,
      variables: v.variables,
      providerMetadata: meta(v.providerMetadata),
      locale: run.locale,
      attachments: await attachmentsOf(v.id, db),
    };
  }
  const v = await db.crmMessageTemplateVersion.findUniqueOrThrow({ where: { id: run.templateVersionId } });
  return { source: "TEMPLATE", channelType: run.channelType, templateId: run.templateId, templateVersionId: v.id, templateVersionNumber: v.versionNumber, contentId: null, contentName: null, contentVersionId: null, contentVersionNumber: null, subject: v.subject, body: v.body, variables: v.variables, providerMetadata: meta(v.providerMetadata), locale: run.locale, attachments: [] };
}

/** File bytes for the attachments (read once per dispatch slice). Throws if one is missing. */
export async function loadAttachmentFiles(attachments: ResolvedAttachment[], db: Db = prisma) {
  if (!attachments.length) return [];
  const rows = await db.marketingAssetVersion.findMany({ where: { id: { in: attachments.map((a) => a.assetVersionId) } }, select: { id: true, storageKey: true } });
  const keys = new Map(rows.map((r) => [r.id, r.storageKey]));
  return Promise.all(attachments.map(async (a) => ({ fileName: a.fileName, mimeType: a.mimeType, sizeBytes: a.fileSizeBytes, content: await readStoredFile(keys.get(a.assetVersionId)!) })));
}
