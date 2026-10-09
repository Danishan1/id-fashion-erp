import type { Prisma } from "@prisma/client";
import { businessDayRange } from "../core/crm-dates";
import { crmOwnerWhere, type CrmRecordScope } from "../core/crm-visibility";
import type { CompanyFilter, CompanySortField } from "./company.schema";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const contains = (v: string) => ({ contains: v, mode: "insensitive" as const });

/**
 * The single translation from a CompanyFilter (API query, saved view, later
 * Smart List) to a Prisma `where`. Company scoping, record visibility and
 * "merged companies are never listed" are always applied here.
 */
export function buildCompanyWhere(companyId: string, filter: CompanyFilter, scope: CrmRecordScope, tagMatchedIds?: string[]): Prisma.CrmCompanyWhereInput {
  const and: Prisma.CrmCompanyWhereInput[] = [{ companyId }, { mergedIntoId: null }];
  const visibility = crmOwnerWhere(scope);
  if (Object.keys(visibility).length) and.push(visibility as Prisma.CrmCompanyWhereInput);

  if (filter.archived === "exclude") and.push({ archivedAt: null });
  else if (filter.archived === "only") and.push({ archivedAt: { not: null } });

  const term = filter.search?.trim().toLowerCase();
  if (term) {
    const digits = term.replace(/\D/g, "");
    and.push({
      OR: [
        { searchText: { contains: term } },
        // ERP customer code typed exactly (also covered by search text once linked)
        { customer: { code: { equals: term, mode: "insensitive" } } },
        ...(UUID_RE.test(term) ? [{ id: term }] : []),
        ...(digits.length >= 4 && digits.length === term.replace(/[\s()+.-]/g, "").length ? [{ phoneKeys: { has: digits.slice(-10) } }] : []),
      ],
    });
  }
  if (filter.ownerUserIds?.length || filter.unassigned) {
    and.push({ OR: [...(filter.ownerUserIds?.length ? [{ ownerUserId: { in: filter.ownerUserIds } }] : []), ...(filter.unassigned ? [{ ownerUserId: null }] : [])] });
  }
  if (filter.statusIds?.length) and.push({ statusId: { in: filter.statusIds } });
  if (filter.sourceIds?.length) and.push({ sourceId: { in: filter.sourceIds } });
  if (filter.tagIds?.length) and.push({ id: { in: tagMatchedIds ?? [] } });
  if (filter.industry) and.push({ industry: contains(filter.industry) });
  if (filter.companyType) and.push({ companyType: contains(filter.companyType) });
  // Location: the company's headline location or any of its postal addresses.
  for (const field of ["city", "state", "country"] as const) {
    const v = filter[field];
    if (v) and.push({ OR: [{ [field]: contains(v) }, { addresses: { some: { [field]: contains(v) } } }] });
  }
  if (filter.erpCustomer === "linked") and.push({ customerId: { not: null } });
  if (filter.erpCustomer === "not_linked") and.push({ customerId: null });
  if (filter.fromLead === "yes") and.push({ sourceLeadId: { not: null } });
  if (filter.fromLead === "no") and.push({ sourceLeadId: null });
  if (filter.duplicateFlagged) and.push({ duplicateFlaggedAt: { not: null } });
  for (const field of ["createdAt", "updatedAt", "lastActivityAt"] as const) {
    const range = businessDayRange(filter[field]);
    if (range) and.push({ [field]: range });
  }
  return { AND: and };
}

/** Whitelisted sort → Prisma orderBy; nullable columns sort empties last; id breaks ties for stable paging. */
export function buildCompanyOrderBy(sortBy: CompanySortField, sortOrder: "asc" | "desc"): Prisma.CrmCompanyOrderByWithRelationInput[] {
  const nullable: CompanySortField[] = ["lastActivityAt", "city", "industry"];
  const primary = nullable.includes(sortBy) ? { [sortBy]: { sort: sortOrder, nulls: "last" } } : { [sortBy]: sortOrder };
  return [primary as Prisma.CrmCompanyOrderByWithRelationInput, { id: sortOrder }];
}
