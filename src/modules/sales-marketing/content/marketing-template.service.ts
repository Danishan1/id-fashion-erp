import type { Prisma } from "@prisma/client";
import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { PermissionService } from "@/core/rbac/PermissionService";
import { parseTemplateText, validateTemplateContent } from "@/modules/crm/templates/template-engine";
import { checkTemplateForDelivery, sampleRender } from "@/modules/sales-marketing/delivery/delivery-render";
import type { SalesActor } from "@/modules/sales-marketing/enquiries/sales-enquiry.service";
import { userNames } from "./content-common";
import { CONTENT_CHANNELS } from "./content-registry";
import { reviewStates, statusOf } from "./content-review.service";

/**
 * CRM message templates seen from marketing (Phase 11). The template library
 * is the CRM one (CRM → Templates edits the text and keeps the versions);
 * marketing adds the review of each version for marketing use. A channel that
 * sends a template uses its newest approved version.
 */

/** Variables used at least once without a {{key|fallback}} (an explicit empty fallback counts as one). */
export function variablesWithoutFallback(subject: string | null, body: string) {
  const tokens = [...(subject ? parseTemplateText(subject, "subject").tokens : []), ...parseTemplateText(body, "body").tokens];
  return [...new Set(tokens.filter((t) => t.known && t.fallback === null).map((t) => t.key))];
}

export async function listMarketingTemplates(actor: SalesActor, filter: { search?: string; channelType?: string; review?: string }, page = 1, pageSize = 25) {
  await PermissionService.assert(actor.userId, "marketing_content", "view");
  const and: Prisma.CrmMessageTemplateWhereInput[] = [{ companyId: actor.companyId, status: { not: "ARCHIVED" }, channelType: { in: [...CONTENT_CHANNELS] } }];
  if (filter.channelType && (CONTENT_CHANNELS as readonly string[]).includes(filter.channelType)) and.push({ channelType: filter.channelType });
  const term = filter.search?.trim().toLowerCase().replace(/\s+/g, " ");
  if (term) and.push({ searchText: { contains: term } });
  const where: Prisma.CrmMessageTemplateWhereInput = { AND: and };
  const rows = await prisma.crmMessageTemplate.findMany({ where, orderBy: [{ updatedAt: "desc" }, { id: "asc" }], select: { id: true, name: true, channelType: true, status: true, currentVersionId: true, currentVersionNumber: true, updatedAt: true }, take: 1000 });
  const versions = await prisma.crmMessageTemplateVersion.findMany({ where: { templateId: { in: rows.map((r) => r.id) } }, select: { id: true, templateId: true, versionNumber: true } });
  const states = await reviewStates(versions.map((v) => v.id), "TEMPLATE_VERSION");
  const approvedNumber = new Map<string, number>();
  for (const v of versions) if (states.get(v.id)?.status === "APPROVED" && v.versionNumber > (approvedNumber.get(v.templateId) ?? 0)) approvedNumber.set(v.templateId, v.versionNumber);
  let data = rows.map((t) => ({
    id: t.id,
    name: t.name,
    channelType: t.channelType,
    crmStatus: t.status,
    currentVersionNumber: t.currentVersionNumber,
    currentReview: t.currentVersionId ? statusOf(states, t.currentVersionId) : "DRAFT",
    approvedVersionNumber: approvedNumber.get(t.id) ?? null,
    updatedAt: t.updatedAt.toISOString(),
  }));
  if (filter.review === "approved") data = data.filter((d) => d.approvedVersionNumber);
  if (filter.review === "pending") data = data.filter((d) => d.currentReview === "PENDING");
  if (filter.review === "needs_review") data = data.filter((d) => d.currentReview !== "APPROVED" && d.currentReview !== "PENDING");
  const total = data.length;
  return { data: data.slice((page - 1) * pageSize, page * pageSize), meta: { page, pageSize, totalCount: total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } };
}

export async function getMarketingTemplate(actor: SalesActor, id: string) {
  await PermissionService.assert(actor.userId, "marketing_content", "view");
  const t = await prisma.crmMessageTemplate.findFirst({ where: { id, companyId: actor.companyId, channelType: { in: [...CONTENT_CHANNELS] } }, select: { id: true, name: true, description: true, channelType: true, status: true, currentVersionId: true } });
  if (!t) throw new BusinessRuleError("NOT_FOUND", "Template not found.", { id });
  const versions = await prisma.crmMessageTemplateVersion.findMany({ where: { templateId: t.id }, orderBy: { versionNumber: "desc" }, take: 30 });
  const states = await reviewStates(versions.map((v) => v.id), "TEMPLATE_VERSION");
  const names = await userNames([...versions.map((v) => v.createdByUserId), ...[...states.values()].flatMap((s) => [s.decidedBy, s.submittedBy])]);
  const [channels, contents] = await Promise.all([
    prisma.marketingCampaignChannel.findMany({ where: { templateId: t.id, contentId: null, companyId: actor.companyId }, select: { id: true, isActive: true, campaign: { select: { id: true, code: true, name: true, status: true } } } }),
    prisma.marketingCampaignContent.findMany({ where: { sourceTemplateId: t.id, companyId: actor.companyId }, select: { id: true, name: true, status: true, campaign: { select: { id: true, code: true } } } }),
  ]);
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    channelType: t.channelType,
    crmStatus: t.status,
    versions: versions.map((v) => {
      const s = states.get(v.id);
      const sample = sampleRender(v);
      const deliveryProblems = [...validateTemplateContent({ channelType: t.channelType, subject: v.subject, body: v.body, providerMetadata: (v.providerMetadata ?? {}) as Record<string, string> }).errors.map((e) => e.message), ...checkTemplateForDelivery(v)];
      return {
        id: v.id,
        versionNumber: v.versionNumber,
        current: v.id === t.currentVersionId,
        subject: v.subject,
        body: v.body,
        providerMetadata: (v.providerMetadata ?? {}) as Record<string, string>,
        changeNote: v.changeNote,
        createdBy: names.get(v.createdByUserId) ?? "—",
        createdByMe: v.createdByUserId === actor.userId,
        createdAt: v.createdAt.toISOString(),
        review: statusOf(states, v.id),
        submittedByMe: s?.submittedBy === actor.userId,
        decidedBy: s?.decidedBy ? (names.get(s.decidedBy) ?? "—") : null,
        decisionComment: s?.comment ?? null,
        sample: { subject: sample.subject, body: sample.body },
        deliveryProblems,
        /** Recipients without a value for these are skipped (no fallback given). */
        withoutFallback: variablesWithoutFallback(v.subject, v.body),
      };
    }),
    usage: { channels: channels.map((c) => ({ id: c.id, isActive: c.isActive, campaign: c.campaign })), contents },
  };
}
