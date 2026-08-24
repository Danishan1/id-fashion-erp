import { writeAuditLog } from "@/core/audit/AuditLogger";
import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { generateDocumentNumber } from "@/core/numbering/DocumentNumberingService";
import type { ListQuery } from "@/lib/list-query";
import type { LeadPriority, Prisma } from "@prisma/client";
import { CrmRoundRobinRepository, LeadRepository } from "./lead.repository";
import type { CreateLeadInput, UpdateLeadInput } from "./lead.schema";

export interface ActorContext {
  companyId: string;
  userId: string;
  branchId?: string | null;
}

/** Deliberately NOT a stored column — see the Prisma schema's own comment on
 * LeadPriority. Same thresholds as the source (>=80 hot, >=50 warm, else
 * normal), computed fresh from leadScore every time so it can never drift. */
export function computeLeadPriority(leadScore: number | string | Prisma.Decimal): LeadPriority {
  const score = Number(leadScore);
  if (score >= 80) return "HOT";
  if (score >= 50) return "WARM";
  return "NORMAL";
}

function decorateLead<T extends { leadScore: Prisma.Decimal | number | string }>(lead: T) {
  return { ...lead, priority: computeLeadPriority(lead.leadScore) };
}

async function assertNoDuplicate(
  companyId: string,
  email: string | null,
  phone: string | null,
  excludeId: string | undefined,
  override: boolean | undefined
) {
  if (override) return;
  const dups = await LeadRepository.findDuplicates(companyId, email, phone, excludeId);
  if (dups.length > 0) {
    throw new BusinessRuleError(
      "DUPLICATE_LEAD_EXISTS",
      `A lead with this email or phone already exists: ${dups.map((d) => `${d.name} (${d.leadNumber})`).join(", ")}.`,
      { duplicates: dups }
    );
  }
}

/** A manual, low-frequency action (creating a lead) — a real stored pointer
 * advanced here is enough; the atomic-guarded-updateMany idiom used for hot
 * concurrent paths elsewhere in this project would be overkill here. */
async function getNextRoundRobinAssignee(companyId: string): Promise<string | null> {
  const users = await prisma.user.findMany({
    where: { companyId, status: "ACTIVE" },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  if (users.length === 0) return null;

  const state = await CrmRoundRobinRepository.findOrCreate(companyId);
  const ids = users.map((u) => u.id);
  const lastIndex = state.lastAssignedUserId ? ids.indexOf(state.lastAssignedUserId) : -1;
  const next = ids[(lastIndex + 1) % ids.length];
  await CrmRoundRobinRepository.updateLastAssigned(companyId, next);
  return next;
}

export async function listLeads(companyId: string, query: ListQuery) {
  const where: Prisma.LeadWhereInput = {
    companyId,
    ...(query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: "insensitive" as const } },
            { email: { contains: query.search, mode: "insensitive" as const } },
            { phone: { contains: query.search, mode: "insensitive" as const } },
            { companyName: { contains: query.search, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [data, totalCount] = await Promise.all([
    LeadRepository.findMany(where, { orderBy: { [query.sortBy]: query.sortOrder }, skip: query.skip, take: query.take }),
    LeadRepository.count(where),
  ]);

  return { data: data.map(decorateLead), totalCount };
}

export async function getLeadById(companyId: string, id: string) {
  const lead = await LeadRepository.findByIdWithDetails(companyId, id);
  if (!lead) throw new BusinessRuleError("NOT_FOUND", "Lead not found.", { id });
  return decorateLead(lead);
}

export async function createLead(actor: ActorContext, input: CreateLeadInput) {
  await assertNoDuplicate(actor.companyId, input.email || null, input.phone || null, undefined, input.overrideDuplicateCheck);

  const leadNumber = await generateDocumentNumber({
    companyId: actor.companyId,
    branchId: actor.branchId ?? null,
    documentType: "LEAD",
  });

  const assignedToUserId = input.assignedToUserId || (await getNextRoundRobinAssignee(actor.companyId));

  const lead = await LeadRepository.create({
    companyId: actor.companyId,
    branchId: actor.branchId || null,
    leadNumber,
    name: input.name,
    email: input.email || null,
    phone: input.phone || null,
    companyName: input.companyName || null,
    source: input.source,
    campaignId: input.campaignId || null,
    campaignText: input.campaignText || null,
    leadScore: input.leadScore,
    value: input.value,
    expectedCloseDate: input.expectedCloseDate ? new Date(input.expectedCloseDate) : null,
    assignedToUserId,
    notes: input.notes || null,
    createdByUserId: actor.userId,
  });

  // Auto follow-up on a brand-new lead — mirrors the source's own rule
  // exactly ("new/contacted lead with no existing follow-up gets one 24h
  // call reminder"), only ever meaningful at create time.
  await prisma.crmFollowup.create({
    data: {
      companyId: actor.companyId,
      relatedModule: "LEAD",
      relatedRecordId: lead.id,
      assignedToUserId,
      followupDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
      type: "CALL",
      status: "PENDING",
      notes: "Auto-created — first follow-up on a new lead.",
      createdByUserId: actor.userId,
    },
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "crm_leads",
    recordId: lead.id,
    action: "CREATE",
    newValues: { leadNumber, name: input.name, source: input.source },
  });

  return decorateLead(lead);
}

export async function updateLead(actor: ActorContext, id: string, input: UpdateLeadInput) {
  const existing = await LeadRepository.findAnyById(actor.companyId, id);
  if (!existing) throw new BusinessRuleError("NOT_FOUND", "Lead not found.", { id });

  await assertNoDuplicate(actor.companyId, input.email || null, input.phone || null, id, input.overrideDuplicateCheck);

  const updated = await LeadRepository.update(id, {
    name: input.name,
    email: input.email || null,
    phone: input.phone || null,
    companyName: input.companyName || null,
    source: input.source,
    campaignId: input.campaignId || null,
    campaignText: input.campaignText || null,
    leadScore: input.leadScore,
    status: input.status ?? existing.status,
    value: input.value,
    expectedCloseDate: input.expectedCloseDate ? new Date(input.expectedCloseDate) : null,
    assignedToUserId: input.assignedToUserId || null,
    notes: input.notes || null,
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "crm_leads",
    recordId: id,
    action: "UPDATE",
    oldValues: { status: existing.status, assignedToUserId: existing.assignedToUserId },
    newValues: { status: updated.status, assignedToUserId: updated.assignedToUserId },
  });

  return decorateLead(updated);
}
