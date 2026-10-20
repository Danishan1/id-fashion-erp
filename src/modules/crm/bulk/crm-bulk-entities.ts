import type { Prisma } from "@prisma/client";
import { prisma } from "@/core/db/client";
import type { BulkActor, BulkEntityDefinition } from "@/modules/bulk-actions/bulk-types";
import { buildCompanyOrderBy, buildCompanyWhere } from "../companies/company-filters";
import { companyFilterSchema, parseCompanyFilterParams } from "../companies/company.schema";
import { buildContactOrderBy, buildContactWhere } from "../contacts/contact-filters";
import { contactFilterSchema, parseContactFilterParams } from "../contacts/contact.schema";
import { getCrmRecordScope } from "../core/crm-visibility";
import { buildLeadOrderBy, buildLeadWhere } from "../leads/lead-filters";
import { leadFilterSchema, parseLeadFilterParams } from "../leads/lead.schema";
import { buildOpportunityOrderBy, buildOpportunityWhere } from "../opportunities/opportunity-filters";
import { opportunityFilterSchema, parseOpportunityFilterParams } from "../opportunities/opportunity.schema";

/**
 * Phase 14 — the CRM's record types in the bulk engine. Filters are the list
 * pages' own query strings, parsed by the same parse*FilterParams and turned
 * into Prisma `where` by the same build*Where the list API uses — so "all
 * records matching the current filters" is exactly what the user sees in the
 * list, with the same record-visibility rule (crm.view vs crm.view_all) and
 * the same exclusion of merged contacts / companies.
 */

type CrmBulkEntityKey = "LEAD" | "CONTACT" | "COMPANY" | "OPPORTUNITY";

const CRM_VIEW = { module: "crm", action: "view" } as const;
const CRM_ADMIN = { module: "crm_settings", action: "edit" } as const;

async function tagMatched(companyId: string, entityType: CrmBulkEntityKey, tagIds: string[] | undefined) {
  if (!tagIds?.length) return undefined;
  const rows = await prisma.crmEntityTag.findMany({ where: { companyId, entityType, tagId: { in: tagIds } }, select: { entityId: true }, distinct: ["entityId"] });
  return rows.map((r) => r.entityId);
}

/** Where-builders per entity; each applies company scoping + visibility (+ merged exclusion) itself. */
export async function crmEntityWhere(actor: BulkActor, entityType: CrmBulkEntityKey, filter: Record<string, unknown>) {
  const scope = await getCrmRecordScope(actor);
  const tags = await tagMatched(actor.companyId, entityType, filter.tagIds as string[] | undefined);
  switch (entityType) {
    case "LEAD":
      return buildLeadWhere(actor.companyId, leadFilterSchema.parse(filter), scope, tags);
    case "CONTACT":
      return buildContactWhere(actor.companyId, contactFilterSchema.parse(filter), scope, tags);
    case "COMPANY":
      return buildCompanyWhere(actor.companyId, companyFilterSchema.parse(filter), scope, tags);
    case "OPPORTUNITY":
      return buildOpportunityWhere(actor.companyId, opportunityFilterSchema.parse(filter), scope, tags);
  }
}

/** Every record the actor may see among `ids` (archived included). */
export async function visibleCrmIds(actor: BulkActor, entityType: CrmBulkEntityKey, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const out = new Set<string>();
  for (let i = 0; i < ids.length; i += 1000) {
    const chunk = ids.slice(i, i + 1000);
    const base = await crmEntityWhere(actor, entityType, { archived: "include" });
    const where = { AND: [base, { id: { in: chunk } }] };
    const rows =
      entityType === "LEAD"
        ? await prisma.crmLead.findMany({ where: where as Prisma.CrmLeadWhereInput, select: { id: true } })
        : entityType === "CONTACT"
          ? await prisma.crmContact.findMany({ where: where as Prisma.CrmContactWhereInput, select: { id: true } })
          : entityType === "COMPANY"
            ? await prisma.crmCompany.findMany({ where: where as Prisma.CrmCompanyWhereInput, select: { id: true } })
            : await prisma.crmOpportunity.findMany({ where: where as Prisma.CrmOpportunityWhereInput, select: { id: true } });
    rows.forEach((r) => out.add(r.id));
  }
  return out;
}

async function resolveIds(actor: BulkActor, entityType: CrmBulkEntityKey, filter: Record<string, unknown>, limit: number) {
  const where = await crmEntityWhere(actor, entityType, filter);
  switch (entityType) {
    case "LEAD": {
      const w = where as Prisma.CrmLeadWhereInput;
      const [rows, total] = await Promise.all([prisma.crmLead.findMany({ where: w, orderBy: buildLeadOrderBy("createdAt", "desc"), select: { id: true }, take: limit }), prisma.crmLead.count({ where: w })]);
      return { ids: rows.map((r) => r.id), total };
    }
    case "CONTACT": {
      const w = where as Prisma.CrmContactWhereInput;
      const [rows, total] = await Promise.all([prisma.crmContact.findMany({ where: w, orderBy: buildContactOrderBy("createdAt", "desc"), select: { id: true }, take: limit }), prisma.crmContact.count({ where: w })]);
      return { ids: rows.map((r) => r.id), total };
    }
    case "COMPANY": {
      const w = where as Prisma.CrmCompanyWhereInput;
      const [rows, total] = await Promise.all([prisma.crmCompany.findMany({ where: w, orderBy: buildCompanyOrderBy("createdAt", "desc"), select: { id: true }, take: limit }), prisma.crmCompany.count({ where: w })]);
      return { ids: rows.map((r) => r.id), total };
    }
    case "OPPORTUNITY": {
      const w = where as Prisma.CrmOpportunityWhereInput;
      const [rows, total] = await Promise.all([prisma.crmOpportunity.findMany({ where: w, orderBy: buildOpportunityOrderBy("createdAt", "desc"), select: { id: true }, take: limit }), prisma.crmOpportunity.count({ where: w })]);
      return { ids: rows.map((r) => r.id), total };
    }
  }
}

async function labels(entityType: CrmBulkEntityKey, companyId: string, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!ids.length) return out;
  const where = { companyId, id: { in: ids } };
  if (entityType === "LEAD") (await prisma.crmLead.findMany({ where, select: { id: true, leadNumber: true, fullName: true } })).forEach((r) => out.set(r.id, `${r.leadNumber} · ${r.fullName}`));
  if (entityType === "CONTACT") (await prisma.crmContact.findMany({ where, select: { id: true, fullName: true } })).forEach((r) => out.set(r.id, r.fullName));
  if (entityType === "COMPANY") (await prisma.crmCompany.findMany({ where, select: { id: true, name: true } })).forEach((r) => out.set(r.id, r.name));
  if (entityType === "OPPORTUNITY") (await prisma.crmOpportunity.findMany({ where, select: { id: true, opportunityNumber: true, name: true } })).forEach((r) => out.set(r.id, `${r.opportunityNumber} · ${r.name}`));
  return out;
}

const PARSERS: Record<CrmBulkEntityKey, (sp: URLSearchParams) => Record<string, unknown>> = {
  LEAD: parseLeadFilterParams,
  CONTACT: parseContactFilterParams,
  COMPANY: parseCompanyFilterParams,
  OPPORTUNITY: parseOpportunityFilterParams,
};

const META: Record<CrmBulkEntityKey, { label: string; pluralLabel: string; path: string }> = {
  LEAD: { label: "Lead", pluralLabel: "Leads", path: "/crm/leads" },
  CONTACT: { label: "Contact", pluralLabel: "Contacts", path: "/crm/contacts" },
  COMPANY: { label: "Company", pluralLabel: "Companies", path: "/crm/companies" },
  OPPORTUNITY: { label: "Opportunity", pluralLabel: "Opportunities", path: "/crm/opportunities" },
};

export function crmBulkEntity(entityType: CrmBulkEntityKey): BulkEntityDefinition {
  const meta = META[entityType];
  return {
    entityType,
    label: meta.label,
    pluralLabel: meta.pluralLabel,
    viewPermission: CRM_VIEW,
    adminPermission: CRM_ADMIN,
    // Paging / sorting params in the query string are simply ignored by the parsers.
    parseFilterQuery: (query) => PARSERS[entityType](new URLSearchParams(query.replace(/^\?/, ""))),
    resolveFilterIds: (actor, filter, limit) => resolveIds(actor, entityType, filter, limit),
    visibleIds: (actor, ids) => visibleCrmIds(actor, entityType, ids),
    recordLabels: (companyId, ids) => labels(entityType, companyId, ids),
    recordHref: (id) => `${meta.path}/${id}`,
    listHref: meta.path,
  };
}

export const CRM_BULK_ENTITIES: CrmBulkEntityKey[] = ["LEAD", "CONTACT", "COMPANY", "OPPORTUNITY"];
export type { CrmBulkEntityKey };
