import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { generateDocumentNumber } from "@/core/numbering/DocumentNumberingService";
import type { ListQuery } from "@/lib/list-query";
import { todayIsoDate } from "@/lib/date";
import { createSampleRequest } from "@/modules/sampling/sample.service";
import { CustomerRepository } from "@/modules/customers/customer.repository";
import { ProductRepository } from "@/modules/products/product.repository";
import type {
  BuyerEnquiryInput,
  BuyerEnquiryLineStatusChangeInput,
  ConvertEnquiryLineInput,
  LinkCustomerToEnquiryInput,
} from "./buyer-enquiry.schema";
import { BuyerEnquiryLineRepository, BuyerEnquiryRepository } from "./buyer-enquiry.repository";
import { BuyerEnquiryLineStatus, BuyerEnquiryStatus, type Prisma } from "@prisma/client";

interface ActorContext {
  companyId: string;
  userId: string;
  branchId?: string | null;
}

/**
 * Generic line-status endpoint only — CONVERTED is deliberately absent, the
 * same discipline as Sampling's ALLOWED_TRANSITIONS excluding
 * TECH_PACK_READY/REVISION_REQUESTED. A line only ever reaches CONVERTED
 * through convertEnquiryLineToSampleRequest() below.
 */
const LINE_ALLOWED_TRANSITIONS: Record<BuyerEnquiryLineStatus, BuyerEnquiryLineStatus[]> = {
  PENDING_REVIEW: ["APPROVED_FOR_SAMPLING", "ON_HOLD", "REJECTED"],
  APPROVED_FOR_SAMPLING: ["ON_HOLD", "REJECTED"],
  ON_HOLD: ["PENDING_REVIEW", "APPROVED_FOR_SAMPLING", "REJECTED"],
  REJECTED: [],
  CONVERTED: [],
};

const TERMINAL_LINE_STATUSES: BuyerEnquiryLineStatus[] = ["CONVERTED", "REJECTED"];

/**
 * The header's status is always derived from its lines, never hand-set
 * (CANCELLED is the one manual exception, via cancelBuyerEnquiry). This is
 * the same lesson this project already learned twice — a status label that
 * can drift from the real underlying state is how the GoodsReceipt-cancel
 * bug and Sample's Hold/Resume bug both happened.
 */
function computeBuyerEnquiryStatus(lines: { lineStatus: BuyerEnquiryLineStatus }[]): BuyerEnquiryStatus {
  if (lines.length === 0) return "OPEN";
  if (lines.every((l) => TERMINAL_LINE_STATUSES.includes(l.lineStatus))) return "CLOSED";
  if (lines.some((l) => l.lineStatus === "CONVERTED")) return "PARTIALLY_CONVERTED";
  return "OPEN";
}

async function recomputeAndPersistEnquiryStatus(companyId: string, buyerEnquiryId: string) {
  const enquiry = await BuyerEnquiryRepository.findAnyById(companyId, buyerEnquiryId);
  if (!enquiry) return;
  // CANCELLED is manual and final — a subsequent line action is already
  // blocked before it can reach here (see the CANCELLED guards below), but
  // this is a defensive backstop against ever overwriting it by accident.
  if (enquiry.status === "CANCELLED") return enquiry;

  const lines = await BuyerEnquiryLineRepository.findByEnquiryId(buyerEnquiryId);
  const nextStatus = computeBuyerEnquiryStatus(lines);
  if (nextStatus === enquiry.status) return enquiry;

  return BuyerEnquiryRepository.update(buyerEnquiryId, { status: nextStatus });
}

export async function listBuyerEnquiries(companyId: string, query: ListQuery) {
  const where: Prisma.BuyerEnquiryWhereInput = {
    companyId,
    ...(query.search ? { enquiryNumber: { contains: query.search, mode: "insensitive" as const } } : {}),
  };

  const [data, totalCount] = await Promise.all([
    BuyerEnquiryRepository.findMany(where, {
      orderBy: { [query.sortBy]: query.sortOrder },
      skip: query.skip,
      take: query.take,
    }),
    BuyerEnquiryRepository.count(where),
  ]);

  return { data, totalCount };
}

export async function getBuyerEnquiryById(companyId: string, id: string) {
  const enquiry = await BuyerEnquiryRepository.findByIdWithDetails(companyId, id);
  if (!enquiry) throw new BusinessRuleError("NOT_FOUND", "Buyer enquiry not found.", { id });
  return enquiry;
}

export async function createBuyerEnquiry(actor: ActorContext, input: BuyerEnquiryInput) {
  // A real Customer or at least a prospect name is required — an enquiry with
  // neither would be an anonymous, unreferenceable record. This is a plain
  // "not both empty" check, not a promotion mechanism: a prospect stays a
  // prospect (see the schema comment on BuyerEnquiry) until someone
  // separately creates a real Customer in Masters.
  if (!input.customerId && !input.prospectName) {
    throw new BusinessRuleError(
      "VALIDATION_ERROR",
      "Either an existing Customer or a prospect name is required."
    );
  }

  // Tenant-scoped — a customerId/buyerId/line productId from another
  // company would otherwise pass straight through, and findByIdWithDetails's
  // unrestricted `include` would return that tenant's full record on every
  // subsequent read (confirmed cross-tenant disclosure, fixed here).
  let customer: Awaited<ReturnType<typeof CustomerRepository.findByIdWithBuyers>> = null;
  if (input.customerId) {
    customer = await CustomerRepository.findByIdWithBuyers(actor.companyId, input.customerId);
    if (!customer) throw new BusinessRuleError("NOT_FOUND", "Customer not found.", { id: input.customerId });
  }
  if (input.buyerId && !customer?.buyers.some((b) => b.id === input.buyerId)) {
    throw new BusinessRuleError("NOT_FOUND", "Buyer not found for this customer.", { id: input.buyerId });
  }
  for (const line of input.lines) {
    if (line.productId) {
      const product = await ProductRepository.findAnyById(actor.companyId, line.productId);
      if (!product) throw new BusinessRuleError("NOT_FOUND", "Style not found.", { id: line.productId });
    }
  }

  const enquiryNumber = await generateDocumentNumber({
    companyId: actor.companyId,
    branchId: actor.branchId ?? null,
    documentType: "BUYER_ENQUIRY",
  });

  const enquiry = await BuyerEnquiryRepository.createWithLines({
    companyId: actor.companyId,
    branchId: actor.branchId || null,
    enquiryNumber,
    customerId: input.customerId || null,
    buyerId: input.buyerId || null,
    prospectName: input.customerId ? null : input.prospectName || null,
    prospectContactPerson: input.customerId ? null : input.prospectContactPerson || null,
    prospectEmail: input.customerId ? null : input.prospectEmail || null,
    prospectPhone: input.customerId ? null : input.prospectPhone || null,
    prospectCountry: input.customerId ? null : input.prospectCountry || null,
    enquiryDate: new Date(input.enquiryDate),
    source: input.source,
    remarks: input.remarks || null,
    requestedByUserId: actor.userId,
    status: "OPEN",
    lines: {
      create: input.lines.map((line) => ({
        productId: line.productId || null,
        styleNameFreeText: line.styleNameFreeText || null,
        description: line.description || null,
        colorRemarks: line.colorRemarks || null,
        targetQuantity: line.targetQuantity ?? null,
        targetUnitPrice: line.targetUnitPrice ?? null,
        targetDeliveryDate: line.targetDeliveryDate ? new Date(line.targetDeliveryDate) : null,
        remarks: line.remarks || null,
        lineStatus: "PENDING_REVIEW",
      })),
    },
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "buyer_enquiries",
    recordId: enquiry.id,
    action: "CREATE",
    newValues: { enquiryNumber: enquiry.enquiryNumber, lineCount: enquiry.lines.length },
  });

  return enquiry;
}

export async function changeBuyerEnquiryLineStatus(
  actor: ActorContext,
  lineId: string,
  input: BuyerEnquiryLineStatusChangeInput
) {
  const line = await BuyerEnquiryLineRepository.findWithEnquiryOwner(lineId);
  if (!line || line.buyerEnquiry.companyId !== actor.companyId) {
    throw new BusinessRuleError("NOT_FOUND", "Buyer enquiry line not found.", { id: lineId });
  }

  if (line.buyerEnquiry.status === "CANCELLED") {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This enquiry has been cancelled.", {
      enquiryId: line.buyerEnquiryId,
    });
  }

  const allowed = LINE_ALLOWED_TRANSITIONS[line.lineStatus] ?? [];
  if (!allowed.includes(input.lineStatus)) {
    throw new BusinessRuleError(
      "INVALID_STATE_TRANSITION",
      `Cannot move a buyer enquiry line from ${line.lineStatus} to ${input.lineStatus}.`,
      { from: line.lineStatus, to: input.lineStatus }
    );
  }

  if (input.lineStatus === "REJECTED" && !input.rejectionReason) {
    throw new BusinessRuleError("VALIDATION_ERROR", "A rejection reason is required.");
  }

  const updated = await BuyerEnquiryLineRepository.update(lineId, {
    lineStatus: input.lineStatus,
    rejectionReason: input.lineStatus === "REJECTED" ? input.rejectionReason || null : null,
  });

  await recomputeAndPersistEnquiryStatus(actor.companyId, line.buyerEnquiryId);

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "buyer_enquiry_lines",
    recordId: lineId,
    action: "UPDATE",
    oldValues: { lineStatus: line.lineStatus },
    newValues: { lineStatus: updated.lineStatus, rejectionReason: updated.rejectionReason },
  });

  return updated;
}

/**
 * Cancels the whole enquiry. Deliberately does NOT cascade into rewriting
 * any line's own status — a line already CONVERTED is a real, independent
 * SampleRequest now and must never be touched by this; lines still open
 * simply become unreachable for further action once the header itself is
 * CANCELLED (enforced by the CANCELLED guards in the functions above), which
 * is a cleaner invariant than trying to force every open line into some
 * synthetic "abandoned" state.
 */
export async function cancelBuyerEnquiry(actor: ActorContext, id: string) {
  const enquiry = await BuyerEnquiryRepository.findAnyById(actor.companyId, id);
  if (!enquiry) throw new BusinessRuleError("NOT_FOUND", "Buyer enquiry not found.", { id });

  if (enquiry.status !== "OPEN" && enquiry.status !== "PARTIALLY_CONVERTED") {
    throw new BusinessRuleError(
      "INVALID_STATE_TRANSITION",
      `Cannot cancel a buyer enquiry in "${enquiry.status}" status.`,
      { currentStatus: enquiry.status }
    );
  }

  const updated = await BuyerEnquiryRepository.update(id, { status: "CANCELLED" });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "buyer_enquiries",
    recordId: id,
    action: "CANCEL",
    oldValues: { status: enquiry.status },
    newValues: { status: "CANCELLED" },
  });

  return updated;
}

/**
 * Promotes a still-prospect enquiry to a real Customer — the action the
 * create form's own "Convert to Style / conversion requires a real Customer"
 * warning (and the identical warning on convertEnquiryLineToSampleRequest's
 * own rejection) always implied existed, but never actually did until now.
 * Deliberately one-way and only for a genuine prospect: an enquiry that
 * already has a real customerId cannot be re-linked here — swapping a real
 * Customer out from under an enquiry with lines that may already be
 * Approved/Converted is a bigger, unrequested decision (which customer
 * "owns" the history at that point?) than "a prospect finally has a real
 * account." Prospect fields are cleared on link, matching createBuyerEnquiry's
 * own "customerId present -> prospect fields null" normalization exactly.
 */
export async function linkCustomerToBuyerEnquiry(actor: ActorContext, id: string, input: LinkCustomerToEnquiryInput) {
  const enquiry = await BuyerEnquiryRepository.findAnyById(actor.companyId, id);
  if (!enquiry) throw new BusinessRuleError("NOT_FOUND", "Buyer enquiry not found.", { id });

  if (enquiry.status === "CANCELLED") {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This enquiry has been cancelled.", { id });
  }
  if (enquiry.customerId) {
    throw new BusinessRuleError(
      "REFERENCED_RECORD_IN_USE",
      "This enquiry is already linked to a real Customer.",
      { customerId: enquiry.customerId }
    );
  }

  const customer = await CustomerRepository.findByIdWithBuyers(actor.companyId, input.customerId);
  if (!customer) throw new BusinessRuleError("NOT_FOUND", "Customer not found.", { id: input.customerId });
  if (input.buyerId && !customer.buyers.some((b) => b.id === input.buyerId)) {
    throw new BusinessRuleError("NOT_FOUND", "Buyer not found for this customer.", { id: input.buyerId });
  }

  const updated = await BuyerEnquiryRepository.update(id, {
    customerId: input.customerId,
    buyerId: input.buyerId || null,
    prospectName: null,
    prospectContactPerson: null,
    prospectEmail: null,
    prospectPhone: null,
    prospectCountry: null,
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "buyer_enquiries",
    recordId: id,
    action: "UPDATE",
    oldValues: { customerId: enquiry.customerId, prospectName: enquiry.prospectName },
    newValues: { customerId: input.customerId, buyerId: input.buyerId || null },
  });

  return updated;
}

/**
 * The one and only place a BuyerEnquiryLine ever becomes linked to a real
 * SampleRequest. Deliberately reuses createSampleRequest() from the Sampling
 * module completely unchanged — direct Sample Request creation has no
 * awareness of Buyer Enquiry at all (its schema has no buyerEnquiryLineId
 * field to accept), so this conversion path can only ever ADD a link after
 * the fact, never influence how a SampleRequest is built.
 *
 * A concurrent double-convert (two requests racing on the same
 * APPROVED_FOR_SAMPLING line) is closed with a guarded conditional update
 * rather than a plain read-then-write — if it loses the race, the
 * SampleRequest it already created is left as a harmless orphan rather than
 * silently double-linking the line. This mirrors the project's own accepted
 * "a document number drawn just before a downstream check fails is never
 * reused" trade-off (see the Goods Receipt over-receipt gotcha in CLAUDE.md).
 */
export async function convertEnquiryLineToSampleRequest(
  actor: ActorContext,
  lineId: string,
  input: ConvertEnquiryLineInput
) {
  const line = await BuyerEnquiryLineRepository.findWithEnquiryOwner(lineId);
  if (!line || line.buyerEnquiry.companyId !== actor.companyId) {
    throw new BusinessRuleError("NOT_FOUND", "Buyer enquiry line not found.", { id: lineId });
  }

  if (line.buyerEnquiry.status === "CANCELLED") {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This enquiry has been cancelled.", {
      enquiryId: line.buyerEnquiryId,
    });
  }

  if (line.lineStatus !== "APPROVED_FOR_SAMPLING") {
    throw new BusinessRuleError(
      "INVALID_STATE_TRANSITION",
      `Only a line that is Approved for Sampling can be converted, not ${line.lineStatus}.`,
      { from: line.lineStatus }
    );
  }

  if (line.sampleRequestId) {
    throw new BusinessRuleError(
      "REFERENCED_RECORD_IN_USE",
      "This line has already been converted to a sample request.",
      { sampleRequestId: line.sampleRequestId }
    );
  }

  if (!line.buyerEnquiry.customerId) {
    throw new BusinessRuleError(
      "VALIDATION_ERROR",
      "This enquiry is still a prospect with no linked Customer — link a real Customer before converting a line to a Sample Request."
    );
  }

  const sampleRequest = await createSampleRequest(actor, {
    customerId: line.buyerEnquiry.customerId,
    buyerId: line.buyerEnquiry.buyerId || undefined,
    productId: line.productId || undefined,
    styleName: input.styleName,
    sampleType: input.sampleType,
    color: input.color || undefined,
    requestDate: todayIsoDate(),
    targetSubmissionDate: input.targetSubmissionDate || undefined,
  });

  const guarded = await BuyerEnquiryLineRepository.convertGuarded(lineId, sampleRequest.id);
  if (guarded.count === 0) {
    throw new BusinessRuleError(
      "REFERENCED_RECORD_IN_USE",
      "This line was converted by another request just now — the sample request created here was not linked and can be discarded.",
      { lineId, orphanedSampleRequestId: sampleRequest.id }
    );
  }

  await recomputeAndPersistEnquiryStatus(actor.companyId, line.buyerEnquiryId);

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "buyer_enquiry_lines",
    recordId: lineId,
    action: "UPDATE",
    oldValues: { lineStatus: "APPROVED_FOR_SAMPLING", sampleRequestId: null },
    newValues: { lineStatus: "CONVERTED", sampleRequestId: sampleRequest.id },
  });

  return { line: { ...line, lineStatus: "CONVERTED" as const, sampleRequestId: sampleRequest.id }, sampleRequest };
}
