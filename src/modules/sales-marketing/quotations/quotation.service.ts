import { Prisma, type QuotationStatus } from "@prisma/client";
import { prisma } from "@/core/db/client";
import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { createNotification } from "@/core/notifications/NotificationService";
import { generateDocumentNumber } from "@/core/numbering/DocumentNumberingService";
import { PermissionService } from "@/core/rbac/PermissionService";
import { getTeamScope } from "@/core/hierarchy/team-scope";
import { extractStateCodeFromGstin } from "@/lib/gst";
import { toIsoDate, todayIsoDate } from "@/lib/date";
import { crmOwnerWhere, type CrmRecordScope } from "@/modules/crm/core/crm-visibility";
import {
  assertCrmLinks,
  loadEnquiryForQuotation,
  markEnquiryQuotationStarted,
  type SalesActor,
} from "@/modules/sales-marketing/enquiries/sales-enquiry.service";
import { calculateQuotation } from "./quotation-calc";
import { OPEN_QUOTATION_STATUSES, QUOTATION_STATUS_KEYS, isQuotationExpired, type QuotationEventType, type QuotationSortField } from "./quotation-registry";
import { approvalReasons } from "./quotation-approval";
import { getSalesMarketingSettings } from "@/modules/sales-marketing/settings/sales-marketing-settings.service";
import {
  quotationCreateSchema,
  quotationUpdateSchema,
  type QuotationCreateInput,
  type QuotationLineInput,
  type QuotationListFilter,
} from "./quotation.schema";

/**
 * Quotations core (Sales & Marketing Release 1 / S2, 2026-10-28).
 *
 * A quotation is created as a DRAFT revision 1 and edited in place while it is
 * a draft. Every amount is recomputed here by quotation-calc.ts — nothing the
 * client sends as a total is stored. GST rates come from the Tax Rate master
 * (effective on the quotation date) and are frozen on the line; CGST+SGST vs
 * IGST follows company GSTIN state vs place of supply. Approval, issue,
 * revisions, PDF and acceptance are S3; conversion to a Sales Order is S4.
 *
 * Visibility: same rule as CRM records on the `sales_quotations` module —
 * `view_all` sees everything, `view` sees own / CRM team / unassigned ones
 * they created. Outside the scope = NOT_FOUND.
 */

const TABLE = "quotations";
const OWNER_FIELDS = { owner: "ownerUserId", createdBy: "createdByUserId" };
const blank = (v: string | undefined | null) => (v ? v : null);

/** Appends one row to the quotation timeline (inside the caller's transaction). */
export function recordQuotationEvent(
  tx: Prisma.TransactionClient,
  actor: SalesActor,
  quotation: { id: string; companyId: string },
  revisionNumber: number,
  type: QuotationEventType,
  comment: string | null = null,
  metadata: Record<string, unknown> = {}
) {
  return tx.quotationEvent.create({
    data: { companyId: quotation.companyId, quotationId: quotation.id, revisionNumber, type, comment, metadata: metadata as Prisma.InputJsonValue, createdByUserId: actor.userId },
  });
}

// ── Scope ────────────────────────────────────────────────────────

export interface QuotationScope {
  record: CrmRecordScope;
  /** Approvers also see every quotation waiting for approval (S3). */
  approver: boolean;
}

export async function getQuotationScope(actor: SalesActor): Promise<QuotationScope> {
  const [viewAll, approver] = await Promise.all([
    PermissionService.can(actor.userId, "sales_quotations", "view_all"),
    PermissionService.can(actor.userId, "sales_quotations", "approve"),
  ]);
  if (viewAll) return { record: { mode: "ALL" }, approver };
  return { record: { mode: "OWN", userId: actor.userId, teamUserIds: (await getTeamScope(actor.userId, "CRM")).teamUserIds }, approver };
}

export function scopedWhere(actor: SalesActor, scope: QuotationScope, extra: Prisma.QuotationWhereInput = {}): Prisma.QuotationWhereInput {
  const own = crmOwnerWhere(scope.record, OWNER_FIELDS) as Prisma.QuotationWhereInput;
  const visible: Prisma.QuotationWhereInput =
    scope.record.mode === "OWN" && scope.approver ? { OR: [own, { status: "PENDING_APPROVAL" }] } : own;
  return { AND: [{ companyId: actor.companyId }, visible, extra] };
}

export async function loadVisible(actor: SalesActor, id: string) {
  const quotation = await prisma.quotation.findFirst({ where: scopedWhere(actor, await getQuotationScope(actor), { id }) });
  if (!quotation) throw new BusinessRuleError("NOT_FOUND", "Quotation not found.", { id });
  return quotation;
}

// ── Options for the editor ───────────────────────────────────────

/** Active GST rates effective on `date` (Tax Rate master), with their tax type. */
async function effectiveTaxRates(companyId: string, date: string) {
  const d = new Date(date);
  return prisma.taxRate.findMany({
    where: { companyId, isActive: true, effectiveFrom: { lte: d }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: d } }], taxType: { isActive: true } },
    select: { id: true, name: true, ratePercentage: true, taxType: { select: { code: true, name: true } } },
    orderBy: [{ ratePercentage: "asc" }, { name: "asc" }],
  });
}

async function companyStateCode(companyId: string) {
  const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { taxRegistrationNo: true, baseCurrencyCode: true } });
  return { stateCode: extractStateCodeFromGstin(company.taxRegistrationNo), currencyCode: company.baseCurrencyCode };
}

/** Users who can own a quotation (active, with sales_quotations.view). */
export async function listQuotationOwners(actor: SalesActor) {
  const users = await prisma.user.findMany({
    where: { companyId: actor.companyId, status: "ACTIVE", supportForPlatformUserId: null },
    select: { id: true, fullName: true },
    orderBy: { fullName: "asc" },
  });
  const ok = await Promise.all(users.map((u) => PermissionService.can(u.id, "sales_quotations", "view")));
  return users.filter((_, i) => ok[i]);
}

export async function getQuotationEditorOptions(actor: SalesActor, date = todayIsoDate()) {
  const [taxRates, units, company, owners] = await Promise.all([
    effectiveTaxRates(actor.companyId, date),
    prisma.unitOfMeasure.findMany({ where: { isActive: true }, select: { id: true, code: true, name: true }, orderBy: { code: "asc" } }),
    companyStateCode(actor.companyId),
    listQuotationOwners(actor),
  ]);
  return {
    date,
    taxRates: taxRates.map((t) => ({ id: t.id, name: t.name, rate: Number(t.ratePercentage), taxType: t.taxType.code })),
    units,
    companyStateCode: company.stateCode,
    currencyCode: company.currencyCode,
    owners,
  };
}

// ── Validation of everything a draft refers to ───────────────────

interface Party {
  customerId: string | null;
  buyerId: string | null;
  prospectName: string | null;
  crmCompanyId: string | null;
  crmContactId: string | null;
}

async function assertParty(actor: SalesActor, party: Party) {
  if (!party.customerId && !party.prospectName) {
    throw new BusinessRuleError("VALIDATION_ERROR", "Choose a customer or enter a prospect name.", { fieldErrors: { customerId: "Required." } });
  }
  if (party.customerId) {
    const customer = await prisma.customer.findFirst({
      where: { id: party.customerId, companyId: actor.companyId, deletedAt: null },
      select: { id: true, buyers: { select: { id: true } } },
    });
    if (!customer) throw new BusinessRuleError("NOT_FOUND", "Customer not found.", { id: party.customerId });
    if (party.buyerId && !customer.buyers.some((b) => b.id === party.buyerId)) {
      throw new BusinessRuleError("NOT_FOUND", "Buyer not found for this customer.", { id: party.buyerId });
    }
  } else if (party.buyerId) {
    throw new BusinessRuleError("VALIDATION_ERROR", "A buyer needs a customer.", { fieldErrors: { buyerId: "Pick the customer first." } });
  }
  await assertCrmLinks(actor, { crmCompanyId: party.crmCompanyId, crmContactId: party.crmContactId, customerId: party.customerId });
}

async function assertOwner(actor: SalesActor, ownerUserId: string) {
  const user = await prisma.user.findFirst({
    where: { id: ownerUserId, companyId: actor.companyId, status: "ACTIVE", supportForPlatformUserId: null },
    select: { id: true },
  });
  if (!user || !(await PermissionService.can(user.id, "sales_quotations", "view"))) {
    throw new BusinessRuleError("VALIDATION_ERROR", "Choose an active user who has access to quotations.", { fieldErrors: { ownerUserId: "Not an eligible owner." } });
  }
}

type TaxRateMap = Map<string, number>;

/** Resolves and checks every line reference; returns rows ready to store (amounts still to be added). */
async function resolveLines(actor: SalesActor, lines: QuotationLineInput[], rates: TaxRateMap, buyerEnquiryId: string | null) {
  const ids = (pick: (l: QuotationLineInput) => string | undefined) => [...new Set(lines.map(pick).filter((v): v is string => Boolean(v)))];
  const [products, samples, units, enquiryLines] = await Promise.all([
    prisma.product.findMany({ where: { id: { in: ids((l) => l.productId) }, companyId: actor.companyId, deletedAt: null }, select: { id: true, itemType: true, styleName: true } }),
    prisma.sampleRequest.findMany({ where: { id: { in: ids((l) => l.sampleRequestId) }, companyId: actor.companyId }, select: { id: true, status: true, productId: true, requestNumber: true } }),
    prisma.unitOfMeasure.findMany({ where: { id: { in: ids((l) => l.uomId) }, isActive: true }, select: { id: true } }),
    prisma.buyerEnquiryLine.findMany({ where: { id: { in: ids((l) => l.buyerEnquiryLineId) }, buyerEnquiry: { companyId: actor.companyId } }, select: { id: true, buyerEnquiryId: true } }),
  ]);
  const productById = new Map(products.map((p) => [p.id, p]));
  const sampleById = new Map(samples.map((s) => [s.id, s]));
  const unitIds = new Set(units.map((u) => u.id));
  const enquiryLineById = new Map(enquiryLines.map((l) => [l.id, l]));

  return lines.map((line, i) => {
    const at = (msg: string, field: string) => new BusinessRuleError("VALIDATION_ERROR", `Line ${i + 1}: ${msg}`, { fieldErrors: { [`lines.${i}.${field}`]: msg } });
    let productId = line.productId || null;
    const sampleRequestId = line.sampleRequestId || null;
    if (productId) {
      const p = productById.get(productId);
      if (!p) throw at("style not found.", "productId");
      if (p.itemType !== "STYLE") throw at("pick a Style, not a raw material.", "productId");
    }
    if (sampleRequestId) {
      const s = sampleById.get(sampleRequestId);
      if (!s) throw at("design not found.", "sampleRequestId");
      if (s.status !== "APPROVED") throw at(`design ${s.requestNumber} is not approved.`, "sampleRequestId");
      if (s.productId && productId && s.productId !== productId) throw at(`design ${s.requestNumber} belongs to another style.`, "sampleRequestId");
      productId = productId ?? s.productId ?? null;
    }
    if (line.uomId && !unitIds.has(line.uomId)) throw at("unit not found.", "uomId");
    if (line.taxRateId && !rates.has(line.taxRateId)) throw at("GST rate is not active on the quotation date.", "taxRateId");
    if (line.buyerEnquiryLineId) {
      const el = enquiryLineById.get(line.buyerEnquiryLineId);
      if (!el || el.buyerEnquiryId !== buyerEnquiryId) throw at("enquiry line doesn't belong to this quotation's enquiry.", "buyerEnquiryLineId");
    }
    return {
      lineNumber: i + 1,
      lineType: sampleRequestId ? ("DESIGN" as const) : productId ? ("STYLE" as const) : ("FREE_TEXT" as const),
      productId,
      sampleRequestId,
      buyerEnquiryLineId: line.buyerEnquiryLineId || null,
      description: line.description,
      colorSizeRemarks: blank(line.colorSizeRemarks),
      customerReference: blank(line.customerReference),
      quantity: line.quantity,
      uomId: line.uomId || null,
      unitPrice: line.unitPrice,
      discountPercent: line.discountPercent ?? 0,
      taxRateId: line.taxRateId || null,
      gstRate: line.taxRateId ? rates.get(line.taxRateId)! : 0,
      requestedDeliveryDate: line.requestedDeliveryDate ? new Date(line.requestedDeliveryDate) : null,
      notes: blank(line.notes),
    };
  });
}

export type DraftBody = Omit<QuotationCreateInput, "buyerEnquiryId">;

/** Validates a full draft and computes every amount. Returns the revision data and line rows. */
export async function buildDraft(actor: SalesActor, input: DraftBody, buyerEnquiryId: string | null) {
  const [rates, company] = await Promise.all([effectiveTaxRates(actor.companyId, input.quotationDate), companyStateCode(actor.companyId)]);
  const rateMap: TaxRateMap = new Map(rates.map((r) => [r.id, Number(r.ratePercentage)]));
  for (const [field, id] of [["freightTaxRateId", input.freightTaxRateId], ["otherChargesTaxRateId", input.otherChargesTaxRateId]] as const) {
    if (id && !rateMap.has(id)) throw new BusinessRuleError("VALIDATION_ERROR", "GST rate is not active on the quotation date.", { fieldErrors: { [field]: "Not active." } });
  }
  const lines = await resolveLines(actor, input.lines, rateMap, buyerEnquiryId);
  const placeOfSupplyStateCode = input.placeOfSupplyStateCode || null;
  const freightGstRate = input.freightTaxRateId ? rateMap.get(input.freightTaxRateId)! : 0;
  const otherChargesGstRate = input.otherChargesTaxRateId ? rateMap.get(input.otherChargesTaxRateId)! : 0;
  const calc = calculateQuotation({
    lines,
    freightAmount: input.freightAmount ?? 0,
    freightGstRate,
    otherChargesAmount: input.otherChargesAmount ?? 0,
    otherChargesGstRate,
    companyStateCode: company.stateCode,
    placeOfSupplyStateCode,
  });

  const revision = {
    title: input.title,
    quotationDate: new Date(input.quotationDate),
    validUntil: new Date(input.validUntil),
    currencyCode: company.currencyCode,
    companyStateCode: company.stateCode,
    placeOfSupplyStateCode,
    isInterState: calc.isInterState,
    billingAddress: blank(input.billingAddress),
    shippingAddress: blank(input.shippingAddress),
    paymentTermsDays: input.paymentTermsDays === "" || input.paymentTermsDays === null || input.paymentTermsDays === undefined ? null : input.paymentTermsDays,
    deliveryTerms: blank(input.deliveryTerms),
    introduction: blank(input.introduction),
    customerNotes: blank(input.customerNotes),
    internalNotes: blank(input.internalNotes),
    termsAndConditions: blank(input.termsAndConditions),
    freightAmount: input.freightAmount ?? 0,
    freightTaxRateId: input.freightTaxRateId || null,
    freightGstRate,
    freightTaxAmount: calc.freight.taxAmount,
    otherChargesLabel: blank(input.otherChargesLabel),
    otherChargesAmount: input.otherChargesAmount ?? 0,
    otherChargesTaxRateId: input.otherChargesTaxRateId || null,
    otherChargesGstRate,
    otherChargesTaxAmount: calc.otherCharges.taxAmount,
    subtotalAmount: calc.subtotalAmount,
    discountTotal: calc.discountTotal,
    taxableTotal: calc.taxableTotal,
    chargesTotal: calc.chargesTotal,
    cgstTotal: calc.cgstTotal,
    sgstTotal: calc.sgstTotal,
    igstTotal: calc.igstTotal,
    taxTotal: calc.taxTotal,
    grandTotal: calc.grandTotal,
  };
  const lineRows = lines.map((l, i) => {
    const r = calc.lines[i];
    return {
      ...l,
      grossAmount: r.grossAmount,
      discountAmount: r.discountAmount,
      taxableAmount: r.taxableAmount,
      cgstRate: r.cgstRate,
      cgstAmount: r.cgstAmount,
      sgstRate: r.sgstRate,
      sgstAmount: r.sgstAmount,
      igstRate: r.igstRate,
      igstAmount: r.igstAmount,
      taxAmount: r.taxAmount,
      lineTotal: r.lineAmount,
    };
  });
  return { revision, lineRows };
}

// ── Prefill from an enquiry ──────────────────────────────────────

/**
 * Draft payload for a new quotation from an enquiry: party, CRM links, owner,
 * title and one line per enquiry line that isn't rejected (target qty / price
 * become the starting quantity / price — the salesperson edits them).
 */
export async function getQuotationPrefillFromEnquiry(actor: SalesActor, enquiryId: string) {
  const base = await loadEnquiryForQuotation(actor, enquiryId);
  const enquiry = await prisma.buyerEnquiry.findUniqueOrThrow({
    where: { id: base.id },
    include: {
      customer: { select: { name: true, taxRegistrationNo: true, billingAddress: true, shippingAddress: true, paymentTermsDays: true } },
      lines: {
        orderBy: { createdAt: "asc" },
        include: {
          product: { select: { id: true, styleName: true, styleCode: true } },
          size: { select: { name: true } },
          sampleRequest: { select: { id: true, status: true, productId: true } },
        },
      },
    },
  });
  const settings = await getSalesMarketingSettings(actor.companyId);
  const today = new Date(todayIsoDate());
  const validUntil = toIsoDate(new Date(today.getFullYear(), today.getMonth(), today.getDate() + settings.quotationDefaultValidityDays));
  const party = enquiry.customer?.name ?? enquiry.prospectName ?? "customer";
  return {
    buyerEnquiryId: enquiry.id,
    enquiryNumber: enquiry.enquiryNumber,
    customerId: enquiry.customerId ?? "",
    customerName: enquiry.customer?.name ?? null,
    buyerId: enquiry.buyerId ?? "",
    prospectName: enquiry.customerId ? "" : (enquiry.prospectName ?? ""),
    crmCompanyId: enquiry.crmCompanyId ?? "",
    crmContactId: enquiry.crmContactId ?? "",
    ownerUserId: enquiry.ownerUserId ?? actor.userId,
    title: enquiry.subject || `Quotation for ${party}`,
    quotationDate: todayIsoDate(),
    validUntil,
    placeOfSupplyStateCode: extractStateCodeFromGstin(enquiry.customer?.taxRegistrationNo) ?? "",
    billingAddress: enquiry.customer?.billingAddress ?? "",
    shippingAddress: enquiry.customer?.shippingAddress ?? "",
    paymentTermsDays: enquiry.customer?.paymentTermsDays ?? "",
    termsAndConditions: settings.quotationDefaultTerms ?? "",
    lines: enquiry.lines
      .filter((l) => l.lineStatus !== "REJECTED")
      .map((l) => {
        const approvedSample = l.sampleRequest?.status === "APPROVED" ? l.sampleRequest : null;
        const name = l.product ? `${l.product.styleName} (${l.product.styleCode})` : (l.styleNameFreeText ?? "Item");
        return {
          buyerEnquiryLineId: l.id,
          productId: l.product?.id ?? approvedSample?.productId ?? "",
          sampleRequestId: approvedSample?.id ?? "",
          description: [name, l.description].filter(Boolean).join(" — "),
          colorSizeRemarks: [l.colorRemarks, l.size?.name].filter(Boolean).join(" / "),
          quantity: l.targetQuantity ? Number(l.targetQuantity) : 1,
          unitPrice: l.targetUnitPrice ? Number(l.targetUnitPrice) : 0,
          discountPercent: 0,
          requestedDeliveryDate: l.targetDeliveryDate ? toIsoDate(l.targetDeliveryDate) : "",
        };
      }),
  };
}

// ── Create / save draft / cancel ─────────────────────────────────

export async function createQuotation(actor: SalesActor, raw: unknown) {
  const input = quotationCreateSchema.parse(raw);
  let party: Party = {
    customerId: input.customerId || null,
    buyerId: input.buyerId || null,
    prospectName: input.customerId ? null : blank(input.prospectName),
    crmCompanyId: input.crmCompanyId || null,
    crmContactId: input.crmContactId || null,
  };
  let enquiryId: string | null = null;
  if (input.buyerEnquiryId) {
    // The party always comes from the enquiry — a quotation can't be re-pointed at someone else.
    const enquiry = await loadEnquiryForQuotation(actor, input.buyerEnquiryId);
    enquiryId = enquiry.id;
    party = {
      customerId: enquiry.customerId,
      buyerId: enquiry.buyerId,
      prospectName: enquiry.customerId ? null : enquiry.prospectName,
      crmCompanyId: enquiry.crmCompanyId,
      crmContactId: enquiry.crmContactId,
    };
  } else {
    await assertParty(actor, party);
  }
  const ownerUserId = input.ownerUserId || actor.userId;
  await assertOwner(actor, ownerUserId);
  const { revision, lineRows } = await buildDraft(actor, input, enquiryId);

  // Company-wide numbering (branchId null): numbers are unique per company.
  const quotationNumber = await generateDocumentNumber({ companyId: actor.companyId, branchId: null, documentType: "QUOTATION" });

  const quotation = await prisma.$transaction(async (tx) => {
    const created = await tx.quotation.create({
      data: {
        companyId: actor.companyId,
        quotationNumber,
        buyerEnquiryId: enquiryId,
        ...party,
        ownerUserId,
        status: "DRAFT",
        currentRevisionNumber: 1,
        createdByUserId: actor.userId,
        revisions: {
          create: {
            companyId: actor.companyId,
            revisionNumber: 1,
            status: "DRAFT",
            ...revision,
            createdByUserId: actor.userId,
            lines: { create: lineRows },
          },
        },
      },
    });
    if (enquiryId) await markEnquiryQuotationStarted(tx, actor, enquiryId, quotationNumber);
    await recordQuotationEvent(tx, actor, created, 1, "CREATED", null, { grandTotal: revision.grandTotal });
    await writeAuditLog(
      {
        companyId: actor.companyId,
        userId: actor.userId,
        tableName: TABLE,
        recordId: created.id,
        action: "CREATE",
        newValues: { quotationNumber, buyerEnquiryId: enquiryId, lineCount: lineRows.length, grandTotal: revision.grandTotal },
      },
      tx
    );
    if (ownerUserId !== actor.userId) {
      await createNotification(
        { companyId: actor.companyId, userId: ownerUserId, title: `Quotation ${quotationNumber} assigned to you`, body: revision.title, relatedModule: "QUOTATION", relatedRecordId: created.id },
        tx
      );
    }
    return created;
  });
  return quotation;
}

export async function updateQuotationDraft(actor: SalesActor, id: string, raw: unknown) {
  const input = quotationUpdateSchema.parse(raw);
  const quotation = await loadVisible(actor, id);
  if (quotation.status !== "DRAFT") {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", "Only a draft quotation can be edited.", { status: quotation.status });
  }
  const current = await prisma.quotationRevision.findUniqueOrThrow({
    where: { quotationId_revisionNumber: { quotationId: quotation.id, revisionNumber: quotation.currentRevisionNumber } },
  });
  if (current.status !== "DRAFT") throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This revision is no longer a draft.");
  if (current.version !== input.version) {
    throw new BusinessRuleError("RECORD_VERSION_CONFLICT", "Someone else saved this quotation after you opened it. Reload to see their changes.", {
      expected: input.version,
      actual: current.version,
    });
  }

  // Linked to an enquiry: the party stays the enquiry's. Standalone: it may change while a draft.
  const party: Party = quotation.buyerEnquiryId
    ? { customerId: quotation.customerId, buyerId: quotation.buyerId, prospectName: quotation.prospectName, crmCompanyId: quotation.crmCompanyId, crmContactId: quotation.crmContactId }
    : {
        customerId: input.customerId || null,
        buyerId: input.buyerId || null,
        prospectName: input.customerId ? null : blank(input.prospectName),
        crmCompanyId: input.crmCompanyId || null,
        crmContactId: input.crmContactId || null,
      };
  const partyChanged = (Object.keys(party) as (keyof Party)[]).some((k) => party[k] !== quotation[k]);
  if (partyChanged) await assertParty(actor, party);
  const ownerUserId = input.ownerUserId || quotation.ownerUserId || actor.userId;
  if (ownerUserId !== quotation.ownerUserId) await assertOwner(actor, ownerUserId);
  const { revision, lineRows } = await buildDraft(actor, input, quotation.buyerEnquiryId);

  await prisma.$transaction(async (tx) => {
    const { count } = await tx.quotationRevision.updateMany({
      where: { id: current.id, version: input.version, status: "DRAFT" },
      data: { ...revision, version: { increment: 1 }, updatedByUserId: actor.userId },
    });
    if (count === 0) throw new BusinessRuleError("RECORD_VERSION_CONFLICT", "Someone else saved this quotation just now. Reload and try again.");
    await tx.quotationLine.deleteMany({ where: { revisionId: current.id } });
    await tx.quotationLine.createMany({ data: lineRows.map((l) => ({ ...l, revisionId: current.id })) });
    await tx.quotation.update({ where: { id: quotation.id }, data: { ...party, ownerUserId } });
    await recordQuotationEvent(tx, actor, quotation, current.revisionNumber, "UPDATED", null, { grandTotal: revision.grandTotal, version: current.version + 1 });
    await writeAuditLog(
      {
        companyId: actor.companyId,
        userId: actor.userId,
        tableName: TABLE,
        recordId: quotation.id,
        action: "UPDATE",
        oldValues: { grandTotal: current.grandTotal.toString(), version: current.version, ownerUserId: quotation.ownerUserId },
        newValues: { grandTotal: revision.grandTotal, version: current.version + 1, ownerUserId, lineCount: lineRows.length },
      },
      tx
    );
    if (ownerUserId !== quotation.ownerUserId && ownerUserId !== actor.userId) {
      await createNotification(
        { companyId: actor.companyId, userId: ownerUserId, title: `Quotation ${quotation.quotationNumber} assigned to you`, body: revision.title, relatedModule: "QUOTATION", relatedRecordId: quotation.id },
        tx
      );
    }
  });
  // Handing the quotation to someone outside your own scope means you can no longer see it.
  return getQuotation(actor, id).catch((error) => {
    if (error instanceof BusinessRuleError && error.code === "NOT_FOUND") return { id, visible: false as const };
    throw error;
  });
}

// ── Read ─────────────────────────────────────────────────────────

const SUMMARY_REVISION = {
  orderBy: { revisionNumber: "desc" as const },
  take: 1,
  select: { revisionNumber: true, status: true, title: true, quotationDate: true, validUntil: true, currencyCode: true, grandTotal: true },
};

export async function listQuotations(
  actor: SalesActor,
  filter: QuotationListFilter,
  sort: { sortBy: QuotationSortField; sortOrder: "asc" | "desc" },
  page: { skip: number; take: number; search?: string }
) {
  const scope = await getQuotationScope(actor);
  const and: Prisma.QuotationWhereInput[] = [];
  const statuses = (filter.status ?? "").split(",").filter((s): s is QuotationStatus => (QUOTATION_STATUS_KEYS as readonly string[]).includes(s));
  if (statuses.length) and.push({ status: { in: statuses } });
  else if (filter.view === "closed") and.push({ status: { notIn: OPEN_QUOTATION_STATUSES } });
  else if (filter.view !== "all") and.push({ status: { in: OPEN_QUOTATION_STATUSES } });
  if (filter.owner === "me") and.push({ ownerUserId: actor.userId });
  else if (filter.owner === "unassigned") and.push({ ownerUserId: null });
  else if (filter.owner && /^[0-9a-f-]{36}$/i.test(filter.owner)) and.push({ ownerUserId: filter.owner });
  if (filter.customerId) and.push({ customerId: filter.customerId });
  if (filter.buyerEnquiryId) and.push({ buyerEnquiryId: filter.buyerEnquiryId });
  const term = page.search?.trim();
  if (term) {
    const c = { contains: term, mode: "insensitive" as const };
    and.push({
      OR: [{ quotationNumber: c }, { prospectName: c }, { customer: { name: c } }, { buyerEnquiry: { enquiryNumber: c } }, { revisions: { some: { title: c } } }],
    });
  }
  const where = scopedWhere(actor, scope, { AND: and });
  const [rows, totalCount] = await Promise.all([
    prisma.quotation.findMany({
      where,
      include: {
        customer: { select: { id: true, name: true } },
        owner: { select: { id: true, fullName: true } },
        buyerEnquiry: { select: { id: true, enquiryNumber: true } },
        revisions: SUMMARY_REVISION,
      },
      orderBy: [{ [sort.sortBy]: sort.sortOrder }, { createdAt: "desc" }],
      skip: page.skip,
      take: page.take,
    }),
    prisma.quotation.count({ where }),
  ]);
  const today = todayIsoDate();
  return {
    data: rows.map(({ revisions, ...q }) => ({ ...q, current: revisions[0] ?? null, isExpired: revisions[0] ? isQuotationExpired(q.status, revisions[0].validUntil, today) : false })),
    totalCount,
  };
}

/** Quotations of one enquiry that the user can see (for the enquiry page). */
export async function listQuotationsForEnquiry(actor: SalesActor, buyerEnquiryId: string) {
  if (!(await PermissionService.can(actor.userId, "sales_quotations", "view"))) return null;
  const rows = await prisma.quotation.findMany({
    where: scopedWhere(actor, await getQuotationScope(actor), { buyerEnquiryId }),
    include: { revisions: SUMMARY_REVISION, owner: { select: { fullName: true } } },
    orderBy: { createdAt: "asc" },
  });
  return rows.map(({ revisions, ...q }) => ({ id: q.id, quotationNumber: q.quotationNumber, status: q.status, owner: q.owner, current: revisions[0] ?? null }));
}

/**
 * Quotation detail: header, revision list, the requested revision (default the
 * current one) with its lines, the timeline, and what the viewer may do next.
 */
export async function getQuotation(actor: SalesActor, id: string, revisionNumber?: number) {
  const scope = await getQuotationScope(actor);
  const quotation = await prisma.quotation.findFirst({
    where: scopedWhere(actor, scope, { id }),
    include: {
      customer: { select: { id: true, name: true, code: true, taxRegistrationNo: true } },
      buyer: { select: { id: true, name: true } },
      buyerEnquiry: { select: { id: true, enquiryNumber: true, subject: true, salesStage: true } },
      crmCompany: { select: { id: true, name: true } },
      crmContact: { select: { id: true, fullName: true } },
      owner: { select: { id: true, fullName: true } },
      createdBy: { select: { id: true, fullName: true } },
      revisions: {
        orderBy: { revisionNumber: "desc" },
        select: { id: true, revisionNumber: true, status: true, grandTotal: true, revisionReason: true, issuedAt: true, createdAt: true, updatedAt: true },
      },
      events: { orderBy: { createdAt: "desc" }, take: 300, include: { createdBy: { select: { id: true, fullName: true } } } },
    },
  });
  if (!quotation) throw new BusinessRuleError("NOT_FOUND", "Quotation not found.", { id });
  const wanted = revisionNumber ?? quotation.currentRevisionNumber;
  const current = await prisma.quotationRevision.findUnique({
    where: { quotationId_revisionNumber: { quotationId: quotation.id, revisionNumber: wanted } },
    include: {
      freightTaxRate: { select: { id: true, name: true } },
      otherChargesTaxRate: { select: { id: true, name: true } },
      lines: {
        orderBy: { lineNumber: "asc" },
        include: {
          product: { select: { id: true, styleName: true, styleCode: true } },
          sampleRequest: { select: { id: true, requestNumber: true, status: true } },
          uom: { select: { id: true, code: true } },
          taxRate: { select: { id: true, name: true } },
        },
      },
    },
  });
  if (!current) throw new BusinessRuleError("NOT_FOUND", "Revision not found.", { id, revisionNumber: wanted });

  const userIds = [current.submittedByUserId, current.approvedByUserId, current.issuedByUserId, current.sentByUserId, current.decisionRecordedById].filter((v): v is string => Boolean(v));
  const [canViewCrm, settings, users] = await Promise.all([
    PermissionService.can(actor.userId, "crm", "view"),
    getSalesMarketingSettings(actor.companyId),
    userIds.length ? prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true } }) : Promise.resolve([]),
  ]);
  const names = Object.fromEntries(users.map((u) => [u.id, u.fullName]));
  const isCurrent = wanted === quotation.currentRevisionNumber;
  const today = todayIsoDate();
  // While a draft, show what the approval rule would say right now.
  const approvalPreview =
    current.status === "DRAFT"
      ? approvalReasons(
          { lines: current.lines.map((l) => ({ lineNumber: l.lineNumber, discountPercent: Number(l.discountPercent) })), grandTotal: Number(current.grandTotal) },
          { maxDiscountPercent: settings.quotationApprovalMaxDiscountPercent, maxTotal: settings.quotationApprovalMaxTotal }
        )
      : null;
  return {
    ...quotation,
    crmCompany: canViewCrm ? quotation.crmCompany : quotation.crmCompany ? { id: quotation.crmCompany.id, name: "CRM company" } : null,
    crmContact: canViewCrm ? quotation.crmContact : quotation.crmContact ? { id: quotation.crmContact.id, fullName: "CRM contact" } : null,
    current,
    isCurrentRevision: isCurrent,
    isExpired: isCurrent && isQuotationExpired(current.status, current.validUntil, today),
    approvalPreview,
    people: {
      submittedBy: current.submittedByUserId ? (names[current.submittedByUserId] ?? null) : null,
      approvedBy: current.approvedByUserId ? (names[current.approvedByUserId] ?? null) : null,
      issuedBy: current.issuedByUserId ? (names[current.issuedByUserId] ?? null) : null,
      sentBy: current.sentByUserId ? (names[current.sentByUserId] ?? null) : null,
      decisionRecordedBy: current.decisionRecordedById ? (names[current.decisionRecordedById] ?? null) : null,
    },
    viewerCanApprove: await canApproveRevision(actor, current),
  };
}

/** True when the viewer may approve this revision: it awaits approval, they hold the permission, and they didn't create, save or submit it. */
export async function canApproveRevision(actor: SalesActor, revision: { status: string; createdByUserId: string; updatedByUserId: string | null; submittedByUserId: string | null }) {
  if (revision.status !== "PENDING_APPROVAL") return false;
  const involved = [...new Set([revision.createdByUserId, revision.updatedByUserId, revision.submittedByUserId].filter((v): v is string => Boolean(v)))];
  for (const createdBy of involved) {
    if (!(await PermissionService.can(actor.userId, "sales_quotations", "approve", { createdBy }))) return false;
  }
  return involved.length > 0 || (await PermissionService.can(actor.userId, "sales_quotations", "approve"));
}

/** Record-attachments visibility hook. */
export async function assertQuotationVisible(actor: { companyId: string; userId: string }, id: string): Promise<void> {
  await loadVisible(actor, id);
}

