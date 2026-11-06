import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import type { BulkImportActorContext, BulkImportRowResult, RowContext } from "@/modules/import/bulk-import.service";
import { ENQUIRY_SOURCE_KEYS, SALES_ENQUIRY_PRIORITY_KEYS } from "../enquiries/sales-enquiry-registry";
import { createSalesEnquiry } from "../enquiries/sales-enquiry.service";

/**
 * Phase 14 (S&M) — one row of an enquiry import file → one enquiry with one
 * line, created through createSalesEnquiry (the same service the "New
 * enquiry" screen uses), as the importing user. Codes and emails in the file
 * are resolved to this company's records; nothing is created implicitly (an
 * unknown customer, style, size or owner fails the row).
 *
 * Duplicates: a row is refused when an enquiry already exists for the same
 * customer (or prospect name), enquiry date, subject and style — and, while
 * validating, when an earlier row of the same file has that key.
 *
 * In dry-run mode the row goes through createSalesEnquiry(…, { dryRun: true }):
 * every check, no write.
 */

const DUP_TAG = "buyer_enquiries";
const DRY_RUN_ID = "00000000-0000-0000-0000-000000000000";
const blank = (v: string | undefined) => (v === undefined || v.trim() === "" ? undefined : v.trim());
const ISO = /^\d{4}-\d{2}-\d{2}$/;

function date(raw: string | undefined, label: string, required = false) {
  const v = blank(raw);
  if (!v) {
    if (required) throw new BusinessRuleError("VALIDATION_ERROR", `${label} is required.`);
    return undefined;
  }
  if (!ISO.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) throw new BusinessRuleError("VALIDATION_ERROR", `${label} "${v}" is not a date — use YYYY-MM-DD.`);
  return v;
}

function num(raw: string | undefined, label: string) {
  const v = blank(raw);
  if (!v) return undefined;
  const n = Number(v.replace(/,/g, ""));
  if (!Number.isFinite(n) || n < 0) throw new BusinessRuleError("VALIDATION_ERROR", `${label} "${v}" is not a valid number.`);
  return n;
}

function oneOf<T extends string>(raw: string | undefined, allowed: readonly T[], label: string): T | undefined {
  const v = blank(raw)?.toUpperCase().replace(/[\s-]+/g, "_");
  if (!v) return undefined;
  if (!(allowed as readonly string[]).includes(v)) throw new BusinessRuleError("VALIDATION_ERROR", `${label} "${raw}" isn't one of ${allowed.join(", ")}.`);
  return v as T;
}

export async function importBuyerEnquiryRow(actor: BulkImportActorContext, raw: Record<string, string>, ctx: RowContext): Promise<BulkImportRowResult> {
  const enquiryDate = date(raw.enquiryDate, "Enquiry date", true)!;
  const customerCode = blank(raw.customerCode);
  const prospectName = blank(raw.prospectName);
  if (!customerCode && !prospectName) throw new BusinessRuleError("VALIDATION_ERROR", "Give a customer code or a prospect name.");

  let customerId: string | undefined;
  let buyerId: string | undefined;
  if (customerCode) {
    const customer = await prisma.customer.findFirst({ where: { companyId: actor.companyId, code: { equals: customerCode, mode: "insensitive" } }, select: { id: true, isActive: true, buyers: { select: { id: true, name: true } } } });
    if (!customer) throw new BusinessRuleError("NOT_FOUND", `Customer code "${customerCode}" not found.`);
    if (!customer.isActive) throw new BusinessRuleError("VALIDATION_ERROR", `Customer "${customerCode}" is inactive.`);
    customerId = customer.id;
    const buyerName = blank(raw.buyerName);
    if (buyerName) {
      const buyer = customer.buyers.find((b) => b.name.toLowerCase() === buyerName.toLowerCase());
      if (!buyer) throw new BusinessRuleError("NOT_FOUND", `Buyer "${buyerName}" not found for customer "${customerCode}".`);
      buyerId = buyer.id;
    }
  }

  const styleCode = blank(raw.styleCode);
  let productId: string | undefined;
  if (styleCode) {
    const product = await prisma.product.findFirst({ where: { companyId: actor.companyId, styleCode: { equals: styleCode, mode: "insensitive" }, itemType: "STYLE" }, select: { id: true } });
    if (!product) throw new BusinessRuleError("NOT_FOUND", `Style code "${styleCode}" not found.`);
    productId = product.id;
  }
  const sizeCode = blank(raw.sizeCode);
  let sizeId: string | undefined;
  if (sizeCode) {
    const size = await prisma.size.findFirst({ where: { companyId: actor.companyId, code: { equals: sizeCode, mode: "insensitive" } }, select: { id: true } });
    if (!size) throw new BusinessRuleError("NOT_FOUND", `Size code "${sizeCode}" not found.`);
    sizeId = size.id;
  }
  const styleName = blank(raw.styleName);
  const description = blank(raw.description);
  if (!productId && !styleName && !description) throw new BusinessRuleError("VALIDATION_ERROR", "Give a style code, a style / item name or a description for the line.");

  const ownerEmail = blank(raw.ownerEmail);
  let ownerUserId: string | undefined;
  if (ownerEmail) {
    const owner = await prisma.user.findFirst({ where: { companyId: actor.companyId, email: { equals: ownerEmail, mode: "insensitive" }, status: "ACTIVE" }, select: { id: true } });
    if (!owner) throw new BusinessRuleError("NOT_FOUND", `No active user with email "${ownerEmail}".`);
    ownerUserId = owner.id;
  }

  const subject = blank(raw.subject);
  // ── Duplicate check ──
  const styleKey = (styleCode ?? styleName ?? "").toLowerCase();
  const dupKey = [customerId ?? `p:${prospectName!.toLowerCase()}`, enquiryDate, (subject ?? "").toLowerCase(), styleKey].join("|");
  if (ctx.dryRun && ctx.dryRunRegistry?.get(DUP_TAG)?.has(dupKey)) throw new BusinessRuleError("VALIDATION_ERROR", "Same customer / prospect, date, subject and style as an earlier row in this file.");
  const existing = await prisma.buyerEnquiry.findFirst({
    where: {
      companyId: actor.companyId,
      enquiryDate: new Date(`${enquiryDate}T00:00:00Z`),
      ...(customerId ? { customerId } : { customerId: null, prospectName: { equals: prospectName!, mode: "insensitive" } }),
      ...(subject ? { subject: { equals: subject, mode: "insensitive" } } : { OR: [{ subject: null }, { subject: "" }] }),
      lines: { some: productId ? { productId } : styleName ? { styleNameFreeText: { equals: styleName, mode: "insensitive" } } : {} },
    },
    select: { enquiryNumber: true },
  });
  if (existing) throw new BusinessRuleError("VALIDATION_ERROR", `Looks like a duplicate of ${existing.enquiryNumber} (same customer / prospect, date, subject and style).`);

  const payload = {
    customerId: customerId ?? "",
    buyerId: buyerId ?? "",
    prospectName: customerId ? "" : (prospectName ?? ""),
    prospectContactPerson: customerId ? "" : (blank(raw.prospectContactPerson) ?? ""),
    prospectEmail: customerId ? "" : (blank(raw.prospectEmail) ?? ""),
    prospectPhone: customerId ? "" : (blank(raw.prospectPhone) ?? ""),
    prospectCountry: customerId ? "" : (blank(raw.prospectCountry) ?? ""),
    enquiryDate,
    source: oneOf(raw.source, ENQUIRY_SOURCE_KEYS, "Source") ?? "OTHER",
    remarks: blank(raw.remarks) ?? "",
    subject: subject ?? "",
    priority: oneOf(raw.priority, SALES_ENQUIRY_PRIORITY_KEYS, "Priority"),
    nextFollowUpDate: date(raw.nextFollowUpDate, "Next follow-up") ?? "",
    ownerUserId: ownerUserId ?? "",
    lines: [
      {
        productId: productId ?? "",
        styleNameFreeText: styleName ?? "",
        description: description ?? "",
        colorRemarks: blank(raw.colorRemarks) ?? "",
        sizeId: sizeId ?? "",
        targetQuantity: num(raw.targetQuantity, "Target quantity") || undefined,
        targetUnitPrice: num(raw.targetUnitPrice, "Target unit price"),
        targetDeliveryDate: date(raw.targetDeliveryDate, "Target delivery") ?? "",
      },
    ],
  };

  const salesActor = { companyId: actor.companyId, userId: actor.userId, branchId: actor.branchId ?? null };
  if (ctx.dryRun) {
    await createSalesEnquiry(salesActor, payload, { dryRun: true });
    if (ctx.dryRunRegistry) {
      const set = ctx.dryRunRegistry.get(DUP_TAG) ?? new Set<string>();
      set.add(dupKey);
      ctx.dryRunRegistry.set(DUP_TAG, set);
    }
    return { recordId: DRY_RUN_ID, tableName: "buyer_enquiries" };
  }
  const enquiry = await createSalesEnquiry(salesActor, payload);
  return { recordId: enquiry.id, tableName: "buyer_enquiries" };
}
