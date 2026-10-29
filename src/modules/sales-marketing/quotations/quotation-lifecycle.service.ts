import { z } from "zod";
import type { Prisma, Quotation, QuotationLine, QuotationRevision, QuotationRevisionStatus, QuotationStatus } from "@prisma/client";
import { prisma } from "@/core/db/client";
import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { createNotification } from "@/core/notifications/NotificationService";
import { PermissionService } from "@/core/rbac/PermissionService";
import { getCompanyHeaderLines } from "@/core/documents/company-header";
import { todayIsoDate, toIsoDate } from "@/lib/date";
import { markEnquiryQuoted, releaseEnquiryQuotation, type SalesActor } from "@/modules/sales-marketing/enquiries/sales-enquiry.service";
import { getSalesMarketingSettings } from "@/modules/sales-marketing/settings/sales-marketing-settings.service";
import { approvalReasons } from "./quotation-approval";
import { DECISION_METHOD_KEYS, OPEN_QUOTATION_STATUSES, SENT_METHOD_KEYS, type QuotationEventType } from "./quotation-registry";
import { buildDraft, canApproveRevision, getQuotation, loadVisible, recordQuotationEvent, type DraftBody } from "./quotation.service";

/**
 * Quotation lifecycle (Sales & Marketing Release 1 / S3, 2026-10-28).
 *
 *   DRAFT ──submit (approval needed)──▶ PENDING_APPROVAL ──approve──▶ APPROVED ──issue──▶ ISSUED
 *     │  ◀──decline / return to draft──┘        ▲                          │
 *     └──────────── issue (no approval needed) ─┴──────────────────────────┘
 *   ISSUED ──▶ ACCEPTED / REJECTED (customer decision, recorded against this revision)
 *   ISSUED / REJECTED ──revise (reason)──▶ new DRAFT revision; an issued one becomes SUPERSEDED
 *   any open status ──cancel (reason)──▶ CANCELLED
 *
 * An issued revision is never edited again: its lines and totals are frozen and
 * the letterhead/party block of the PDF is snapshotted at issue. Expiry is
 * derived from valid-until (no background job) and blocks acceptance only.
 * Every step is a guarded write on both statuses (a concurrent second click
 * fails cleanly), audited, and written to the quotation timeline.
 */

const TABLE = "quotations";
const reasonText = z.string().trim().min(3, "Give a reason").max(1000);
const optionalComment = z.string().trim().max(1000).optional().or(z.literal(""));
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date");

export const commentSchema = z.object({ comment: optionalComment }).strict();
export const reasonSchema = z.object({ reason: reasonText }).strict();
export const markSentSchema = z
  .object({
    sentTo: z.string().trim().min(1, "Who was it sent to?").max(300),
    method: z.enum(SENT_METHOD_KEYS),
    sentOn: isoDate,
    comment: optionalComment,
  })
  .strict();
export const acceptSchema = z
  .object({
    decisionDate: isoDate,
    method: z.enum(DECISION_METHOD_KEYS),
    customerReference: z.string().trim().max(200).optional().or(z.literal("")),
    comment: optionalComment,
  })
  .strict();
export const rejectSchema = z
  .object({
    decisionDate: isoDate,
    method: z.enum(DECISION_METHOD_KEYS).optional(),
    reason: reasonText,
  })
  .strict();

type RevisionWithLines = QuotationRevision & { lines: QuotationLine[] };

/**
 * The quotation after an action. An approver without view_all only sees
 * quotations while they await approval, so after approving / declining one it
 * can drop out of their view — then `{ id, visible: false }` is returned.
 */
async function afterAction(actor: SalesActor, id: string) {
  return getQuotation(actor, id).catch((error) => {
    if (error instanceof BusinessRuleError && error.code === "NOT_FOUND") return { id, visible: false as const };
    throw error;
  });
}

async function loadForAction(actor: SalesActor, id: string) {
  const quotation = await loadVisible(actor, id);
  const revision = await prisma.quotationRevision.findUniqueOrThrow({
    where: { quotationId_revisionNumber: { quotationId: quotation.id, revisionNumber: quotation.currentRevisionNumber } },
    include: { lines: { orderBy: { lineNumber: "asc" } } },
  });
  return { quotation, revision };
}

function requireStatus(quotation: Quotation, allowed: QuotationStatus[], verb: string) {
  if (!allowed.includes(quotation.status)) {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", `A ${quotation.status.toLowerCase().replace(/_/g, " ")} quotation can't be ${verb}.`, { status: quotation.status });
  }
}

/** Guarded move of the quotation and its current revision; a concurrent change makes it fail. */
async function move(
  tx: Prisma.TransactionClient,
  quotation: Quotation,
  revision: QuotationRevision,
  to: { quotation: QuotationStatus; revision: QuotationRevisionStatus; revisionData?: Prisma.QuotationRevisionUncheckedUpdateManyInput; quotationData?: Prisma.QuotationUncheckedUpdateManyInput }
) {
  const q = await tx.quotation.updateMany({ where: { id: quotation.id, status: quotation.status, currentRevisionNumber: revision.revisionNumber }, data: { status: to.quotation, ...(to.quotationData ?? {}) } });
  const r = await tx.quotationRevision.updateMany({ where: { id: revision.id, status: revision.status }, data: { status: to.revision, ...(to.revisionData ?? {}) } });
  if (q.count === 0 || r.count === 0) throw new BusinessRuleError("RECORD_VERSION_CONFLICT", "This quotation changed just now. Reload and try again.");
}

async function finish(
  tx: Prisma.TransactionClient,
  actor: SalesActor,
  quotation: Quotation,
  revisionNumber: number,
  event: QuotationEventType,
  from: string,
  to: string,
  comment: string | null,
  metadata: Record<string, unknown> = {}
) {
  await recordQuotationEvent(tx, actor, quotation, revisionNumber, event, comment, metadata);
  await writeAuditLog(
    { companyId: actor.companyId, userId: actor.userId, tableName: TABLE, recordId: quotation.id, action: event === "CANCELLED" ? "CANCEL" : event === "APPROVED" ? "APPROVE" : event === "APPROVAL_REJECTED" ? "REJECT" : "UPDATE", oldValues: { status: from, revisionNumber }, newValues: { status: to, revisionNumber, event, comment, ...metadata } },
    tx
  );
}

async function notify(tx: Prisma.TransactionClient, actor: SalesActor, quotation: Quotation, userIds: (string | null | undefined)[], title: string, body: string) {
  for (const userId of new Set(userIds.filter((u): u is string => Boolean(u) && u !== actor.userId))) {
    await createNotification({ companyId: actor.companyId, userId, title, body, relatedModule: "QUOTATION", relatedRecordId: quotation.id }, tx);
  }
}

/** The stored draft as an editor payload, so it can be re-validated and recomputed with the same code as a save. */
function draftBodyFromRevision(quotation: Quotation, r: RevisionWithLines): DraftBody {
  const s = (v: string | null | undefined) => v ?? "";
  return {
    customerId: s(quotation.customerId),
    buyerId: s(quotation.buyerId),
    prospectName: s(quotation.prospectName),
    crmCompanyId: s(quotation.crmCompanyId),
    crmContactId: s(quotation.crmContactId),
    ownerUserId: s(quotation.ownerUserId),
    title: r.title,
    quotationDate: toIsoDate(r.quotationDate),
    validUntil: toIsoDate(r.validUntil),
    placeOfSupplyStateCode: s(r.placeOfSupplyStateCode),
    billingAddress: s(r.billingAddress),
    shippingAddress: s(r.shippingAddress),
    paymentTermsDays: r.paymentTermsDays ?? "",
    deliveryTerms: s(r.deliveryTerms),
    introduction: s(r.introduction),
    customerNotes: s(r.customerNotes),
    internalNotes: s(r.internalNotes),
    termsAndConditions: s(r.termsAndConditions),
    freightAmount: Number(r.freightAmount),
    freightTaxRateId: s(r.freightTaxRateId),
    otherChargesLabel: s(r.otherChargesLabel),
    otherChargesAmount: Number(r.otherChargesAmount),
    otherChargesTaxRateId: s(r.otherChargesTaxRateId),
    lines: r.lines.map((l) => ({
      productId: l.lineType === "STYLE" ? s(l.productId) : "",
      sampleRequestId: s(l.sampleRequestId),
      buyerEnquiryLineId: s(l.buyerEnquiryLineId),
      description: l.description,
      colorSizeRemarks: s(l.colorSizeRemarks),
      customerReference: s(l.customerReference),
      quantity: Number(l.quantity),
      uomId: s(l.uomId),
      unitPrice: Number(l.unitPrice),
      discountPercent: Number(l.discountPercent),
      taxRateId: s(l.taxRateId),
      requestedDeliveryDate: l.requestedDeliveryDate ? toIsoDate(l.requestedDeliveryDate) : "",
      notes: s(l.notes),
    })),
  };
}

/**
 * Before a draft leaves DRAFT: re-run the save validation (references, GST
 * rates effective on the date) and recompute, so what is submitted or issued
 * is exactly what the rules allow today. Returns the recomputed numbers and the
 * approval reasons under the company's current limits.
 */
async function revalidateDraft(actor: SalesActor, quotation: Quotation, revision: RevisionWithLines) {
  if (toIsoDate(revision.validUntil) < todayIsoDate()) {
    throw new BusinessRuleError("VALIDATION_ERROR", "The valid-until date has passed. Edit the draft and set a new date.", { fieldErrors: { validUntil: "In the past." } });
  }
  const { revision: values, lineRows } = await buildDraft(actor, draftBodyFromRevision(quotation, revision), quotation.buyerEnquiryId);
  const settings = await getSalesMarketingSettings(actor.companyId);
  const reasons = approvalReasons(
    { lines: lineRows.map((l) => ({ lineNumber: l.lineNumber, discountPercent: l.discountPercent })), grandTotal: values.grandTotal },
    { maxDiscountPercent: settings.quotationApprovalMaxDiscountPercent, maxTotal: settings.quotationApprovalMaxTotal }
  );
  return { values, lineRows, reasons };
}

/** Writes recomputed numbers back onto the draft (inside the transition). */
async function storeRecomputed(tx: Prisma.TransactionClient, revision: QuotationRevision, recomputed: Awaited<ReturnType<typeof revalidateDraft>>) {
  await tx.quotationLine.deleteMany({ where: { revisionId: revision.id } });
  await tx.quotationLine.createMany({ data: recomputed.lineRows.map((l) => ({ ...l, revisionId: revision.id })) });
  return recomputed.values;
}

async function approverIds(actor: SalesActor, exclude: (string | null)[]) {
  const users = await prisma.user.findMany({ where: { companyId: actor.companyId, status: "ACTIVE", supportForPlatformUserId: null }, select: { id: true } });
  const ok = await Promise.all(users.map((u) => PermissionService.can(u.id, "sales_quotations", "approve")));
  return users.filter((u, i) => ok[i] && !exclude.includes(u.id)).map((u) => u.id);
}

// ── Approval ─────────────────────────────────────────────────────

export async function submitForApproval(actor: SalesActor, id: string, raw: unknown) {
  const { comment } = commentSchema.parse(raw ?? {});
  const { quotation, revision } = await loadForAction(actor, id);
  requireStatus(quotation, ["DRAFT"], "submitted");
  const recomputed = await revalidateDraft(actor, quotation, revision);
  if (recomputed.reasons.length === 0) {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This quotation is within the approval limits — issue it directly.");
  }
  const approvers = await approverIds(actor, [revision.createdByUserId, revision.updatedByUserId, actor.userId]);
  await prisma.$transaction(async (tx) => {
    const values = await storeRecomputed(tx, revision, recomputed);
    await move(tx, quotation, revision, {
      quotation: "PENDING_APPROVAL",
      revision: "PENDING_APPROVAL",
      revisionData: { ...values, approvalRequired: true, approvalReasons: recomputed.reasons, submittedAt: new Date(), submittedByUserId: actor.userId, approvedAt: null, approvedByUserId: null, approvalComment: null },
    });
    await finish(tx, actor, quotation, revision.revisionNumber, "SUBMITTED", "DRAFT", "PENDING_APPROVAL", comment || null, { reasons: recomputed.reasons, grandTotal: values.grandTotal });
    await notify(tx, actor, quotation, approvers, `Quotation ${quotation.quotationNumber} needs your approval`, recomputed.reasons.join("; "));
  });
  return afterAction(actor, id);
}

/** PENDING_APPROVAL / APPROVED → DRAFT, by the team (e.g. to change something). Clears the approval. */
export async function returnToDraft(actor: SalesActor, id: string, raw: unknown) {
  const { comment } = commentSchema.parse(raw ?? {});
  const { quotation, revision } = await loadForAction(actor, id);
  requireStatus(quotation, ["PENDING_APPROVAL", "APPROVED"], "returned to draft");
  await prisma.$transaction(async (tx) => {
    await move(tx, quotation, revision, {
      quotation: "DRAFT",
      revision: "DRAFT",
      revisionData: { submittedAt: null, submittedByUserId: null, approvedAt: null, approvedByUserId: null, approvalComment: null },
    });
    await finish(tx, actor, quotation, revision.revisionNumber, "WITHDRAWN", quotation.status, "DRAFT", comment || null);
  });
  return afterAction(actor, id);
}

export async function approveQuotation(actor: SalesActor, id: string, raw: unknown) {
  const { comment } = commentSchema.parse(raw ?? {});
  const { quotation, revision } = await loadForAction(actor, id);
  requireStatus(quotation, ["PENDING_APPROVAL"], "approved");
  if (!(await canApproveRevision(actor, revision))) {
    throw new BusinessRuleError("SELF_APPROVAL_NOT_ALLOWED", "Someone who didn't prepare or submit this quotation has to approve it.");
  }
  await prisma.$transaction(async (tx) => {
    await move(tx, quotation, revision, {
      quotation: "APPROVED",
      revision: "APPROVED",
      revisionData: { approvedAt: new Date(), approvedByUserId: actor.userId, approvalComment: comment || null },
    });
    await finish(tx, actor, quotation, revision.revisionNumber, "APPROVED", "PENDING_APPROVAL", "APPROVED", comment || null);
    await notify(tx, actor, quotation, [revision.submittedByUserId, quotation.ownerUserId], `Quotation ${quotation.quotationNumber} approved`, comment || "It can be issued now.");
  });
  return afterAction(actor, id);
}

export async function declineApproval(actor: SalesActor, id: string, raw: unknown) {
  const { reason } = reasonSchema.parse(raw ?? {});
  const { quotation, revision } = await loadForAction(actor, id);
  requireStatus(quotation, ["PENDING_APPROVAL"], "declined");
  await prisma.$transaction(async (tx) => {
    await move(tx, quotation, revision, {
      quotation: "DRAFT",
      revision: "DRAFT",
      revisionData: { submittedAt: null, submittedByUserId: null, approvalComment: reason },
    });
    await finish(tx, actor, quotation, revision.revisionNumber, "APPROVAL_REJECTED", "PENDING_APPROVAL", "DRAFT", reason);
    await notify(tx, actor, quotation, [revision.submittedByUserId, quotation.ownerUserId], `Quotation ${quotation.quotationNumber} sent back`, reason);
  });
  return afterAction(actor, id);
}

// ── Issue ────────────────────────────────────────────────────────

async function documentSnapshot(actor: SalesActor, quotation: Quotation) {
  const [{ companyName, companyDetailLines }, party] = await Promise.all([
    getCompanyHeaderLines(actor.companyId),
    quotation.customerId
      ? prisma.customer.findUnique({ where: { id: quotation.customerId }, select: { name: true, code: true, taxRegistrationNo: true, billingAddress: true, country: true } })
      : null,
  ]);
  const [buyer, contact] = await Promise.all([
    quotation.buyerId ? prisma.buyer.findUnique({ where: { id: quotation.buyerId }, select: { name: true } }) : null,
    quotation.crmContactId ? prisma.crmContact.findUnique({ where: { id: quotation.crmContactId }, select: { fullName: true } }) : null,
  ]);
  return {
    companyName,
    companyDetailLines,
    partyName: party?.name ?? quotation.prospectName ?? "",
    partyLines: [
      party?.billingAddress,
      party?.country,
      party?.taxRegistrationNo ? `GSTIN: ${party.taxRegistrationNo}` : null,
      buyer ? `Buyer: ${buyer.name}` : null,
      contact ? `Attn: ${contact.fullName}` : null,
    ].filter((v): v is string => Boolean(v)),
  };
}

/**
 * DRAFT (within limits) or APPROVED → ISSUED. Freezes the revision, snapshots
 * the printed letterhead/party, supersedes nothing (that happened at revise)
 * and moves a linked enquiry to QUOTED.
 */
export async function issueQuotation(actor: SalesActor, id: string, raw: unknown) {
  const { comment } = commentSchema.parse(raw ?? {});
  const { quotation, revision } = await loadForAction(actor, id);
  requireStatus(quotation, ["DRAFT", "APPROVED"], "issued");
  let recomputed: Awaited<ReturnType<typeof revalidateDraft>> | null = null;
  if (quotation.status === "DRAFT") {
    recomputed = await revalidateDraft(actor, quotation, revision);
    if (recomputed.reasons.length) {
      throw new BusinessRuleError("INVALID_STATE_TRANSITION", `This quotation needs approval first: ${recomputed.reasons.join("; ")}.`, { reasons: recomputed.reasons });
    }
  } else if (toIsoDate(revision.validUntil) < todayIsoDate()) {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", "The valid-until date has passed. Return it to draft and set a new date.");
  }
  const snapshot = await documentSnapshot(actor, quotation);
  await prisma.$transaction(async (tx) => {
    const values = recomputed ? await storeRecomputed(tx, revision, recomputed) : {};
    await move(tx, quotation, revision, {
      quotation: "ISSUED",
      revision: "ISSUED",
      revisionData: { ...values, ...(recomputed ? { approvalRequired: false, approvalReasons: [] } : {}), issuedAt: new Date(), issuedByUserId: actor.userId, documentSnapshot: snapshot },
    });
    if (quotation.buyerEnquiryId) await markEnquiryQuoted(tx, actor, quotation.buyerEnquiryId, quotation.quotationNumber, revision.revisionNumber);
    await finish(tx, actor, quotation, revision.revisionNumber, "ISSUED", quotation.status, "ISSUED", comment || null, { grandTotal: Number(recomputed?.values.grandTotal ?? revision.grandTotal) });
  });
  return afterAction(actor, id);
}

/** Records that the issued quotation reached the customer (no e-mail is sent by the ERP). Repeatable. */
export async function markQuotationSent(actor: SalesActor, id: string, raw: unknown) {
  const input = markSentSchema.parse(raw ?? {});
  const { quotation, revision } = await loadForAction(actor, id);
  requireStatus(quotation, ["ISSUED"], "marked as sent");
  if (input.sentOn > todayIsoDate()) throw new BusinessRuleError("VALIDATION_ERROR", "The send date can't be in the future.", { fieldErrors: { sentOn: "In the future." } });
  if (revision.issuedAt && input.sentOn < toIsoDate(revision.issuedAt)) throw new BusinessRuleError("VALIDATION_ERROR", "The send date can't be before the quotation was issued.", { fieldErrors: { sentOn: "Before issue." } });
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.quotationRevision.updateMany({
      where: { id: revision.id, status: "ISSUED" },
      data: { sentAt: new Date(input.sentOn), sentByUserId: actor.userId, sentTo: input.sentTo, sentMethod: input.method },
    });
    if (count === 0) throw new BusinessRuleError("RECORD_VERSION_CONFLICT", "This quotation changed just now. Reload and try again.");
    await finish(tx, actor, quotation, revision.revisionNumber, "SENT", "ISSUED", "ISSUED", input.comment || null, { sentTo: input.sentTo, method: input.method, sentOn: input.sentOn });
  });
  return afterAction(actor, id);
}

// ── Customer decision ────────────────────────────────────────────

function checkDecisionDate(revision: QuotationRevision, date: string) {
  if (date > todayIsoDate()) throw new BusinessRuleError("VALIDATION_ERROR", "The decision date can't be in the future.", { fieldErrors: { decisionDate: "In the future." } });
  if (revision.issuedAt && date < toIsoDate(revision.issuedAt)) {
    throw new BusinessRuleError("VALIDATION_ERROR", "The decision date can't be before the quotation was issued.", { fieldErrors: { decisionDate: "Before issue." } });
  }
}

/** The customer accepted this exact revision. Not allowed once it had expired on the decision date. */
export async function recordAcceptance(actor: SalesActor, id: string, raw: unknown) {
  const input = acceptSchema.parse(raw ?? {});
  const { quotation, revision } = await loadForAction(actor, id);
  requireStatus(quotation, ["ISSUED"], "accepted");
  checkDecisionDate(revision, input.decisionDate);
  if (input.decisionDate > toIsoDate(revision.validUntil)) {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", `Revision ${revision.revisionNumber} was only valid until ${toIsoDate(revision.validUntil)}. Make a new revision with a new validity to accept it.`);
  }
  await prisma.$transaction(async (tx) => {
    await move(tx, quotation, revision, {
      quotation: "ACCEPTED",
      revision: "ACCEPTED",
      revisionData: {
        customerDecisionAt: new Date(input.decisionDate),
        decisionRecordedAt: new Date(),
        decisionRecordedById: actor.userId,
        decisionMethod: input.method,
        customerReference: input.customerReference || null,
        decisionComment: input.comment || null,
      },
    });
    await finish(tx, actor, quotation, revision.revisionNumber, "ACCEPTED", "ISSUED", "ACCEPTED", input.comment || null, {
      method: input.method,
      customerReference: input.customerReference || null,
      decisionDate: input.decisionDate,
    });
    await notify(tx, actor, quotation, [quotation.ownerUserId], `Quotation ${quotation.quotationNumber} accepted`, `Revision ${revision.revisionNumber} — ready to convert to a Sales Order.`);
  });
  return afterAction(actor, id);
}

export async function recordRejection(actor: SalesActor, id: string, raw: unknown) {
  const input = rejectSchema.parse(raw ?? {});
  const { quotation, revision } = await loadForAction(actor, id);
  requireStatus(quotation, ["ISSUED"], "rejected");
  checkDecisionDate(revision, input.decisionDate);
  await prisma.$transaction(async (tx) => {
    await move(tx, quotation, revision, {
      quotation: "REJECTED",
      revision: "REJECTED",
      revisionData: {
        customerDecisionAt: new Date(input.decisionDate),
        decisionRecordedAt: new Date(),
        decisionRecordedById: actor.userId,
        decisionMethod: input.method ?? null,
        decisionComment: input.reason,
      },
    });
    await finish(tx, actor, quotation, revision.revisionNumber, "REJECTED", "ISSUED", "REJECTED", input.reason, { decisionDate: input.decisionDate });
    await notify(tx, actor, quotation, [quotation.ownerUserId], `Quotation ${quotation.quotationNumber} rejected by the customer`, input.reason);
  });
  return afterAction(actor, id);
}

// ── Revise ───────────────────────────────────────────────────────

const COPY_FIELDS = [
  "title",
  "currencyCode",
  "companyStateCode",
  "placeOfSupplyStateCode",
  "isInterState",
  "billingAddress",
  "shippingAddress",
  "paymentTermsDays",
  "deliveryTerms",
  "introduction",
  "customerNotes",
  "internalNotes",
  "termsAndConditions",
  "freightAmount",
  "freightTaxRateId",
  "freightGstRate",
  "freightTaxAmount",
  "otherChargesLabel",
  "otherChargesAmount",
  "otherChargesTaxRateId",
  "otherChargesGstRate",
  "otherChargesTaxAmount",
  "subtotalAmount",
  "discountTotal",
  "taxableTotal",
  "chargesTotal",
  "cgstTotal",
  "sgstTotal",
  "igstTotal",
  "taxTotal",
  "grandTotal",
] as const;

/**
 * Starts revision n+1 as a DRAFT copy of the current one (dated today, with
 * the default validity). An ISSUED revision becomes SUPERSEDED — it stays as
 * issued history (PDF, timeline) but can no longer be accepted.
 */
export async function reviseQuotation(actor: SalesActor, id: string, raw: unknown) {
  const { reason } = reasonSchema.parse(raw ?? {});
  const { quotation, revision } = await loadForAction(actor, id);
  requireStatus(quotation, ["ISSUED", "REJECTED"], "revised");
  const settings = await getSalesMarketingSettings(actor.companyId);
  const today = new Date(todayIsoDate());
  const validUntil = new Date(today.getFullYear(), today.getMonth(), today.getDate() + settings.quotationDefaultValidityDays);
  const next = revision.revisionNumber + 1;
  const copied = Object.fromEntries(COPY_FIELDS.map((k) => [k, revision[k]])) as Pick<QuotationRevision, (typeof COPY_FIELDS)[number]>;

  await prisma.$transaction(async (tx) => {
    const q = await tx.quotation.updateMany({
      where: { id: quotation.id, status: quotation.status, currentRevisionNumber: revision.revisionNumber },
      data: { status: "DRAFT", currentRevisionNumber: next },
    });
    if (q.count === 0) throw new BusinessRuleError("RECORD_VERSION_CONFLICT", "This quotation changed just now. Reload and try again.");
    if (revision.status === "ISSUED") await tx.quotationRevision.update({ where: { id: revision.id }, data: { status: "SUPERSEDED" } });
    await tx.quotationRevision.create({
      data: {
        ...copied,
        companyId: actor.companyId,
        quotationId: quotation.id,
        revisionNumber: next,
        status: "DRAFT",
        quotationDate: new Date(toIsoDate(today)),
        validUntil: new Date(toIsoDate(validUntil)),
        revisionReason: reason,
        previousRevisionId: revision.id,
        createdByUserId: actor.userId,
        lines: {
          create: revision.lines.map((l) => {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { id: _id, revisionId: _rev, createdAt: _c, ...rest } = l;
            return rest;
          }),
        },
      },
    });
    await finish(tx, actor, quotation, next, "REVISED", quotation.status, "DRAFT", reason, { from: revision.revisionNumber, to: next, previousStatus: revision.status });
  });
  return afterAction(actor, id);
}

// ── Cancel ───────────────────────────────────────────────────────

/** Any open quotation can be cancelled with a reason (an issued one is withdrawn). Accepted ones can't — S4 converts them. */
export async function cancelQuotation(actor: SalesActor, id: string, raw: unknown) {
  const { reason } = reasonSchema.parse(raw ?? {});
  const { quotation, revision } = await loadForAction(actor, id);
  requireStatus(quotation, ["DRAFT", "PENDING_APPROVAL", "APPROVED", "ISSUED"], "cancelled");
  await prisma.$transaction(async (tx) => {
    await move(tx, quotation, revision, {
      quotation: "CANCELLED",
      revision: "CANCELLED",
      quotationData: { cancelledAt: new Date(), cancellationReason: reason },
    });
    if (quotation.buyerEnquiryId) await releaseEnquiryQuotation(tx, actor, quotation.buyerEnquiryId, quotation.quotationNumber, OPEN_QUOTATION_STATUSES);
    await finish(tx, actor, quotation, revision.revisionNumber, "CANCELLED", quotation.status, "CANCELLED", reason);
  });
  return afterAction(actor, id);
}
