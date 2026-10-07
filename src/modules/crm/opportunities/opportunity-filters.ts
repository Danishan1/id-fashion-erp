import type { Prisma } from "@prisma/client";
import { addCalendarDays, businessDayRange, businessToday, calendarDateRange } from "../core/crm-dates";
import { crmOwnerWhere, type CrmRecordScope } from "../core/crm-visibility";
import type { OpportunityFilter, OpportunitySortField } from "./opportunity.schema";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** "Expected close" shortcuts. Only open opportunities are "due"; a past date never closes anything automatically. */
export function closeDueRange(due: NonNullable<OpportunityFilter["closeDue"]>, now: Date = new Date()): { from?: string; to?: string } {
  const today = businessToday(now);
  if (due === "overdue") return { to: addCalendarDays(today, -1) };
  if (due === "next_7_days") return { from: today, to: addCalendarDays(today, 7) };
  if (due === "next_30_days") return { from: today, to: addCalendarDays(today, 30) };
  const [y, m] = today.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${today.slice(0, 7)}-01`, to: `${today.slice(0, 7)}-${String(last).padStart(2, "0")}` };
}

/**
 * The single translation from an OpportunityFilter (API query, saved view,
 * later Smart List) to a Prisma `where`. Tenant scoping and record
 * visibility are always applied here.
 */
export function buildOpportunityWhere(companyId: string, filter: OpportunityFilter, scope: CrmRecordScope, tagMatchedIds?: string[], now: Date = new Date()): Prisma.CrmOpportunityWhereInput {
  const and: Prisma.CrmOpportunityWhereInput[] = [{ companyId }];
  const visibility = crmOwnerWhere(scope);
  if (Object.keys(visibility).length) and.push(visibility as Prisma.CrmOpportunityWhereInput);

  if (filter.archived === "exclude") and.push({ archivedAt: null });
  else if (filter.archived === "only") and.push({ archivedAt: { not: null } });

  const term = filter.search?.trim().toLowerCase();
  if (term) {
    const digits = term.replace(/\D/g, "");
    const phoneLike = digits.length >= 4 && digits.length === term.replace(/[\s()+.-]/g, "").length;
    and.push({
      OR: [
        // name, number and linked ERP document numbers
        { searchText: { contains: term } },
        // company: name / legal name / website / email / phone / city / ERP customer code
        { crmCompany: { searchText: { contains: term } } },
        // contact: name / emails / phones / designation
        { crmContact: { searchText: { contains: term } } },
        // owner name (Phase 08)
        { owner: { fullName: { contains: term, mode: "insensitive" } } },
        ...(UUID_RE.test(term) ? [{ id: term }] : []),
        ...(phoneLike ? [{ crmContact: { phoneKeys: { has: digits.slice(-10) } } }, { crmCompany: { phoneKeys: { has: digits.slice(-10) } } }] : []),
      ],
    });
  }
  if (filter.pipelineIds?.length) and.push({ pipelineId: { in: filter.pipelineIds } });
  if (filter.stageIds?.length) and.push({ stageId: { in: filter.stageIds } });
  if (filter.statuses?.length) and.push({ status: { in: filter.statuses } });
  if (filter.ownerUserIds?.length || filter.unassigned) {
    and.push({ OR: [...(filter.ownerUserIds?.length ? [{ ownerUserId: { in: filter.ownerUserIds } }] : []), ...(filter.unassigned ? [{ ownerUserId: null }] : [])] });
  }
  if (filter.crmCompanyIds?.length) and.push({ crmCompanyId: { in: filter.crmCompanyIds } });
  if (filter.crmContactIds?.length) and.push({ crmContactId: { in: filter.crmContactIds } });
  if (filter.sourceIds?.length) and.push({ sourceId: { in: filter.sourceIds } });
  if (filter.tagIds?.length) and.push({ id: { in: tagMatchedIds ?? [] } });
  if (filter.fromLead === "yes") and.push({ leadId: { not: null } });
  if (filter.fromLead === "no") and.push({ leadId: null });
  if (filter.closeDue) {
    and.push({ status: "OPEN" });
    and.push({ expectedCloseDate: calendarDateRange(closeDueRange(filter.closeDue, now)) });
  }
  const close = calendarDateRange(filter.expectedCloseDate);
  if (close) and.push({ expectedCloseDate: close });
  for (const field of ["createdAt", "updatedAt"] as const) {
    const range = businessDayRange(filter[field]);
    if (range) and.push({ [field]: range });
  }
  if (filter.amount && (filter.amount.min !== undefined || filter.amount.max !== undefined)) {
    and.push({ amount: { ...(filter.amount.min !== undefined ? { gte: filter.amount.min } : {}), ...(filter.amount.max !== undefined ? { lte: filter.amount.max } : {}) } });
  }
  if (filter.probability && (filter.probability.min !== undefined || filter.probability.max !== undefined)) {
    and.push({ probability: { ...(filter.probability.min !== undefined ? { gte: filter.probability.min } : {}), ...(filter.probability.max !== undefined ? { lte: filter.probability.max } : {}) } });
  }
  return { AND: and };
}

/** Whitelisted sort → Prisma orderBy; nullable columns sort empties last; id breaks ties for stable paging. */
export function buildOpportunityOrderBy(sortBy: OpportunitySortField, sortOrder: "asc" | "desc"): Prisma.CrmOpportunityOrderByWithRelationInput[] {
  if (sortBy === "stage") return [{ stage: { sortOrder } }, { id: sortOrder }];
  if (sortBy === "owner") return [{ owner: { fullName: sortOrder } }, { id: sortOrder }];
  const nullable: OpportunitySortField[] = ["amount", "probability", "expectedCloseDate", "lastActivityAt"];
  const primary = nullable.includes(sortBy) ? { [sortBy]: { sort: sortOrder, nulls: "last" } } : { [sortBy]: sortOrder };
  return [primary as Prisma.CrmOpportunityOrderByWithRelationInput, { id: sortOrder }];
}
