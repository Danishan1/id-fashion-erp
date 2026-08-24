import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { generateDocumentNumber } from "@/core/numbering/DocumentNumberingService";
import type { ListQuery } from "@/lib/list-query";
import type { DealStage, Prisma } from "@prisma/client";
import { DealRepository } from "./deal.repository";
import type { ActorContext } from "./lead.service";
import type { CreateDealInput, DealStageChangeInput, UpdateDealInput } from "./deal.schema";

/**
 * A real transition guard — the source lets a Deal jump between any of its
 * 5 stage strings with zero validation. This is a deliberate, flagged
 * improvement (migration report §7), matching this project's own standing
 * discipline of guarding every other status-driven document the same way.
 * WON/LOST are terminal — a deal that closes doesn't reopen; a genuinely
 * reopened deal is a new Deal, matching how this project treats every other
 * terminal-state document.
 */
const ALLOWED_TRANSITIONS: Record<DealStage, DealStage[]> = {
  QUALIFIED: ["PROPOSAL", "LOST"],
  PROPOSAL: ["NEGOTIATION", "LOST"],
  NEGOTIATION: ["WON", "LOST"],
  WON: [],
  LOST: [],
};

/** Computed, never stored — matches the source's own display-time-only
 * calculation exactly (value * probability / 100). */
export function computeWeightedValue(value: number | string | Prisma.Decimal, probabilityPercent: number | string | Prisma.Decimal): number {
  return (Number(value) * Number(probabilityPercent)) / 100;
}

function decorateDeal<T extends { value: Prisma.Decimal | number | string; probabilityPercent: Prisma.Decimal | number | string }>(deal: T) {
  return { ...deal, weightedValue: computeWeightedValue(deal.value, deal.probabilityPercent) };
}

export async function listDeals(companyId: string, query: ListQuery) {
  const where: Prisma.DealWhereInput = {
    companyId,
    ...(query.search ? { title: { contains: query.search, mode: "insensitive" as const } } : {}),
  };

  const [data, totalCount] = await Promise.all([
    DealRepository.findMany(where, { orderBy: { [query.sortBy]: query.sortOrder }, skip: query.skip, take: query.take }),
    DealRepository.count(where),
  ]);

  return { data: data.map(decorateDeal), totalCount };
}

export async function getDealById(companyId: string, id: string) {
  const deal = await DealRepository.findByIdWithDetails(companyId, id);
  if (!deal) throw new BusinessRuleError("NOT_FOUND", "Deal not found.", { id });
  return decorateDeal(deal);
}

export async function createDeal(actor: ActorContext, input: CreateDealInput) {
  const dealNumber = await generateDocumentNumber({
    companyId: actor.companyId,
    branchId: actor.branchId ?? null,
    documentType: "DEAL",
  });

  const deal = await DealRepository.create({
    companyId: actor.companyId,
    branchId: actor.branchId || null,
    dealNumber,
    title: input.title,
    leadId: input.leadId || null,
    customerId: input.customerId || null,
    value: input.value,
    probabilityPercent: input.probabilityPercent,
    assignedToUserId: input.assignedToUserId || null,
    salesAgentId: input.salesAgentId || null,
    expectedCloseDate: input.expectedCloseDate ? new Date(input.expectedCloseDate) : null,
    notes: input.notes || null,
    createdByUserId: actor.userId,
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "crm_deals",
    recordId: deal.id,
    action: "CREATE",
    newValues: { dealNumber, title: input.title, value: input.value },
  });

  return decorateDeal(deal);
}

export async function updateDeal(actor: ActorContext, id: string, input: UpdateDealInput) {
  const existing = await DealRepository.findAnyById(actor.companyId, id);
  if (!existing) throw new BusinessRuleError("NOT_FOUND", "Deal not found.", { id });
  if (existing.stage === "WON" || existing.stage === "LOST") {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", `Cannot edit a deal in "${existing.stage}" status.`, { currentStage: existing.stage });
  }

  const updated = await DealRepository.update(id, {
    title: input.title,
    leadId: input.leadId || null,
    customerId: input.customerId || null,
    value: input.value,
    probabilityPercent: input.probabilityPercent,
    assignedToUserId: input.assignedToUserId || null,
    salesAgentId: input.salesAgentId || null,
    expectedCloseDate: input.expectedCloseDate ? new Date(input.expectedCloseDate) : null,
    notes: input.notes || null,
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "crm_deals",
    recordId: id,
    action: "UPDATE",
    newValues: { title: input.title, value: input.value },
  });

  return decorateDeal(updated);
}

export async function changeDealStage(actor: ActorContext, id: string, input: DealStageChangeInput) {
  const existing = await DealRepository.findAnyById(actor.companyId, id);
  if (!existing) throw new BusinessRuleError("NOT_FOUND", "Deal not found.", { id });

  const allowed = ALLOWED_TRANSITIONS[existing.stage] ?? [];
  if (!allowed.includes(input.stage)) {
    throw new BusinessRuleError(
      "INVALID_STATE_TRANSITION",
      `Cannot move a deal from "${existing.stage}" to "${input.stage}".`,
      { from: existing.stage, to: input.stage }
    );
  }

  const updated = await DealRepository.update(id, {
    stage: input.stage,
    lostReason: input.stage === "LOST" ? input.lostReason || null : null,
    probabilityPercent: input.stage === "WON" ? 100 : input.stage === "LOST" ? 0 : existing.probabilityPercent,
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "crm_deals",
    recordId: id,
    action: "UPDATE",
    oldValues: { stage: existing.stage },
    newValues: { stage: input.stage, lostReason: input.lostReason || null },
  });

  return decorateDeal(updated);
}

/** Mirrors the source's eq_crm_sales_dashboard()/eq_crm_saas_sales() query:
 * per-salesperson lead count, open pipeline, and won revenue. */
export async function getSalesLeaderboard(companyId: string) {
  const users = await DealRepository.salesLeaderboard(companyId);
  return users
    .map((u) => {
      const pipeline = u.dealsAssigned.filter((d) => d.stage !== "WON" && d.stage !== "LOST").reduce((sum, d) => sum + Number(d.value), 0);
      const wonValue = u.dealsAssigned.filter((d) => d.stage === "WON").reduce((sum, d) => sum + Number(d.value), 0);
      return { userId: u.id, fullName: u.fullName, leadCount: u.leadsAssigned.length, pipeline, wonValue };
    })
    .sort((a, b) => b.wonValue - a.wonValue);
}
