import type { Prisma } from "@prisma/client";
import { prisma } from "@/core/db/client";
import { todayIsoDate } from "@/lib/date";
import type { BulkActor, BulkEntityDefinition } from "@/modules/bulk-actions/bulk-types";
import { campaignScopeWhere, getCampaignScope } from "../campaigns/campaign-common";
import { buildCampaignListWhere, listCampaignsSchema } from "../campaigns/campaign.service";
import { salesEnquiryListFilterSchema } from "../enquiries/sales-enquiry.schema";
import { buildSalesEnquiryListWhere, getSalesEnquiryScope, scopedWhere as enquiryScopedWhere } from "../enquiries/sales-enquiry.service";
import { buildPromotionListWhere, listQuerySchema as promotionListSchema } from "../promotions/promotion.service";
import { quotationListFilterSchema } from "../quotations/quotation.schema";
import { buildQuotationListWhere, getQuotationScope, scopedWhere as quotationScopedWhere } from "../quotations/quotation.service";

/**
 * Phase 14 (Sales & Marketing) — S&M record types in the shared bulk engine.
 *
 * "All records matching the current filters" is resolved with the list API's
 * own filter schema and where-builder (buildSalesEnquiryListWhere,
 * buildQuotationListWhere, buildCampaignListWhere, buildPromotionListWhere), so
 * it is exactly what the user sees in the list — including the record
 * visibility rules (own / team / view_all, branch access) of each module.
 */

export type SmBulkEntityKey = "ENQUIRY" | "QUOTATION" | "CAMPAIGN" | "PROMOTION" | "ATTRIBUTION_MODEL";
export const SM_BULK_ENTITIES: SmBulkEntityKey[] = ["ENQUIRY", "QUOTATION", "CAMPAIGN", "PROMOTION", "ATTRIBUTION_MODEL"];

/** S&M administrators (settings editors) see and manage every S&M bulk job and schedule. */
const SM_ADMIN = { module: "sales_marketing_settings", action: "edit" } as const;

const pick = <S extends { shape: Record<string, unknown> }>(schema: S, sp: URLSearchParams) => Object.fromEntries([...sp.entries()].filter(([k]) => k in schema.shape));
const params = (query: string) => new URLSearchParams(query.replace(/^\?/, ""));
const CHUNK = 1000;

async function inChunks(ids: string[], fn: (chunk: string[]) => Promise<{ id: string }[]>) {
  const out = new Set<string>();
  for (let i = 0; i < ids.length; i += CHUNK) (await fn(ids.slice(i, i + CHUNK))).forEach((r) => out.add(r.id));
  return out;
}

// ── Where builders (visibility applied) ──────────────────────────

export async function enquiryWhere(actor: BulkActor, filter: Record<string, unknown>) {
  const scope = await getSalesEnquiryScope(actor);
  const { search, ...rest } = filter as { search?: string };
  return buildSalesEnquiryListWhere(actor, scope, salesEnquiryListFilterSchema.parse(rest), search);
}

export async function quotationWhere(actor: BulkActor, filter: Record<string, unknown>) {
  const scope = await getQuotationScope(actor);
  const { search, ...rest } = filter as { search?: string };
  return buildQuotationListWhere(actor, scope, quotationListFilterSchema.parse(rest), search);
}

export async function campaignWhere(actor: BulkActor, filter: Record<string, unknown>) {
  return buildCampaignListWhere(actor, await getCampaignScope(actor), listCampaignsSchema.parse(filter));
}

export function promotionWhere(actor: BulkActor, filter: Record<string, unknown>) {
  return buildPromotionListWhere(actor, promotionListSchema.parse(filter), todayIsoDate());
}

export function attributionModelWhere(actor: BulkActor, filter: Record<string, unknown>): Prisma.MarketingAttributionModelWhereInput {
  return { companyId: actor.companyId, ...(filter.includeRetired ? {} : { status: { not: "RETIRED" } }) };
}

// ── Per entity ───────────────────────────────────────────────────

interface Meta {
  label: string;
  pluralLabel: string;
  path: string;
  view: { module: "sales_marketing" | "sales_quotations" | "marketing_campaigns" | "marketing_promotions" | "marketing_attribution"; action: "view" };
  parse: (sp: URLSearchParams) => Record<string, unknown>;
  resolve: (actor: BulkActor, filter: Record<string, unknown>, limit: number) => Promise<{ ids: string[]; total: number }>;
  visible: (actor: BulkActor, ids: string[]) => Promise<Set<string>>;
  labels: (companyId: string, ids: string[]) => Promise<Map<string, string>>;
}

const searchOf = (sp: URLSearchParams) => (sp.get("search")?.trim() ? { search: sp.get("search")!.trim().slice(0, 100) } : {});

const META: Record<SmBulkEntityKey, Meta> = {
  ENQUIRY: {
    label: "Enquiry",
    pluralLabel: "Enquiries",
    path: "/sales-marketing/enquiries",
    view: { module: "sales_marketing", action: "view" },
    parse: (sp) => ({ ...salesEnquiryListFilterSchema.parse(pick(salesEnquiryListFilterSchema, sp)), ...searchOf(sp) }),
    resolve: async (actor, filter, limit) => {
      const where = await enquiryWhere(actor, filter);
      const [rows, total] = await Promise.all([prisma.buyerEnquiry.findMany({ where, orderBy: [{ enquiryDate: "desc" }, { createdAt: "desc" }], select: { id: true }, take: limit }), prisma.buyerEnquiry.count({ where })]);
      return { ids: rows.map((r) => r.id), total };
    },
    visible: async (actor, ids) => {
      const scope = await getSalesEnquiryScope(actor);
      return inChunks(ids, (chunk) => prisma.buyerEnquiry.findMany({ where: enquiryScopedWhere(actor, scope, { id: { in: chunk } }), select: { id: true } }));
    },
    labels: async (companyId, ids) => {
      const rows = await prisma.buyerEnquiry.findMany({ where: { companyId, id: { in: ids } }, select: { id: true, enquiryNumber: true, subject: true, prospectName: true, customer: { select: { name: true } } } });
      return new Map(rows.map((r) => [r.id, `${r.enquiryNumber} · ${r.subject || r.customer?.name || r.prospectName || "—"}`]));
    },
  },
  QUOTATION: {
    label: "Quotation",
    pluralLabel: "Quotations",
    path: "/sales-marketing/quotations",
    view: { module: "sales_quotations", action: "view" },
    parse: (sp) => ({ ...quotationListFilterSchema.parse(pick(quotationListFilterSchema, sp)), ...searchOf(sp) }),
    resolve: async (actor, filter, limit) => {
      const where = await quotationWhere(actor, filter);
      const [rows, total] = await Promise.all([prisma.quotation.findMany({ where, orderBy: { createdAt: "desc" }, select: { id: true }, take: limit }), prisma.quotation.count({ where })]);
      return { ids: rows.map((r) => r.id), total };
    },
    visible: async (actor, ids) => {
      const scope = await getQuotationScope(actor);
      return inChunks(ids, (chunk) => prisma.quotation.findMany({ where: quotationScopedWhere(actor, scope, { id: { in: chunk } }), select: { id: true } }));
    },
    labels: async (companyId, ids) => {
      const rows = await prisma.quotation.findMany({ where: { companyId, id: { in: ids } }, select: { id: true, quotationNumber: true, prospectName: true, customer: { select: { name: true } } } });
      return new Map(rows.map((r) => [r.id, `${r.quotationNumber} · ${r.customer?.name || r.prospectName || "—"}`]));
    },
  },
  CAMPAIGN: {
    label: "Campaign",
    pluralLabel: "Campaigns",
    path: "/sales-marketing/campaigns",
    view: { module: "marketing_campaigns", action: "view" },
    parse: (sp) => listCampaignsSchema.parse(pick(listCampaignsSchema, sp)),
    resolve: async (actor, filter, limit) => {
      const where = await campaignWhere(actor, filter);
      const [rows, total] = await Promise.all([prisma.marketingCampaign.findMany({ where, orderBy: [{ plannedStartDate: "desc" }, { code: "asc" }], select: { id: true }, take: limit }), prisma.marketingCampaign.count({ where })]);
      return { ids: rows.map((r) => r.id), total };
    },
    visible: async (actor, ids) => {
      const scope = await getCampaignScope(actor);
      return inChunks(ids, (chunk) => prisma.marketingCampaign.findMany({ where: { AND: [campaignScopeWhere(actor, scope), { id: { in: chunk } }] }, select: { id: true } }));
    },
    labels: async (companyId, ids) => {
      const rows = await prisma.marketingCampaign.findMany({ where: { companyId, id: { in: ids } }, select: { id: true, code: true, name: true } });
      return new Map(rows.map((r) => [r.id, `${r.code} · ${r.name}`]));
    },
  },
  PROMOTION: {
    label: "Promotion",
    pluralLabel: "Promotions",
    path: "/sales-marketing/promotions",
    view: { module: "marketing_promotions", action: "view" },
    parse: (sp) => promotionListSchema.parse(pick(promotionListSchema, sp)),
    resolve: async (actor, filter, limit) => {
      const where = promotionWhere(actor, filter);
      const [rows, total] = await Promise.all([prisma.marketingPromotion.findMany({ where, orderBy: { updatedAt: "desc" }, select: { id: true }, take: limit }), prisma.marketingPromotion.count({ where })]);
      return { ids: rows.map((r) => r.id), total };
    },
    // Promotions are company-wide records (no owner scope): visible = this company's.
    visible: (actor, ids) => inChunks(ids, (chunk) => prisma.marketingPromotion.findMany({ where: { companyId: actor.companyId, id: { in: chunk } }, select: { id: true } })),
    labels: async (companyId, ids) => {
      const rows = await prisma.marketingPromotion.findMany({ where: { companyId, id: { in: ids } }, select: { id: true, code: true, name: true } });
      return new Map(rows.map((r) => [r.id, `${r.code} · ${r.name}`]));
    },
  },
  ATTRIBUTION_MODEL: {
    label: "Attribution model",
    pluralLabel: "Attribution models",
    path: "/sales-marketing/attribution/models",
    view: { module: "marketing_attribution", action: "view" },
    // The models list's own switch is ?all=1 ("Show retired models").
    parse: (sp) => (["1", "true"].includes(sp.get("all") ?? "") || ["1", "true"].includes(sp.get("includeRetired") ?? "") ? { includeRetired: true } : {}),
    resolve: async (actor, filter, limit) => {
      const where = attributionModelWhere(actor, filter);
      const [rows, total] = await Promise.all([prisma.marketingAttributionModel.findMany({ where, orderBy: [{ isDefault: "desc" }, { name: "asc" }], select: { id: true }, take: limit }), prisma.marketingAttributionModel.count({ where })]);
      return { ids: rows.map((r) => r.id), total };
    },
    visible: (actor, ids) => inChunks(ids, (chunk) => prisma.marketingAttributionModel.findMany({ where: { companyId: actor.companyId, id: { in: chunk } }, select: { id: true } })),
    labels: async (companyId, ids) => {
      const rows = await prisma.marketingAttributionModel.findMany({ where: { companyId, id: { in: ids } }, select: { id: true, code: true, name: true } });
      return new Map(rows.map((r) => [r.id, `${r.code} · ${r.name}`]));
    },
  },
};

export function smBulkEntity(entityType: SmBulkEntityKey): BulkEntityDefinition {
  const m = META[entityType];
  return {
    entityType,
    label: m.label,
    pluralLabel: m.pluralLabel,
    viewPermission: m.view,
    adminPermission: SM_ADMIN,
    parseFilterQuery: (query) => m.parse(params(query)),
    resolveFilterIds: (actor, filter, limit) => m.resolve(actor, filter, limit),
    visibleIds: (actor, ids) => (ids.length ? m.visible(actor, ids) : Promise.resolve(new Set())),
    recordLabels: (companyId, ids) => (ids.length ? m.labels(companyId, ids) : Promise.resolve(new Map())),
    recordHref: (id) => `${m.path}/${id}`,
    listHref: m.path,
  };
}
