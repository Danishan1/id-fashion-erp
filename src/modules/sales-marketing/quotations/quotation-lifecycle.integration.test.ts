/**
 * Quotation lifecycle (Sales & Marketing Release 1 / S3) against a real,
 * migrated + seeded Postgres database. Skipped unless CRM_IT_DATABASE_URL
 * points at a DISPOSABLE database.
 *
 * Permissions are mocked: "manager" has view_all + approve, "approver" has
 * approve only, "rep" / "rep2" neither. The approve check honours the
 * self-approval rule (createdBy === user → denied), like PermissionService.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { alignEnquiryCounter } from "../integration-test-helpers";

const DB_URL = process.env.CRM_IT_DATABASE_URL;
if (DB_URL) process.env.DATABASE_URL = DB_URL;

const viewAllUsers = new Set<string>();
const approvers = new Set<string>();
vi.mock("@/core/rbac/PermissionService", () => ({
  PermissionService: {
    can: vi.fn(async (userId: string, _module: string, action: string, ctx?: { createdBy?: string }) => {
      if (action === "view_all") return viewAllUsers.has(userId);
      if (action === "approve") return approvers.has(userId) && ctx?.createdBy !== userId;
      return true;
    }),
    assert: vi.fn(async () => undefined),
    getAllowedBranchIds: vi.fn(async () => null),
    invalidate: vi.fn(),
  },
}));

type Actor = { companyId: string; userId: string; branchId: string | null };

describe.skipIf(!DB_URL)("Quotation lifecycle (database integration)", async () => {
  const { prisma } = await import("@/core/db/client");
  const svc = await import("./quotation.service");
  const lifeModule = await import("./quotation-lifecycle.service");
  // Actions return the quotation, or { id, visible: false } when the actor can no longer see it.
  // Tests read the quotation fields directly, so type the results as the detail.
  type Detail = Awaited<ReturnType<typeof svc.getQuotation>>;
  const asDetail =
    <A extends unknown[]>(fn: (...args: A) => Promise<unknown>) =>
    (...args: A) =>
      fn(...args) as Promise<Detail>;
  const life = {
    submitForApproval: asDetail(lifeModule.submitForApproval),
    returnToDraft: asDetail(lifeModule.returnToDraft),
    approveQuotation: asDetail(lifeModule.approveQuotation),
    declineApproval: asDetail(lifeModule.declineApproval),
    issueQuotation: asDetail(lifeModule.issueQuotation),
    markQuotationSent: asDetail(lifeModule.markQuotationSent),
    recordAcceptance: asDetail(lifeModule.recordAcceptance),
    recordRejection: asDetail(lifeModule.recordRejection),
    reviseQuotation: asDetail(lifeModule.reviseQuotation),
    cancelQuotation: asDetail(lifeModule.cancelQuotation),
  };
  const enquiries = await import("@/modules/sales-marketing/enquiries/sales-enquiry.service");
  const settings = await import("@/modules/sales-marketing/settings/sales-marketing-settings.service");
  const { buildQuotationPdfDescriptor } = await import("./quotation-pdf");
  const { renderBusinessDocumentPdf } = await import("@/core/documents/document-pdf");

  const run = `l${Date.now().toString(36)}`;
  let manager: Actor, approver: Actor, rep: Actor, rep2: Actor;
  let customer: string, gst5: string;
  let savedSettings: Awaited<ReturnType<typeof settings.getSalesMarketingSettings>>;
  const today = new Date().toISOString().slice(0, 10);
  const plusDays = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  const expectCode = (p: Promise<unknown>, code: string) =>
    code === "VALIDATION_ERROR"
      ? p.then(
          () => expect.unreachable("expected a validation error"),
          (e: { name?: string; code?: string }) => expect(e.name === "ZodError" || e.code === "VALIDATION_ERROR").toBe(true)
        )
      : expect(p).rejects.toMatchObject({ code });
  // ₹10,000 + 5% = ₹10,500 — within the default limits.
  const small = (extra: Record<string, unknown> = {}) => ({
    customerId: customer,
    title: `${run} small`,
    quotationDate: today,
    validUntil: plusDays(30),
    lines: [{ description: "Polo", quantity: 100, unitPrice: 100, discountPercent: 0, taxRateId: gst5 }],
    termsAndConditions: "50% advance",
    internalNotes: "do not print",
    ...extra,
  });
  // 12% discount → needs approval under the default 10% limit.
  const discounted = () => small({ title: `${run} discounted`, lines: [{ description: "Polo", quantity: 100, unitPrice: 100, discountPercent: 12, taxRateId: gst5 }] });
  const status = async (id: string) => (await prisma.quotation.findUniqueOrThrow({ where: { id } })).status;
  const events = async (id: string) => (await prisma.quotationEvent.findMany({ where: { quotationId: id }, orderBy: { createdAt: "asc" } })).map((e) => e.type);

  beforeAll(async () => {
    const company = await prisma.company.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
    await alignEnquiryCounter(prisma, company.id);
    savedSettings = await settings.getSalesMarketingSettings(company.id);
    const mk = (n: string) => prisma.user.create({ data: { companyId: company.id, email: `${n}.${run}@ql-it.local`, passwordHash: "x", fullName: `${n} ${run}` } });
    const [m, a, r, r2] = await Promise.all([mk("manager"), mk("approver"), mk("rep"), mk("rep2")]);
    const actor = (id: string) => ({ companyId: company.id, userId: id, branchId: null });
    [manager, approver, rep, rep2] = [actor(m.id), actor(a.id), actor(r.id), actor(r2.id)];
    viewAllUsers.add(m.id);
    approvers.add(m.id);
    approvers.add(a.id);
    await settings.updateSalesMarketingSettings(manager, { quotationApprovalMaxDiscountPercent: 10, quotationApprovalMaxTotal: 500000, quotationDefaultValidityDays: 30, quotationDefaultTerms: "" });
    customer = (await prisma.customer.create({ data: { companyId: company.id, code: `QL-${run}`, name: `Lifecycle Customer ${run}`, billingAddress: "1 Mill Road", taxRegistrationNo: "33AABCL1111A1Z2" } })).id;
    const taxType = await prisma.taxType.create({ data: { companyId: company.id, code: `GSTL-${run}`, name: "GST" } });
    gst5 = (await prisma.taxRate.create({ data: { companyId: company.id, taxTypeId: taxType.id, name: `GST 5% ${run}`, ratePercentage: "5", effectiveFrom: new Date("2020-01-01") } })).id;
  });

  afterAll(async () => {
    await settings.updateSalesMarketingSettings(manager, {
      quotationApprovalMaxDiscountPercent: savedSettings.quotationApprovalMaxDiscountPercent,
      quotationApprovalMaxTotal: savedSettings.quotationApprovalMaxTotal,
      quotationDefaultValidityDays: savedSettings.quotationDefaultValidityDays,
      quotationDefaultTerms: savedSettings.quotationDefaultTerms ?? "",
    });
    await prisma.$disconnect();
  });

  it("issues a quotation within the limits directly, freezes it and snapshots the printed parties", async () => {
    const q = await svc.createQuotation(rep, small());
    await expectCode(life.submitForApproval(rep, q.id, {}), "INVALID_STATE_TRANSITION"); // nothing to approve
    const issued = await life.issueQuotation(rep, q.id, {});
    expect(issued).toMatchObject({ status: "ISSUED", current: { status: "ISSUED", approvalRequired: false } });
    expect(issued.current.issuedAt).not.toBeNull();
    expect(issued.current.documentSnapshot).toMatchObject({ partyName: `Lifecycle Customer ${run}`, partyLines: expect.arrayContaining(["1 Mill Road", "GSTIN: 33AABCL1111A1Z2"]) });
    await expectCode(svc.updateQuotationDraft(rep, q.id, { ...small(), version: issued.current.version }), "INVALID_STATE_TRANSITION");
    await expectCode(life.issueQuotation(rep, q.id, {}), "INVALID_STATE_TRANSITION");
    expect(await events(q.id)).toEqual(["CREATED", "ISSUED"]);

    // The PDF prints the frozen revision, never internal notes.
    const descriptor = await buildQuotationPdfDescriptor(issued, "Rep");
    expect(descriptor).toMatchObject({ docTitle: "Quotation", partyName: `Lifecycle Customer ${run}` });
    expect(JSON.stringify(descriptor)).not.toContain("do not print");
    expect(descriptor.totalsLines.at(-1)).toMatchObject({ label: "Grand total", final: true });
    const pdf = await renderBusinessDocumentPdf(descriptor);
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
  });

  it("routes an over-limit quotation through approval by someone else", async () => {
    const q = await svc.createQuotation(rep, discounted());
    await expectCode(life.issueQuotation(rep, q.id, {}), "INVALID_STATE_TRANSITION");
    const draftView = await svc.getQuotation(rep, q.id);
    expect(draftView.approvalPreview).toEqual(["Discount 12% on line 1 is above the 10% limit"]);

    const pending = await life.submitForApproval(rep, q.id, { comment: "Repeat buyer" });
    expect(pending).toMatchObject({ status: "PENDING_APPROVAL", current: { approvalRequired: true, submittedByUserId: rep.userId } });
    expect(pending.current.approvalReasons).toEqual(["Discount 12% on line 1 is above the 10% limit"]);
    // Approvers are notified; an approver without view_all can see it while it waits.
    expect(await prisma.notification.count({ where: { relatedRecordId: q.id, userId: approver.userId } })).toBe(1);
    expect((await svc.getQuotation(approver, q.id)).viewerCanApprove).toBe(true);
    expect((await svc.getQuotation(rep, q.id)).viewerCanApprove).toBe(false);
    await expectCode(svc.updateQuotationDraft(rep, q.id, { ...discounted(), version: pending.current.version }), "INVALID_STATE_TRANSITION");

    // Declined → back to draft with the reason; resubmit; approved by the approver.
    expect(await life.declineApproval(approver, q.id, { reason: "Max 10% for this buyer" })).toEqual({ id: q.id, visible: false });
    const declined = await svc.getQuotation(rep, q.id);
    expect(declined).toMatchObject({ status: "DRAFT", current: { approvalComment: "Max 10% for this buyer", submittedByUserId: null } });
    await life.submitForApproval(rep, q.id, {});
    // The approver (no view_all) no longer sees it once it is approved.
    expect(await life.approveQuotation(approver, q.id, { comment: "OK this once" })).toEqual({ id: q.id, visible: false });
    const approved = await svc.getQuotation(rep, q.id);
    expect(approved).toMatchObject({ status: "APPROVED", current: { approvedByUserId: approver.userId, approvalComment: "OK this once" } });
    await expectCode(life.approveQuotation(manager, q.id, {}), "INVALID_STATE_TRANSITION");
    const issued = await life.issueQuotation(rep, q.id, {});
    expect(issued.status).toBe("ISSUED");
    expect(await events(q.id)).toEqual(["CREATED", "SUBMITTED", "APPROVAL_REJECTED", "SUBMITTED", "APPROVED", "ISSUED"]);
  });

  it("never lets the person who prepared or submitted a revision approve it", async () => {
    approvers.add(rep2.userId);
    try {
      const q = await svc.createQuotation(rep2, discounted());
      await life.submitForApproval(rep2, q.id, {});
      await expectCode(life.approveQuotation(rep2, q.id, {}), "SELF_APPROVAL_NOT_ALLOWED");
      // Someone else saved it last → they can't approve either.
      await life.returnToDraft(manager, q.id, {});
      const d = await svc.getQuotation(manager, q.id);
      await svc.updateQuotationDraft(manager, q.id, { ...discounted(), version: d.current.version });
      await life.submitForApproval(rep2, q.id, {});
      await expectCode(life.approveQuotation(manager, q.id, {}), "SELF_APPROVAL_NOT_ALLOWED");
      await life.approveQuotation(approver, q.id, {});
      expect(await status(q.id)).toBe("APPROVED");
    } finally {
      approvers.delete(rep2.userId);
    }
  });

  it("lets only one of two concurrent approvals through", async () => {
    const q = await svc.createQuotation(rep, discounted());
    await life.submitForApproval(rep, q.id, {});
    const results = await Promise.allSettled([life.approveQuotation(approver, q.id, {}), life.approveQuotation(manager, q.id, {})]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await events(q.id)).filter((e) => e === "APPROVED")).toHaveLength(1);
  });

  it("follows the company limits from settings", async () => {
    await settings.updateSalesMarketingSettings(manager, { quotationApprovalMaxDiscountPercent: 15, quotationApprovalMaxTotal: 500000, quotationDefaultValidityDays: 30 });
    try {
      const q = await svc.createQuotation(rep, discounted());
      await expect(life.issueQuotation(rep, q.id, {})).resolves.toMatchObject({ status: "ISSUED" });
      await settings.updateSalesMarketingSettings(manager, { quotationApprovalMaxDiscountPercent: 15, quotationApprovalMaxTotal: 5000, quotationDefaultValidityDays: 30 });
      const big = await svc.createQuotation(rep, small());
      await expectCode(life.issueQuotation(rep, big.id, {}), "INVALID_STATE_TRANSITION"); // ₹10,500 > ₹5,000
    } finally {
      await settings.updateSalesMarketingSettings(manager, { quotationApprovalMaxDiscountPercent: 10, quotationApprovalMaxTotal: 500000, quotationDefaultValidityDays: 30 });
    }
    await expectCode(settings.updateSalesMarketingSettings(manager, { quotationApprovalMaxDiscountPercent: 101, quotationApprovalMaxTotal: 1, quotationDefaultValidityDays: 30 }), "VALIDATION_ERROR");
  });

  it("records sending and acceptance against the exact revision, within validity", async () => {
    const q = await svc.createQuotation(rep, small({ validUntil: plusDays(10) }));
    await expectCode(life.markQuotationSent(rep, q.id, { sentTo: "buyer@x.com", method: "EMAIL", sentOn: today }), "INVALID_STATE_TRANSITION"); // not issued
    await life.issueQuotation(rep, q.id, {});
    await expectCode(life.markQuotationSent(rep, q.id, { sentTo: "buyer@x.com", method: "EMAIL", sentOn: plusDays(1) }), "VALIDATION_ERROR");
    const sent = await life.markQuotationSent(rep, q.id, { sentTo: "buyer@x.com", method: "EMAIL", sentOn: today });
    expect(sent.current).toMatchObject({ sentTo: "buyer@x.com", sentMethod: "EMAIL", sentByUserId: rep.userId });
    await expectCode(life.recordAcceptance(rep, q.id, { decisionDate: plusDays(2), method: "PURCHASE_ORDER" }), "VALIDATION_ERROR"); // future
    const accepted = await life.recordAcceptance(rep, q.id, { decisionDate: today, method: "PURCHASE_ORDER", customerReference: "PO-7781", comment: "Signed PO attached" });
    expect(accepted).toMatchObject({ status: "ACCEPTED", current: { status: "ACCEPTED", decisionMethod: "PURCHASE_ORDER", customerReference: "PO-7781", decisionRecordedById: rep.userId } });
    await expectCode(life.reviseQuotation(rep, q.id, { reason: "change" }), "INVALID_STATE_TRANSITION");
    await expectCode(life.cancelQuotation(rep, q.id, { reason: "change" }), "INVALID_STATE_TRANSITION");
    await expectCode(life.recordRejection(rep, q.id, { decisionDate: today, reason: "too late" }), "INVALID_STATE_TRANSITION");
  });

  it("treats a quotation past its validity as expired: no acceptance, but rejection and revision work", async () => {
    const q = await svc.createQuotation(rep, small());
    await life.issueQuotation(rep, q.id, {});
    await prisma.quotationRevision.updateMany({ where: { quotationId: q.id }, data: { quotationDate: new Date(plusDays(-20)), validUntil: new Date(plusDays(-1)), issuedAt: new Date(plusDays(-20)) } });
    expect((await svc.getQuotation(rep, q.id)).isExpired).toBe(true);
    expect((await svc.listQuotations(rep, {}, { sortBy: "createdAt", sortOrder: "desc" }, { skip: 0, take: 50, search: `${run} small` })).data.find((r) => r.id === q.id)?.isExpired).toBe(true);
    await expectCode(life.recordAcceptance(rep, q.id, { decisionDate: today, method: "EMAIL" }), "INVALID_STATE_TRANSITION");
    // A decision made while it was still valid can be recorded later.
    const late = await svc.createQuotation(rep, small());
    await life.issueQuotation(rep, late.id, {});
    await prisma.quotationRevision.updateMany({ where: { quotationId: late.id }, data: { quotationDate: new Date(plusDays(-20)), validUntil: new Date(plusDays(-2)), issuedAt: new Date(plusDays(-20)) } });
    await expect(life.recordAcceptance(rep, late.id, { decisionDate: plusDays(-5), method: "EMAIL" })).resolves.toMatchObject({ status: "ACCEPTED" });

    const revised = await life.reviseQuotation(rep, q.id, { reason: "New season prices" });
    expect(revised).toMatchObject({ status: "DRAFT", currentRevisionNumber: 2, current: { revisionNumber: 2, status: "DRAFT", revisionReason: "New season prices" } });
    expect(revised.isExpired).toBe(false);
    expect(revised.current.lines).toHaveLength(1);
  });

  it("revises: the issued revision is superseded and kept unchanged, the new one is edited and issued", async () => {
    const q = await svc.createQuotation(rep, small());
    const r1 = await life.issueQuotation(rep, q.id, {});
    const revised = await life.reviseQuotation(rep, q.id, { reason: "Customer wants 200 pcs" });
    expect(revised.current.previousRevisionId).toBe(r1.current.id);
    await expectCode(life.reviseQuotation(rep, q.id, { reason: "again" }), "INVALID_STATE_TRANSITION"); // already a draft
    await svc.updateQuotationDraft(rep, q.id, { ...small({ lines: [{ description: "Polo", quantity: 200, unitPrice: 95, taxRateId: gst5 }] }), version: revised.current.version });
    const r2 = await life.issueQuotation(rep, q.id, {});
    expect(r2.current).toMatchObject({ revisionNumber: 2, status: "ISSUED" });
    expect(Number(r2.current.grandTotal)).toBe(19950);
    const old = await svc.getQuotation(rep, q.id, 1);
    expect(old.current).toMatchObject({ revisionNumber: 1, status: "SUPERSEDED" });
    expect(Number(old.current.grandTotal)).toBe(10500);
    expect(old.isCurrentRevision).toBe(false);
    expect(old.revisions.map((r) => [r.revisionNumber, r.status])).toEqual([[2, "ISSUED"], [1, "SUPERSEDED"]]);
    expect((await buildQuotationPdfDescriptor(old, "x")).docNumber).toBe(`${q.quotationNumber}`);
    expect((await buildQuotationPdfDescriptor(r2, "x")).docNumber).toBe(`${q.quotationNumber} / Rev 2`);
    // A customer rejection can be revised too.
    await life.recordRejection(rep, q.id, { decisionDate: today, reason: "Price too high" });
    expect(await status(q.id)).toBe("REJECTED");
    await expect(life.reviseQuotation(rep, q.id, { reason: "Better price" })).resolves.toMatchObject({ currentRevisionNumber: 3 });
    expect((await svc.getQuotation(rep, q.id, 2)).current.status).toBe("REJECTED");
  });

  it("moves a linked enquiry to Quoted on issue and back to Qualified when its only quotation is withdrawn", async () => {
    const e = await enquiries.createSalesEnquiry(rep, { customerId: customer, enquiryDate: today, subject: `${run} enquiry`, lines: [{ styleNameFreeText: "Tee", targetQuantity: 100 }] });
    const prefill = await svc.getQuotationPrefillFromEnquiry(rep, e.id);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { enquiryNumber, customerName, ...body } = prefill;
    const q = await svc.createQuotation(rep, { ...body, lines: body.lines.map((l) => ({ ...l, unitPrice: 100, taxRateId: gst5 })) } as never);
    await life.issueQuotation(rep, q.id, {});
    expect((await prisma.buyerEnquiry.findUniqueOrThrow({ where: { id: e.id } })).salesStage).toBe("QUOTED");
    const cancelled = await life.cancelQuotation(rep, q.id, { reason: "Withdrawn — fabric price change" });
    expect(cancelled).toMatchObject({ status: "CANCELLED", current: { status: "CANCELLED" } });
    expect((await prisma.buyerEnquiry.findUniqueOrThrow({ where: { id: e.id } })).salesStage).toBe("QUALIFIED");
  });
});
