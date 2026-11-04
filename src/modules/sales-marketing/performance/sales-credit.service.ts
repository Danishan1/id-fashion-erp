import type { Prisma, SalesCreditSource } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { PermissionService } from "@/core/rbac/PermissionService";
import type { SalesActor } from "@/modules/sales-marketing/enquiries/sales-enquiry.service";
import { auditPerformance, listPerformanceEvents, recordPerformanceEvent, toDbDate } from "./performance-common";
import { CREDIT_SOURCE_LABELS } from "./performance-registry";
import { assertEligibleRep } from "./territory.service";

/**
 * Sales credit on a Sales Order (Phase 05, PHASE_05 §3): one rep and at most
 * one territory, stored on the order when it is created so later changes to
 * owners or territories never rewrite history. Changeable afterwards with a
 * reason (sales_performance.edit).
 */

type Db = Prisma.TransactionClient | typeof prisma;

export interface SalesCredit {
  salesRepUserId: string;
  salesTerritoryId: string | null;
  salesCreditSource: SalesCreditSource;
}

/** Phase 07 / 08: an order converted from a quotation starts with the quotation's channel, sales agent and campaign. */
export async function resolveDefaultChannel(db: Db, companyId: string, sourceQuotationRevisionId: string | null | undefined) {
  if (!sourceQuotationRevisionId) return { salesChannelId: null, salesAgentId: null, campaignId: null };
  const rev = await db.quotationRevision.findFirst({ where: { id: sourceQuotationRevisionId, companyId }, select: { quotation: { select: { salesChannelId: true, salesAgentId: true, campaignId: true } } } });
  return { salesChannelId: rev?.quotation.salesChannelId ?? null, salesAgentId: rev?.quotation.salesAgentId ?? null, campaignId: rev?.quotation.campaignId ?? null };
}

/**
 * Default credit for a new order. Rep: the converted quotation's owner → the
 * owner of the CRM company linked to the customer → the territory's primary
 * rep in force on the order date → the order's creator. Territory: the
 * customer's active territory.
 */
export async function resolveDefaultSalesCredit(
  db: Db,
  companyId: string,
  input: { customerId: string; orderDate: string; sourceQuotationRevisionId?: string | null; creatorUserId: string }
): Promise<SalesCredit> {
  const customer = await db.customer.findFirst({
    where: { id: input.customerId, companyId },
    select: { salesTerritory: { select: { id: true, isActive: true } }, crmCompany: { select: { ownerUserId: true, owner: { select: { status: true } } } } },
  });
  const territoryId = customer?.salesTerritory?.isActive ? customer.salesTerritory.id : null;

  if (input.sourceQuotationRevisionId) {
    const rev = await db.quotationRevision.findFirst({ where: { id: input.sourceQuotationRevisionId, companyId }, select: { quotation: { select: { ownerUserId: true } } } });
    if (rev?.quotation.ownerUserId) return { salesRepUserId: rev.quotation.ownerUserId, salesTerritoryId: territoryId, salesCreditSource: "QUOTATION_OWNER" };
  }
  if (customer?.crmCompany?.ownerUserId && customer.crmCompany.owner?.status === "ACTIVE") {
    return { salesRepUserId: customer.crmCompany.ownerUserId, salesTerritoryId: territoryId, salesCreditSource: "CRM_OWNER" };
  }
  if (territoryId) {
    const day = toDbDate(input.orderDate);
    const primary = await db.salesTerritoryAssignment.findFirst({
      where: { territoryId, isPrimary: true, startDate: { lte: day }, OR: [{ endDate: null }, { endDate: { gte: day } }], user: { status: "ACTIVE" } },
      select: { userId: true },
    });
    if (primary) return { salesRepUserId: primary.userId, salesTerritoryId: territoryId, salesCreditSource: "TERRITORY_PRIMARY" };
  }
  return { salesRepUserId: input.creatorUserId, salesTerritoryId: territoryId, salesCreditSource: "CREATOR" };
}

/**
 * When an order's customer changes, credit that was never set by hand follows
 * the new customer (worked out again from the same rules); a hand-set credit
 * is left alone. Returns the fields to update, or null for no change.
 */
export async function creditAfterCustomerChange(
  db: Db,
  companyId: string,
  order: { salesCreditSource: SalesCreditSource | null; sourceQuotationRevisionId: string | null; requestedByUserId: string },
  input: { customerId: string; orderDate: string }
): Promise<SalesCredit | null> {
  if (order.salesCreditSource === "MANUAL") return null;
  return resolveDefaultSalesCredit(db, companyId, { ...input, sourceQuotationRevisionId: order.sourceQuotationRevisionId, creatorUserId: order.requestedByUserId });
}

export const salesCreditChangeSchema = z
  .object({
    salesRepUserId: z.string().uuid("Choose a sales rep"),
    salesTerritoryId: z.string().uuid().optional().or(z.literal("")).nullable(),
    reason: z.string().trim().min(3, "Say why").max(1000),
  })
  .strict();

export async function changeSalesCredit(actor: SalesActor, orderId: string, raw: unknown) {
  await PermissionService.assert(actor.userId, "sales_performance", "edit");
  const input = salesCreditChangeSchema.parse(raw);
  const order = await prisma.salesOrder.findFirst({
    where: { id: orderId, companyId: actor.companyId },
    select: { id: true, orderNumber: true, salesRepUserId: true, salesTerritoryId: true, salesCreditSource: true, salesRep: { select: { fullName: true } }, salesTerritory: { select: { name: true } } },
  });
  if (!order) throw new BusinessRuleError("NOT_FOUND", "Sales order not found.", { id: orderId });
  const territoryId = input.salesTerritoryId || null;
  if (order.salesRepUserId === input.salesRepUserId && order.salesTerritoryId === territoryId) {
    throw new BusinessRuleError("VALIDATION_ERROR", "Nothing changed — pick a different rep or territory.");
  }
  const rep = order.salesRepUserId === input.salesRepUserId ? { fullName: order.salesRep?.fullName ?? "" } : await assertEligibleRep(actor, input.salesRepUserId, "salesRepUserId");
  let territoryName: string | null = null;
  if (territoryId) {
    const t = await prisma.salesTerritory.findFirst({ where: { id: territoryId, companyId: actor.companyId }, select: { name: true, isActive: true } });
    if (!t) throw new BusinessRuleError("NOT_FOUND", "Territory not found.", { fieldErrors: { salesTerritoryId: "Not found." } });
    if (!t.isActive && territoryId !== order.salesTerritoryId) {
      throw new BusinessRuleError("VALIDATION_ERROR", "That territory is inactive.", { fieldErrors: { salesTerritoryId: "Inactive." } });
    }
    territoryName = t.name;
  }
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.salesOrder.updateMany({
      where: { id: order.id, companyId: actor.companyId, salesRepUserId: order.salesRepUserId, salesTerritoryId: order.salesTerritoryId },
      data: { salesRepUserId: input.salesRepUserId, salesTerritoryId: territoryId, salesCreditSource: "MANUAL", salesCreditChangedAt: new Date(), salesCreditChangedById: actor.userId, salesCreditReason: input.reason },
    });
    if (count === 0) throw new BusinessRuleError("RECORD_VERSION_CONFLICT", "The sales credit changed just now. Reload and try again.");
    const before = { rep: order.salesRep?.fullName ?? null, territory: order.salesTerritory?.name ?? null };
    const after = { rep: rep.fullName, territory: territoryName };
    await recordPerformanceEvent(tx, actor, "SALES_ORDER", order.id, "SALES_CREDIT_CHANGED", input.reason, { orderNumber: order.orderNumber, before, after });
    await auditPerformance(
      tx,
      actor,
      "sales_orders",
      order.id,
      "UPDATE",
      { salesRepUserId: order.salesRepUserId, salesTerritoryId: order.salesTerritoryId, salesCreditSource: order.salesCreditSource },
      { salesRepUserId: input.salesRepUserId, salesTerritoryId: territoryId, salesCreditSource: "MANUAL", reason: input.reason }
    );
  });
  return getSalesCredit(actor, orderId);
}

/** The order's credit for its detail page, with the change history. */
export async function getSalesCredit(actor: SalesActor, orderId: string) {
  const o = await prisma.salesOrder.findFirst({
    where: { id: orderId, companyId: actor.companyId },
    select: {
      id: true,
      salesRepUserId: true,
      salesTerritoryId: true,
      salesCreditSource: true,
      salesCreditChangedAt: true,
      salesCreditReason: true,
      salesRep: { select: { fullName: true } },
      salesTerritory: { select: { code: true, name: true } },
      salesCreditChangedBy: { select: { fullName: true } },
    },
  });
  if (!o) throw new BusinessRuleError("NOT_FOUND", "Sales order not found.", { id: orderId });
  return {
    salesRepUserId: o.salesRepUserId,
    salesRep: o.salesRep?.fullName ?? null,
    salesTerritoryId: o.salesTerritoryId,
    salesTerritory: o.salesTerritory ? `${o.salesTerritory.name} (${o.salesTerritory.code})` : null,
    source: o.salesCreditSource,
    sourceLabel: o.salesCreditSource ? CREDIT_SOURCE_LABELS[o.salesCreditSource] : null,
    changedAt: o.salesCreditChangedAt?.toISOString() ?? null,
    changedBy: o.salesCreditChangedBy?.fullName ?? null,
    reason: o.salesCreditReason,
    history: await listPerformanceEvents(prisma, actor.companyId, "SALES_ORDER", o.id),
  };
}
