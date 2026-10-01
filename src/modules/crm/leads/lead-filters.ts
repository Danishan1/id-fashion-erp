import type { Prisma } from "@prisma/client";
import { businessDayRange } from "../core/crm-dates";
import { crmOwnerWhere, type CrmRecordScope } from "../core/crm-visibility";
import type { LeadFilter, LeadSortField } from "./lead.schema";

/**
 * The single translation from a LeadFilter (API query, saved view, later Smart
 * List) to a Prisma `where`. Company scoping and record visibility are always
 * applied here so no caller can forget them. `tagMatchedIds` is the set of
 * lead ids carrying any of `filter.tagIds` (resolved by the caller).
 */
export function buildLeadWhere(
  companyId: string,
  filter: LeadFilter,
  scope: CrmRecordScope,
  tagMatchedIds?: string[]
): Prisma.CrmLeadWhereInput {
  const and: Prisma.CrmLeadWhereInput[] = [{ companyId }];
  const visibility = crmOwnerWhere(scope);
  if (Object.keys(visibility).length) and.push(visibility as Prisma.CrmLeadWhereInput);

  if (filter.archived === "exclude") and.push({ archivedAt: null });
  else if (filter.archived === "only") and.push({ archivedAt: { not: null } });

  const term = filter.search?.trim().toLowerCase();
  if (term) {
    const digits = term.replace(/\D/g, "");
    and.push({
      OR: [
        { searchText: { contains: term } },
        ...(digits.length >= 4 ? [{ phoneKeys: { has: digits.slice(-10) } }] : []),
      ],
    });
  }
  if (filter.statusIds?.length) and.push({ statusId: { in: filter.statusIds } });
  if (filter.statusKinds?.length) and.push({ status: { kind: { in: filter.statusKinds } } });
  if (filter.sourceIds?.length) and.push({ sourceId: { in: filter.sourceIds } });
  if (filter.ownerUserIds?.length || filter.unassigned) {
    and.push({
      OR: [
        ...(filter.ownerUserIds?.length ? [{ ownerUserId: { in: filter.ownerUserIds } }] : []),
        ...(filter.unassigned ? [{ ownerUserId: null }] : []),
      ],
    });
  }
  if (filter.temperatures?.length) and.push({ temperature: { in: filter.temperatures } });
  if (filter.tagIds?.length) and.push({ id: { in: tagMatchedIds ?? [] } });
  if (filter.crmCompanyId) and.push({ crmCompanyId: filter.crmCompanyId });
  if (filter.crmContactId) and.push({ crmContactId: filter.crmContactId });
  if (filter.companyName) {
    and.push({
      OR: [
        { companyName: { contains: filter.companyName, mode: "insensitive" } },
        { crmCompany: { name: { contains: filter.companyName, mode: "insensitive" } } },
      ],
    });
  }
  if (filter.industry) and.push({ industry: { contains: filter.industry, mode: "insensitive" } });
  if (filter.location) {
    and.push({
      OR: ["city", "state", "country"].map((f) => ({ [f]: { contains: filter.location, mode: "insensitive" } })),
    });
  }
  if (filter.campaignSource) and.push({ campaignSource: { contains: filter.campaignSource, mode: "insensitive" } });
  if (filter.referralSource) and.push({ referralSource: { contains: filter.referralSource, mode: "insensitive" } });
  if (filter.score) and.push({ score: { ...(filter.score.min !== undefined ? { gte: filter.score.min } : {}), ...(filter.score.max !== undefined ? { lte: filter.score.max } : {}) } });
  if (filter.estimatedValue) {
    and.push({
      estimatedValue: {
        ...(filter.estimatedValue.min !== undefined ? { gte: filter.estimatedValue.min } : {}),
        ...(filter.estimatedValue.max !== undefined ? { lte: filter.estimatedValue.max } : {}),
      },
    });
  }
  for (const field of ["createdAt", "updatedAt", "lastContactedAt", "nextFollowUpAt"] as const) {
    const range = businessDayRange(filter[field]);
    if (range) and.push({ [field]: range });
  }
  return { AND: and };
}

/** Whitelisted sort → Prisma orderBy. Nullable columns sort their empties last; id breaks ties for stable paging. */
export function buildLeadOrderBy(sortBy: LeadSortField, sortOrder: "asc" | "desc"): Prisma.CrmLeadOrderByWithRelationInput[] {
  const nullable: LeadSortField[] = ["estimatedValue", "lastContactedAt", "nextFollowUpAt"];
  const primary = nullable.includes(sortBy) ? { [sortBy]: { sort: sortOrder, nulls: "last" } } : { [sortBy]: sortOrder };
  return [primary as Prisma.CrmLeadOrderByWithRelationInput, { id: sortOrder }];
}
