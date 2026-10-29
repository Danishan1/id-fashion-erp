import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/core/db/client";
import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { createNotification } from "@/core/notifications/NotificationService";
import { PermissionService } from "@/core/rbac/PermissionService";
import { round2 } from "@/lib/money";
import { toIsoDate } from "@/lib/date";
import { convertUomQuantity } from "@/lib/uom-conversion";
import { linkErpDocument } from "@/modules/crm/opportunities/crm-opportunity-erp.service";
import { createSalesOrder } from "@/modules/sales-orders/sales-order.service";
import { salesOrderSchema } from "@/modules/sales-orders/sales-order.schema";
import { markEnquiryWon, type SalesActor } from "@/modules/sales-marketing/enquiries/sales-enquiry.service";
import { getQuotation, loadVisible, recordQuotationEvent } from "./quotation.service";

/**
 * Accepted quotation → Sales Order (Sales & Marketing Release 1 / S4, 2026-10-29).
 *
 * The order is created by the existing `createSalesOrder()` (no second order
 * module). The user completes the colour × size split on the normal Sales
 * Order form; everything else comes from the accepted revision:
 *   - customer / buyer: the quotation's (a prospect must be linked to a real Customer first)
 *   - one order item per quotation line, in the same order
 *   - Style: the line's Style; a Design line uses its sample's Style (or one
 *     picked now when the sample has none); a new-item line must be given one
 *   - quantity: the line quantity in pieces (converted from DZN etc. through
 *     the unit master); the size/colour split must add up to exactly that
 *   - unit price: the line's taxable value ÷ pieces, i.e. net of discount and
 *     before GST (Sales Orders carry no tax — the invoice adds it), to the paisa
 *   - customer PO number: the acceptance's customer reference; ship date: the
 *     earliest line delivery date (both editable)
 * Freight / other charges aren't carried (Sales Orders have no charge fields);
 * the order's note on each line names its quotation line.
 *
 * Idempotent: `sales_orders.source_quotation_revision_id` is unique, so a
 * retry or a second click can never make a second order; if an order already
 * exists for the revision, the quotation is simply brought in line with it.
 */

const convertSchema = salesOrderSchema.extend({
  // Same order as the quotation's lines.
  quotationLineIds: z.array(z.string().uuid()).min(1),
});

export interface ConversionLinePlan {
  quotationLineId: string;
  lineNumber: number;
  lineType: "STYLE" | "DESIGN" | "FREE_TEXT";
  description: string;
  colorSizeRemarks: string | null;
  /** Style to order: fixed for Style lines and designs with a Style; null = to be chosen. */
  productId: string | null;
  styleFixed: boolean;
  sampleRequestId: string | null;
  pieces: number | null;
  unitPrice: number | null;
  problem: string | null;
}

async function piecesUnit() {
  return prisma.unitOfMeasure.findFirst({ where: { code: "PCS" }, select: { id: true, baseUnitId: true, conversionFactor: true } });
}

/** Everything the convert screen and the conversion need: per line, what is fixed and what still blocks. */
export async function getConversionPlan(actor: SalesActor, id: string) {
  const quotation = await loadVisible(actor, id);
  const revision = await prisma.quotationRevision.findUniqueOrThrow({
    where: { quotationId_revisionNumber: { quotationId: quotation.id, revisionNumber: quotation.currentRevisionNumber } },
    include: {
      lines: { orderBy: { lineNumber: "asc" }, include: { uom: { select: { id: true, code: true, baseUnitId: true, conversionFactor: true } }, sampleRequest: { select: { productId: true } } } },
    },
  });
  const pcs = await piecesUnit();
  const existingOrder = await prisma.salesOrder.findFirst({
    where: { companyId: actor.companyId, sourceQuotationRevision: { quotationId: quotation.id } },
    select: { id: true, orderNumber: true, status: true, sourceQuotationRevisionId: true },
  });

  const lines: ConversionLinePlan[] = revision.lines.map((l) => {
    const qty = Number(l.quantity);
    let pieces: number | null = qty;
    if (l.uom && l.uom.code !== "PCS") pieces = pcs ? convertUomQuantity(qty, l.uom, pcs) : null;
    let problem: string | null = null;
    if (pieces === null) problem = `${l.uom?.code} can't be converted to pieces — set a conversion to PCS in the unit master or order it by hand.`;
    else if (Math.abs(pieces - Math.round(pieces)) > 1e-9) problem = `${qty} ${l.uom?.code ?? ""} is not a whole number of pieces.`;
    if (pieces !== null) pieces = Math.round(pieces * 1000) / 1000;
    const designStyle = l.lineType === "DESIGN" ? (l.sampleRequest?.productId ?? null) : null;
    const productId = l.lineType === "STYLE" ? l.productId : designStyle;
    return {
      quotationLineId: l.id,
      lineNumber: l.lineNumber,
      lineType: l.lineType,
      description: l.description,
      colorSizeRemarks: l.colorSizeRemarks,
      productId,
      styleFixed: Boolean(productId),
      sampleRequestId: l.sampleRequestId,
      pieces: problem ? null : pieces,
      unitPrice: problem || !pieces ? null : round2(Number(l.taxableAmount) / pieces),
      problem,
    };
  });

  const blockers: string[] = [];
  if (quotation.status !== "ACCEPTED") blockers.push(`Only an accepted quotation can be converted (this one is ${quotation.status.toLowerCase().replace(/_/g, " ")}).`);
  if (!quotation.customerId) blockers.push("This quotation is for a prospect — link a real Customer first.");
  for (const l of lines) if (l.problem) blockers.push(`Line ${l.lineNumber}: ${l.problem}`);

  const deliveries = revision.lines.map((l) => l.requestedDeliveryDate).filter((d): d is Date => Boolean(d));
  return {
    quotationId: quotation.id,
    quotationNumber: quotation.quotationNumber,
    revisionId: revision.id,
    revisionNumber: revision.revisionNumber,
    status: quotation.status,
    customerId: quotation.customerId,
    buyerId: quotation.buyerId,
    customerPoNumber: revision.customerReference,
    requiredShipDate: deliveries.length ? toIsoDate(new Date(Math.min(...deliveries.map((d) => d.getTime())))) : null,
    chargesNotCarried: Number(revision.freightAmount) + Number(revision.otherChargesAmount) > 0,
    lines,
    blockers,
    existingOrder,
  };
}

function lineNote(quotationNumber: string, revisionNumber: number, line: ConversionLinePlan) {
  return `${quotationNumber} rev ${revisionNumber} line ${line.lineNumber}: ${line.description}`.slice(0, 500);
}

/**
 * Brings the quotation (and its enquiry) in line with an order that exists for
 * its revision: CONVERTED, enquiry WON, timeline + audit, opportunity links.
 */
async function markConverted(actor: SalesActor, quotationId: string, order: { id: string; orderNumber: string }, revisionNumber: number) {
  const quotation = await prisma.quotation.findUniqueOrThrow({ where: { id: quotationId } });
  if (quotation.status === "CONVERTED") return;
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.quotation.updateMany({ where: { id: quotation.id, status: "ACCEPTED" }, data: { status: "CONVERTED" } });
    if (count === 0) return; // someone else finished it
    if (quotation.buyerEnquiryId) await markEnquiryWon(tx, actor, quotation.buyerEnquiryId, order.orderNumber, quotation.quotationNumber);
    await recordQuotationEvent(tx, actor, quotation, revisionNumber, "CONVERTED", null, { salesOrderId: order.id, orderNumber: order.orderNumber });
    await writeAuditLog(
      {
        companyId: actor.companyId,
        userId: actor.userId,
        tableName: "quotations",
        recordId: quotation.id,
        action: "UPDATE",
        oldValues: { status: "ACCEPTED" },
        newValues: { status: "CONVERTED", salesOrderId: order.id, orderNumber: order.orderNumber, revisionNumber },
      },
      tx
    );
    if (quotation.ownerUserId && quotation.ownerUserId !== actor.userId) {
      await createNotification(
        { companyId: actor.companyId, userId: quotation.ownerUserId, title: `Quotation ${quotation.quotationNumber} converted`, body: `Sales Order ${order.orderNumber} was created.`, relatedModule: "QUOTATION", relatedRecordId: quotation.id },
        tx
      );
    }
  });
  await linkToOpportunities(actor, quotation, order);
}

/**
 * Best effort, after the conversion is committed: the CRM opportunities the
 * enquiry is linked to also get the quotation and the order (CRM's own link
 * table and rules; needs crm.edit and the opportunity in the user's CRM scope).
 * A failure here never undoes the order — the links can be added from the CRM.
 */
async function linkToOpportunities(actor: SalesActor, quotation: { id: string; buyerEnquiryId: string | null }, order: { id: string }) {
  if (!quotation.buyerEnquiryId || !(await PermissionService.can(actor.userId, "crm", "edit"))) return { linked: 0 };
  const links = await prisma.crmOpportunityErpLink.findMany({ where: { companyId: actor.companyId, docType: "BUYER_ENQUIRY", docId: quotation.buyerEnquiryId }, select: { opportunityId: true } });
  let linked = 0;
  const crmActor = { companyId: actor.companyId, userId: actor.userId, branchId: actor.branchId ?? null };
  for (const { opportunityId } of links) {
    for (const doc of [
      { docType: "QUOTATION", docId: quotation.id },
      { docType: "SALES_ORDER", docId: order.id },
    ]) {
      try {
        await linkErpDocument(crmActor, opportunityId, doc);
        linked++;
      } catch {
        // already linked, opportunity archived / out of scope, branch access … — skip
      }
    }
  }
  return { linked };
}

export async function convertQuotationToSalesOrder(actor: SalesActor, id: string, raw: unknown) {
  await PermissionService.assert(actor.userId, "sales_orders", "create");
  const plan = await getConversionPlan(actor, id);

  // Already converted (retry / second click / earlier half-finished run): no
  // second order — the quotation is just brought in line (body not needed).
  if (plan.existingOrder) {
    await markConverted(actor, plan.quotationId, plan.existingOrder, plan.revisionNumber);
    return { salesOrderId: plan.existingOrder.id, orderNumber: plan.existingOrder.orderNumber, alreadyConverted: true };
  }
  if (plan.blockers.length) throw new BusinessRuleError("INVALID_STATE_TRANSITION", plan.blockers.join(" "), { blockers: plan.blockers });
  const input = convertSchema.parse(raw);

  if (input.quotationLineIds.length !== plan.lines.length || input.items.length !== plan.lines.length || plan.lines.some((l, i) => l.quotationLineId !== input.quotationLineIds[i])) {
    throw new BusinessRuleError("VALIDATION_ERROR", "Every quotation line must become exactly one order line, in the same order. Reload and try again.");
  }
  if (input.customerId !== plan.customerId) throw new BusinessRuleError("VALIDATION_ERROR", "The order must be for the quotation's customer.", { fieldErrors: { customerId: "Must match the quotation." } });
  if (plan.buyerId && input.buyerId !== plan.buyerId) throw new BusinessRuleError("VALIDATION_ERROR", "The order must be for the quotation's buyer.", { fieldErrors: { buyerId: "Must match the quotation." } });
  if (input.originatingOpportunityId) throw new BusinessRuleError("VALIDATION_ERROR", "A converted order is linked to its quotation, not created from an opportunity.");

  const items = plan.lines.map((line, i) => {
    const item = input.items[i];
    const at = (msg: string) => new BusinessRuleError("VALIDATION_ERROR", `Line ${line.lineNumber}: ${msg}`, { fieldErrors: { [`items.${i}`]: msg } });
    if (line.styleFixed && item.productId !== line.productId) throw at("the Style comes from the quotation and can't be changed here.");
    if ((item.sampleRequestId || null) !== (line.sampleRequestId ?? null) && line.sampleRequestId) throw at("the design comes from the quotation.");
    const pieces = item.breakdown.reduce((s, b) => s + b.orderedQuantity, 0);
    if (pieces !== line.pieces) throw at(`the colour / size quantities add up to ${pieces}, but the accepted quotation has ${line.pieces} pieces.`);
    return {
      ...item,
      sampleRequestId: line.sampleRequestId ?? item.sampleRequestId,
      // Price always from the accepted revision — never from the form.
      unitPrice: line.unitPrice!,
      notes: lineNote(plan.quotationNumber, plan.revisionNumber, line),
    };
  });

  let order: { id: string; orderNumber: string };
  try {
    order = await createSalesOrder(
      { companyId: actor.companyId, userId: actor.userId, branchId: actor.branchId ?? null },
      { ...input, buyerId: plan.buyerId ?? input.buyerId, items },
      { sourceQuotationRevisionId: plan.revisionId }
    );
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      // Lost a race with a concurrent conversion of the same revision.
      const existing = await prisma.salesOrder.findFirstOrThrow({ where: { companyId: actor.companyId, sourceQuotationRevisionId: plan.revisionId }, select: { id: true, orderNumber: true } });
      await markConverted(actor, plan.quotationId, existing, plan.revisionNumber);
      return { salesOrderId: existing.id, orderNumber: existing.orderNumber, alreadyConverted: true };
    }
    throw error;
  }
  await markConverted(actor, plan.quotationId, order, plan.revisionNumber);
  return { salesOrderId: order.id, orderNumber: order.orderNumber, alreadyConverted: false };
}

// ── Prospect → Customer ──────────────────────────────────────────

const linkCustomerSchema = z.object({ customerId: z.string().uuid(), buyerId: z.string().uuid().optional().or(z.literal("")) }).strict();

/**
 * A prospect quotation that is issued or accepted gets its real Customer once
 * the prospect is created in Masters. Only fills an empty customer — never
 * re-points a quotation at someone else. The enquiry keeps its own link
 * (Merchandising's "link customer" handles that).
 */
export async function linkQuotationCustomer(actor: SalesActor, id: string, raw: unknown) {
  const input = linkCustomerSchema.parse(raw ?? {});
  const quotation = await loadVisible(actor, id);
  if (quotation.customerId) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This quotation already has a customer.");
  if (!["DRAFT", "PENDING_APPROVAL", "APPROVED", "ISSUED", "ACCEPTED"].includes(quotation.status)) {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", "A closed quotation can't be changed.");
  }
  const customer = await prisma.customer.findFirst({ where: { id: input.customerId, companyId: actor.companyId, deletedAt: null }, select: { id: true, name: true, buyers: { select: { id: true } } } });
  if (!customer) throw new BusinessRuleError("NOT_FOUND", "Customer not found.", { id: input.customerId });
  if (input.buyerId && !customer.buyers.some((b) => b.id === input.buyerId)) throw new BusinessRuleError("NOT_FOUND", "Buyer not found for this customer.", { id: input.buyerId });
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.quotation.updateMany({ where: { id: quotation.id, customerId: null }, data: { customerId: customer.id, buyerId: input.buyerId || null } });
    if (count === 0) throw new BusinessRuleError("RECORD_VERSION_CONFLICT", "This quotation changed just now. Reload and try again.");
    await recordQuotationEvent(tx, actor, quotation, quotation.currentRevisionNumber, "CUSTOMER_LINKED", `${quotation.prospectName ?? "Prospect"} → ${customer.name}`, { customerId: customer.id });
    await writeAuditLog(
      { companyId: actor.companyId, userId: actor.userId, tableName: "quotations", recordId: quotation.id, action: "UPDATE", oldValues: { customerId: null, prospectName: quotation.prospectName }, newValues: { customerId: customer.id, buyerId: input.buyerId || null } },
      tx
    );
  });
  return getQuotation(actor, id);
}

