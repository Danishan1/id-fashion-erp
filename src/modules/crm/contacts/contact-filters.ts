import type { Prisma } from "@prisma/client";
import { businessDayRange } from "../core/crm-dates";
import { crmOwnerWhere, type CrmRecordScope } from "../core/crm-visibility";
import type { ContactFilter, ContactSortField } from "./contact.schema";

/**
 * The single translation from a ContactFilter (API query, saved view, later
 * Smart List) to a Prisma `where`. Company scoping, record visibility and the
 * "merged contacts are never listed" rule are always applied here.
 * `tagMatchedIds` = contact ids carrying any of `filter.tagIds`.
 */
export function buildContactWhere(companyId: string, filter: ContactFilter, scope: CrmRecordScope, tagMatchedIds?: string[]): Prisma.CrmContactWhereInput {
  const and: Prisma.CrmContactWhereInput[] = [{ companyId }, { mergedIntoId: null }];
  const visibility = crmOwnerWhere(scope);
  if (Object.keys(visibility).length) and.push(visibility as Prisma.CrmContactWhereInput);

  if (filter.archived === "exclude") and.push({ archivedAt: null });
  else if (filter.archived === "only") and.push({ archivedAt: { not: null } });

  const term = filter.search?.trim().toLowerCase();
  if (term) {
    const digits = term.replace(/\D/g, "");
    and.push({
      OR: [{ searchText: { contains: term } }, ...(digits.length >= 4 ? [{ phoneKeys: { has: digits.slice(-10) } }] : [])],
    });
  }
  if (filter.ownerUserIds?.length || filter.unassigned) {
    and.push({
      OR: [...(filter.ownerUserIds?.length ? [{ ownerUserId: { in: filter.ownerUserIds } }] : []), ...(filter.unassigned ? [{ ownerUserId: null }] : [])],
    });
  }
  if (filter.sourceIds?.length) and.push({ sourceId: { in: filter.sourceIds } });
  if (filter.tagIds?.length) and.push({ id: { in: tagMatchedIds ?? [] } });
  if (filter.crmCompanyId) and.push({ crmCompanyId: filter.crmCompanyId });
  if (filter.companyName) and.push({ crmCompany: { name: { contains: filter.companyName, mode: "insensitive" } } });
  if (filter.designation) and.push({ designation: { contains: filter.designation, mode: "insensitive" } });
  if (filter.department) and.push({ department: { contains: filter.department, mode: "insensitive" } });
  if (filter.location) {
    const loc = filter.location;
    and.push({
      addresses: { some: { OR: [{ city: { contains: loc, mode: "insensitive" } }, { state: { contains: loc, mode: "insensitive" } }, { country: { contains: loc, mode: "insensitive" } }] } },
    });
  }
  if (filter.dndChannels?.length) {
    // Not contactable on a channel = a restriction on that channel or a contact-wide one.
    const channels = [...new Set([...filter.dndChannels, "ALL"])];
    and.push({ consents: { some: { channel: { in: channels }, status: { not: "ALLOWED" } } } });
  }
  if (filter.hasEmail === "yes") and.push({ NOT: { emailKeys: { isEmpty: true } } });
  if (filter.hasEmail === "no") and.push({ emailKeys: { isEmpty: true } });
  if (filter.hasPhone === "yes") and.push({ NOT: { phoneKeys: { isEmpty: true } } });
  if (filter.hasPhone === "no") and.push({ phoneKeys: { isEmpty: true } });
  if (filter.erpCustomer === "linked") and.push({ crmCompany: { customerId: { not: null } } });
  if (filter.erpCustomer === "not_linked") and.push({ OR: [{ crmCompanyId: null }, { crmCompany: { customerId: null } }] });
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
export function buildContactOrderBy(sortBy: ContactSortField, sortOrder: "asc" | "desc"): Prisma.CrmContactOrderByWithRelationInput[] {
  if (sortBy === "companyName") return [{ crmCompany: { name: sortOrder } }, { fullName: "asc" }, { id: sortOrder }];
  const primary = sortBy === "lastActivityAt" ? { lastActivityAt: { sort: sortOrder, nulls: "last" as const } } : { [sortBy]: sortOrder };
  return [primary as Prisma.CrmContactOrderByWithRelationInput, { id: sortOrder }];
}
