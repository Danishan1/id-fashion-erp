import { writeAuditLog } from "@/core/audit/AuditLogger";
import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { advanceMasterCodeSequence, generateDocumentNumber } from "@/core/numbering/DocumentNumberingService";
import type { ListQuery } from "@/lib/list-query";
import { DealStage, type Prisma } from "@prisma/client";
import { CustomerRepository } from "@/modules/customers/customer.repository";
import { LeadRepository } from "./lead.repository";
import { ProductionConfigRepository } from "@/modules/production-config/production-config.repository";
import { DealRepository } from "./deal.repository";
import type { ActorContext } from "./lead.service";
import type { ConvertDealToCustomerInput, CreateDealInput, DealStageChangeInput, UpdateDealInput } from "./deal.schema";

/**
 * Tenant-scoped — `leadId`/`customerId`/`salesAgentId`/`assignedToUserId`
 * were previously written straight from client input with no ownership
 * check, unlike `convertDealToCustomer()`'s own `customerId` validation a
 * few functions below in this same file. Shared by createDeal/updateDeal so
 * both go through the identical check.
 */
async function assertDealReferencesInCompany(companyId: string, input: { leadId?: string | null; customerId?: string | null; salesAgentId?: string | null; assignedToUserId?: string | null }) {
  if (input.leadId) {
    const lead = await LeadRepository.findAnyById(companyId, input.leadId);
    if (!lead) throw new BusinessRuleError("NOT_FOUND", "Lead not found.", { id: input.leadId });
  }
  if (input.customerId) {
    const customer = await CustomerRepository.findByIdWithBuyers(companyId, input.customerId);
    if (!customer) throw new BusinessRuleError("NOT_FOUND", "Customer not found.", { id: input.customerId });
  }
  if (input.salesAgentId) {
    const agent = await ProductionConfigRepository.salesAgent.findFirst({ where: { id: input.salesAgentId, companyId } });
    if (!agent) throw new BusinessRuleError("NOT_FOUND", "Sales agent not found.", { id: input.salesAgentId });
  }
  if (input.assignedToUserId) {
    const user = await prisma.user.findFirst({ where: { id: input.assignedToUserId, companyId } });
    if (!user) throw new BusinessRuleError("NOT_FOUND", "User not found.", { id: input.assignedToUserId });
  }
}

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

const VALID_DEAL_STAGES = new Set<string>(Object.values(DealStage));

export async function listDeals(companyId: string, query: ListQuery) {
  const where: Prisma.DealWhereInput = {
    companyId,
    ...(query.search ? { title: { contains: query.search, mode: "insensitive" as const } } : {}),
    ...(query.status && VALID_DEAL_STAGES.has(query.status) ? { stage: query.status as DealStage } : {}),
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
  await assertDealReferencesInCompany(actor.companyId, input);

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

  await assertDealReferencesInCompany(actor.companyId, input);

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

  // Every stage move — whether via the detail page's buttons or the pipeline
  // board's drag-and-drop — leaves a real activity-timeline entry, not just
  // a silent audit-log row, so the timeline reads as a full history of what
  // happened to the deal.
  await prisma.crmActivity.create({
    data: {
      companyId: actor.companyId,
      relatedModule: "DEAL",
      relatedRecordId: id,
      activityType: "NOTE",
      subject: `Stage changed: ${existing.stage} → ${input.stage}`,
      body: input.stage === "LOST" ? input.lostReason || null : null,
      performedByUserId: actor.userId,
    },
  });

  return decorateDeal(updated);
}

/**
 * Closes the Deal→Customer gap flagged in the CRM/Marketing enhancement
 * audit: `Deal.customerId` already existed as a plain manual link, but
 * nothing guided a WON deal into a real Customer record. Only legal once a
 * deal is WON and not already linked — both checked before the transaction
 * even opens, so a doomed call never touches the DB. The actual Customer
 * duplicate-check + create/link + Deal update happen in one transaction so a
 * mid-write failure never leaves a half-created Customer dangling with no
 * Deal pointing at it.
 */
export async function convertDealToCustomer(actor: ActorContext, dealId: string, input: ConvertDealToCustomerInput) {
  const deal = await DealRepository.findAnyById(actor.companyId, dealId);
  if (!deal) throw new BusinessRuleError("NOT_FOUND", "Deal not found.", { id: dealId });
  if (deal.stage !== "WON") {
    throw new BusinessRuleError(
      "INVALID_STATE_TRANSITION",
      `A deal can only be converted to a Customer once it is Won (current stage: "${deal.stage}").`,
      { stage: deal.stage }
    );
  }
  if (deal.customerId) {
    throw new BusinessRuleError("REFERENCED_RECORD_IN_USE", "This deal is already linked to a customer.", { customerId: deal.customerId });
  }

  const { customer } = await prisma.$transaction(async (tx) => {
    if (input.mode === "LINK") {
      const existing = await tx.customer.findFirst({ where: { id: input.customerId, companyId: actor.companyId, deletedAt: null } });
      if (!existing) throw new BusinessRuleError("NOT_FOUND", "Customer not found.", { id: input.customerId });

      await tx.deal.update({ where: { id: dealId }, data: { customerId: existing.id } });
      await tx.crmActivity.create({
        data: {
          companyId: actor.companyId,
          relatedModule: "DEAL",
          relatedRecordId: dealId,
          activityType: "NOTE",
          subject: "Linked to existing Customer",
          body: `${existing.name} (${existing.code})`,
          performedByUserId: actor.userId,
        },
      });
      return { customer: existing };
    }

    if (!input.overrideDuplicateCheck) {
      const duplicate = await tx.customer.findFirst({
        where: { companyId: actor.companyId, deletedAt: null, name: { equals: input.name, mode: "insensitive" } },
      });
      if (duplicate) {
        throw new BusinessRuleError(
          "DUPLICATE_CUSTOMER_EXISTS",
          `A customer named "${duplicate.name}" already exists (${duplicate.code}). Link to it instead, or confirm you want to create a new, separate customer.`,
          { existingCustomerId: duplicate.id, existingCustomerName: duplicate.name, existingCustomerCode: duplicate.code }
        );
      }
    }

    const codeInUse = await tx.customer.findFirst({ where: { companyId: actor.companyId, code: input.code, deletedAt: null } });
    if (codeInUse) {
      throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `Customer code "${input.code}" is already in use.`, { code: input.code });
    }

    const created = await tx.customer.create({
      data: {
        companyId: actor.companyId,
        code: input.code,
        name: input.name,
        type: input.type,
        country: input.country || null,
        isActive: true,
      },
    });

    await tx.deal.update({ where: { id: dealId }, data: { customerId: created.id } });
    await tx.crmActivity.create({
      data: {
        companyId: actor.companyId,
        relatedModule: "DEAL",
        relatedRecordId: dealId,
        activityType: "NOTE",
        subject: "Converted to new Customer",
        body: `${created.name} (${created.code})`,
        performedByUserId: actor.userId,
      },
    });

    return { customer: created };
  });

  if (input.mode === "CREATE") {
    await advanceMasterCodeSequence(actor.companyId, "CUSTOMER");

    // Marketing automation trigger: "Deal Won -> Customer Created -> Welcome
    // Campaign" from the request's own example list. The "Welcome Campaign"
    // half is deliberately NOT an actual Campaign enrollment — Campaign has
    // no audience/targeting concept to attach a customer to, and building one
    // would be a much larger, separate feature. This creates the real,
    // achievable equivalent: a follow-up task prompting a human to actually
    // send the welcome outreach. Scoped to CREATE only (a genuinely brand-new
    // customer) — LINK reuses an existing, already-known customer, so a
    // "welcome" message wouldn't make sense there.
    await prisma.crmFollowup.create({
      data: {
        companyId: actor.companyId,
        relatedModule: "CUSTOMER",
        relatedRecordId: customer.id,
        followupDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
        type: "EMAIL",
        priority: "MEDIUM",
        notes: `Auto-created — send welcome outreach to ${customer.name}, converted from Deal.`,
        createdByUserId: actor.userId,
      },
    });
  }

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "crm_deals",
    recordId: dealId,
    action: "UPDATE",
    oldValues: { customerId: null },
    newValues: { customerId: customer.id, conversionMode: input.mode },
  });

  const updated = await DealRepository.findByIdWithDetails(actor.companyId, dealId);
  return decorateDeal(updated!);
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
