import { Prisma, type CrmEntityType } from "@prisma/client";
import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import type { CrmActor } from "../core/crm-actor";
import { companyFilterSchema, COMPANY_SORT_FIELDS } from "../companies/company.schema";
import { contactFilterSchema, CONTACT_SORT_FIELDS } from "../contacts/contact.schema";
import { leadFilterSchema, LEAD_SORT_FIELDS } from "../leads/lead.schema";
import { opportunityFilterSchema, OPPORTUNITY_SORT_FIELDS } from "../opportunities/opportunity.schema";
import { CrmSavedViewRepository } from "./crm-saved-view.repository";
import { savedViewBaseSchema, updateSavedViewSchema } from "./crm-saved-view.schema";

/**
 * Saved list views (filters + sort + visible columns). A view stores the same
 * filter object the list API accepts, validated per entity type, so Smart
 * Lists (Phase 13) can adopt saved views unchanged. Private views are only
 * visible to their owner; shared views to everyone with CRM access (they are
 * still filtered by each viewer's own record visibility).
 */
const VALIDATORS: Partial<Record<CrmEntityType, { filters: (f: unknown) => unknown; sortFields: readonly string[] }>> = {
  LEAD: { filters: (f) => leadFilterSchema.parse(f), sortFields: LEAD_SORT_FIELDS },
  CONTACT: { filters: (f) => contactFilterSchema.parse(f), sortFields: CONTACT_SORT_FIELDS },
  COMPANY: { filters: (f) => companyFilterSchema.parse(f), sortFields: COMPANY_SORT_FIELDS },
  OPPORTUNITY: { filters: (f) => opportunityFilterSchema.parse(f), sortFields: OPPORTUNITY_SORT_FIELDS },
};

function validateFor(entityType: CrmEntityType, filters: unknown, sort: { sortBy: string } | null | undefined) {
  const v = VALIDATORS[entityType];
  if (!v) throw new BusinessRuleError("VALIDATION_ERROR", `Saved views are not available for ${entityType} yet.`);
  const cleaned = v.filters(filters);
  if (sort && !v.sortFields.includes(sort.sortBy)) throw new BusinessRuleError("VALIDATION_ERROR", `Can't sort by "${sort.sortBy}".`);
  return cleaned;
}

export async function listSavedViews(actor: CrmActor, entityType: CrmEntityType) {
  const views = await CrmSavedViewRepository.listVisible(actor.companyId, entityType, actor.userId);
  return views.map((v) => ({ ...v, isMine: v.ownerUserId === actor.userId }));
}

export async function createSavedView(actor: CrmActor, entityType: CrmEntityType, raw: unknown) {
  const input = savedViewBaseSchema.parse(raw);
  const filters = validateFor(entityType, input.filters, input.sort);
  const view = await CrmSavedViewRepository.create({
    companyId: actor.companyId,
    entityType,
    name: input.name,
    filters: filters as Prisma.InputJsonValue,
    sort: (input.sort ?? undefined) as Prisma.InputJsonValue | undefined,
    columns: (input.columns ?? undefined) as Prisma.InputJsonValue | undefined,
    visibility: input.visibility,
    ownerUserId: actor.userId,
  });
  await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName: "crm_saved_views", recordId: view.id, action: "CREATE", newValues: view });
  return { ...view, isMine: true };
}

async function loadOwned(actor: CrmActor, id: string) {
  const view = await CrmSavedViewRepository.findById(actor.companyId, id);
  if (!view || (view.ownerUserId !== actor.userId && view.visibility !== "SHARED")) throw new BusinessRuleError("NOT_FOUND", "Saved view not found.", { id });
  if (view.ownerUserId !== actor.userId) throw new BusinessRuleError("PERMISSION_DENIED", "Only the person who created this view can change it.");
  return view;
}

export async function updateSavedView(actor: CrmActor, id: string, raw: unknown) {
  const input = updateSavedViewSchema.parse(raw);
  const before = await loadOwned(actor, id);
  const filters = input.filters !== undefined ? validateFor(before.entityType, input.filters, input.sort ?? undefined) : undefined;
  if (input.filters === undefined && input.sort) validateFor(before.entityType, before.filters, input.sort);
  const view = await CrmSavedViewRepository.update(id, {
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(filters !== undefined ? { filters: filters as Prisma.InputJsonValue } : {}),
    ...(input.sort !== undefined ? { sort: input.sort ? (input.sort as Prisma.InputJsonValue) : Prisma.DbNull } : {}),
    ...(input.columns !== undefined ? { columns: input.columns ? (input.columns as Prisma.InputJsonValue) : Prisma.DbNull } : {}),

    ...(input.visibility !== undefined ? { visibility: input.visibility } : {}),
  });
  await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName: "crm_saved_views", recordId: id, action: "UPDATE", oldValues: before, newValues: view });
  return { ...view, isMine: true };
}

export async function deleteSavedView(actor: CrmActor, id: string) {
  const before = await loadOwned(actor, id);
  await CrmSavedViewRepository.delete(id);
  await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName: "crm_saved_views", recordId: id, action: "DELETE", oldValues: before });
}
