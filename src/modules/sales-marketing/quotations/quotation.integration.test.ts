/**
 * Quotations core (Sales & Marketing Release 1 / S2) against a real, migrated
 * + seeded Postgres database. Skipped unless CRM_IT_DATABASE_URL points at a
 * DISPOSABLE database:
 *   CRM_IT_DATABASE_URL=postgresql://…/crm_it npx vitest run src/modules/sales-marketing/quotations
 *
 * Only permissions are mocked: "manager" has view_all; "outsider" has no
 * quotation access; everyone has enquiry and CRM access.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { alignEnquiryCounter } from "../integration-test-helpers";

const DB_URL = process.env.CRM_IT_DATABASE_URL;
if (DB_URL) process.env.DATABASE_URL = DB_URL;

const viewAllUsers = new Set<string>();
const noQuoteUsers = new Set<string>();
vi.mock("@/core/rbac/PermissionService", () => ({
  PermissionService: {
    can: vi.fn(async (userId: string, module: string, action: string) => {
      if (action === "view_all") return viewAllUsers.has(userId);
      if (module === "sales_quotations") return !noQuoteUsers.has(userId);
      return true;
    }),
    assert: vi.fn(async () => undefined),
    getAllowedBranchIds: vi.fn(async () => null),
    invalidate: vi.fn(),
  },
}));

type Actor = { companyId: string; userId: string; branchId: string | null };

describe.skipIf(!DB_URL)("Quotations (database integration)", async () => {
  const { prisma } = await import("@/core/db/client");
  const svc = await import("./quotation.service");
  const life = await import("./quotation-lifecycle.service");
  const enquiries = await import("@/modules/sales-marketing/enquiries/sales-enquiry.service");
  const { assertAttachmentAccess } = await import("@/core/attachments/attachment-targets");

  const run = `q${Date.now().toString(36)}`;
  let manager: Actor, rep: Actor, otherRep: Actor, outsider: Actor;
  let companyGstin: string | null;
  let customerTN: string, customerMH: string, buyerMH: string;
  let gst5: string, gst18: string, gstOld: string;
  let style: string, rawMaterial: string, approvedDesign: string, pendingDesign: string;
  const today = new Date().toISOString().slice(0, 10);
  const plusDays = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  const expectCode = (p: Promise<unknown>, code: string) =>
    code === "VALIDATION_ERROR"
      ? p.then(
          () => expect.unreachable("expected a validation error"),
          (e: { name?: string; code?: string }) => expect(e.name === "ZodError" || e.code === "VALIDATION_ERROR").toBe(true)
        )
      : expect(p).rejects.toMatchObject({ code });
  const draft = (extra: Record<string, unknown> = {}) => ({
    customerId: customerMH,
    buyerId: buyerMH,
    title: `${run} AW27 tops`,
    quotationDate: today,
    validUntil: plusDays(30),
    placeOfSupplyStateCode: "27",
    freightAmount: 1500,
    freightTaxRateId: gst18,
    lines: [
      { productId: style, description: "Crew neck tee", quantity: 1200, unitPrice: 245.5, discountPercent: 5, taxRateId: gst5 },
      { description: "Hang tags (new item)", quantity: 1200, unitPrice: 2.25, taxRateId: gst18 },
    ],
    ...extra,
  });
  const page = (search?: string) => ({ skip: 0, take: 100, search });
  const sort = { sortBy: "createdAt" as const, sortOrder: "desc" as const };

  beforeAll(async () => {
    const company = await prisma.company.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
    await alignEnquiryCounter(prisma, company.id);
    companyGstin = company.taxRegistrationNo;
    await prisma.company.update({ where: { id: company.id }, data: { taxRegistrationNo: "33AAACQ1234A1Z5" } }); // Tamil Nadu
    const mk = (n: string) => prisma.user.create({ data: { companyId: company.id, email: `${n}.${run}@q-it.local`, passwordHash: "x", fullName: `${n} ${run}` } });
    const [m, r, o, x] = await Promise.all([mk("manager"), mk("rep"), mk("otherrep"), mk("outsider")]);
    const actor = (id: string) => ({ companyId: company.id, userId: id, branchId: null });
    [manager, rep, otherRep, outsider] = [actor(m.id), actor(r.id), actor(o.id), actor(x.id)];
    viewAllUsers.add(m.id);
    noQuoteUsers.add(x.id);

    customerTN = (await prisma.customer.create({ data: { companyId: company.id, code: `Q-${run}-TN`, name: `Chennai Knits ${run}`, taxRegistrationNo: "33AABCC1111A1Z2", paymentTermsDays: 45 } })).id;
    const mh = await prisma.customer.create({ data: { companyId: company.id, code: `Q-${run}-MH`, name: `Mumbai Retail ${run}`, taxRegistrationNo: "27AABCM2222B1Z3" } });
    customerMH = mh.id;
    buyerMH = (await prisma.buyer.create({ data: { companyId: company.id, customerId: mh.id, code: `B-${run}`, name: `Buyer ${run}` } })).id;

    const taxType = await prisma.taxType.create({ data: { companyId: company.id, code: `GST-${run}`, name: "GST" } });
    const rate = (name: string, pct: string, from: string, to: string | null = null) =>
      prisma.taxRate.create({ data: { companyId: company.id, taxTypeId: taxType.id, name, ratePercentage: pct, effectiveFrom: new Date(from), effectiveTo: to ? new Date(to) : null } });
    gst5 = (await rate(`GST 5% ${run}`, "5", "2020-01-01")).id;
    gst18 = (await rate(`GST 18% ${run}`, "18", "2020-01-01")).id;
    gstOld = (await rate(`GST 12% old ${run}`, "12", "2019-01-01", "2020-01-01")).id;

    const uom = await prisma.unitOfMeasure.findFirst();
    const product = (code: string, itemType: "STYLE" | "RAW_MATERIAL") =>
      prisma.product.create({ data: { companyId: company.id, styleCode: `${code}-${run}`, styleName: `${code} ${run}`, itemType, baseUomId: uom?.id } });
    style = (await product("TEE", "STYLE")).id;
    rawMaterial = (await product("YARN", "RAW_MATERIAL")).id;
    const sample = (status: "APPROVED" | "IN_DEVELOPMENT", n: number) =>
      prisma.sampleRequest.create({ data: { companyId: company.id, requestNumber: `SAM-${run}-${n}`, customerId: mh.id, requestedByUserId: r.id, requestDate: new Date(), status, styleName: `Design ${n}` } });
    approvedDesign = (await sample("APPROVED", 1)).id;
    pendingDesign = (await sample("IN_DEVELOPMENT", 2)).id;
  });

  afterAll(async () => {
    const company = await prisma.company.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
    await prisma.company.update({ where: { id: company.id }, data: { taxRegistrationNo: companyGstin } });
    await prisma.$disconnect();
  });

  it("creates a draft with server-computed IGST totals, QUO number and line types", async () => {
    const q = await svc.createQuotation(rep, draft({ lines: [...draft().lines, { sampleRequestId: approvedDesign, description: "Design 1", quantity: 300, unitPrice: 310 }] }));
    expect(q.quotationNumber).toMatch(/^QUO-\d{4}-\d{5}$/);
    const d = await svc.getQuotation(rep, q.id);
    expect(d).toMatchObject({ status: "DRAFT", currentRevisionNumber: 1, ownerUserId: rep.userId, customerId: customerMH });
    const c = d.current;
    expect(c).toMatchObject({ status: "DRAFT", revisionNumber: 1, isInterState: true, companyStateCode: "33", placeOfSupplyStateCode: "27", currencyCode: "INR", version: 1 });
    expect(c.lines.map((l) => l.lineType)).toEqual(["STYLE", "FREE_TEXT", "DESIGN"]);
    // 1200 × 245.50 = 294600, −5% = 279870, IGST 5% = 13993.50
    expect(c.lines[0]).toMatchObject({ lineNumber: 1 });
    expect(Number(c.lines[0].taxableAmount)).toBe(279870);
    expect(Number(c.lines[0].igstAmount)).toBe(13993.5);
    expect(Number(c.lines[0].cgstAmount)).toBe(0);
    expect(Number(c.lines[1].taxAmount)).toBe(486); // 2700 × 18%
    expect(Number(c.lines[2].taxAmount)).toBe(0); // no GST rate chosen
    expect(Number(c.freightTaxAmount)).toBe(270);
    expect(Number(c.taxableTotal)).toBe(279870 + 2700 + 93000);
    expect(Number(c.taxTotal)).toBe(13993.5 + 486 + 270);
    expect(Number(c.igstTotal)).toBe(Number(c.taxTotal));
    expect(Number(c.grandTotal)).toBe(279870 + 2700 + 93000 + 1500 + 13993.5 + 486 + 270);
    expect(await prisma.auditLog.count({ where: { recordId: q.id, tableName: "quotations", action: "CREATE" } })).toBe(1);
  });

  it("splits CGST/SGST for a same-state customer and allows prospects; refuses neither", async () => {
    const q = await svc.createQuotation(rep, draft({ customerId: customerTN, buyerId: "", placeOfSupplyStateCode: "33" }));
    const c = (await svc.getQuotation(rep, q.id)).current;
    expect(c.isInterState).toBe(false);
    expect(Number(c.cgstTotal) + Number(c.sgstTotal)).toBe(Number(c.taxTotal));
    expect(Number(c.lines[0].cgstRate)).toBe(2.5);
    const p = await svc.createQuotation(rep, draft({ customerId: "", buyerId: "", prospectName: `${run} Nordic Threads` }));
    expect((await svc.getQuotation(rep, p.id)).prospectName).toBe(`${run} Nordic Threads`);
    await expectCode(svc.createQuotation(rep, draft({ customerId: "", buyerId: "" })), "VALIDATION_ERROR");
  });

  it("never accepts client totals and validates every reference", async () => {
    await expectCode(svc.createQuotation(rep, { ...draft(), grandTotal: 1 }), "VALIDATION_ERROR"); // strict payload
    await expectCode(svc.createQuotation(rep, draft({ lines: [{ productId: rawMaterial, description: "x", quantity: 1, unitPrice: 1 }] })), "VALIDATION_ERROR");
    await expectCode(svc.createQuotation(rep, draft({ lines: [{ sampleRequestId: pendingDesign, description: "x", quantity: 1, unitPrice: 1 }] })), "VALIDATION_ERROR");
    await expectCode(svc.createQuotation(rep, draft({ lines: [{ description: "x", quantity: 1, unitPrice: 1, taxRateId: gstOld }] })), "VALIDATION_ERROR"); // not effective
    await expectCode(svc.createQuotation(rep, draft({ lines: [{ description: "x", quantity: 0, unitPrice: 1 }] })), "VALIDATION_ERROR");
    await expectCode(svc.createQuotation(rep, draft({ lines: [{ description: "x", quantity: 1, unitPrice: 1, discountPercent: 101 }] })), "VALIDATION_ERROR");
    await expectCode(svc.createQuotation(rep, draft({ validUntil: plusDays(-1) })), "VALIDATION_ERROR");
    await expectCode(svc.createQuotation(rep, draft({ buyerId: crypto.randomUUID() })), "NOT_FOUND");
    await expectCode(svc.createQuotation(rep, draft({ ownerUserId: outsider.userId })), "VALIDATION_ERROR");
    await expectCode(svc.createQuotation(rep, draft({ placeOfSupplyStateCode: "99" })), "VALIDATION_ERROR");
  });

  it("creates from an enquiry: prefill, party from the enquiry, enquiry moves to quotation in progress and back on cancel", async () => {
    const e = await enquiries.createSalesEnquiry(rep, {
      customerId: customerMH,
      enquiryDate: today,
      subject: `${run} enquiry`,
      lines: [
        { productId: style, targetQuantity: 600, targetUnitPrice: 240, colorRemarks: "Navy" },
        { styleNameFreeText: "Kids hoodie", targetQuantity: 200 },
      ],
    });
    const prefill = await svc.getQuotationPrefillFromEnquiry(rep, e.id);
    expect(prefill).toMatchObject({ buyerEnquiryId: e.id, customerId: customerMH, title: `${run} enquiry`, placeOfSupplyStateCode: "27" });
    expect(prefill.lines.map((l) => [l.productId, l.quantity, l.unitPrice])).toEqual([[style, 600, 240], ["", 200, 0]]);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { enquiryNumber, customerName, ...body } = prefill;

    // Party fields sent by the client are ignored for an enquiry quotation.
    const q = await svc.createQuotation(rep, { ...body, customerId: customerTN, lines: body.lines.map((l) => ({ ...l, taxRateId: gst5 })) } as never);
    const d = await svc.getQuotation(rep, q.id);
    expect(d.customerId).toBe(customerMH);
    expect(d.buyerEnquiry?.id).toBe(e.id);
    expect(d.current.lines[0].buyerEnquiryLineId).toBe(prefill.lines[0].buyerEnquiryLineId);
    expect((await prisma.buyerEnquiry.findUniqueOrThrow({ where: { id: e.id } })).salesStage).toBe("QUOTATION_IN_PROGRESS");
    expect((await svc.listQuotationsForEnquiry(rep, e.id))?.map((x) => x.id)).toEqual([q.id]);

    // A second quotation keeps the stage; cancelling one of two keeps it too.
    const q2 = await svc.createQuotation(rep, { ...body } as never);
    await life.cancelQuotation(rep, q2.id, { reason: "Duplicate" });
    expect((await prisma.buyerEnquiry.findUniqueOrThrow({ where: { id: e.id } })).salesStage).toBe("QUOTATION_IN_PROGRESS");
    const cancelled = await life.cancelQuotation(rep, q.id, { reason: "Customer paused" });
    expect(cancelled).toMatchObject({ status: "CANCELLED", cancellationReason: "Customer paused" });
    expect(cancelled).toMatchObject({ current: { status: "CANCELLED" } });
    expect((await prisma.buyerEnquiry.findUniqueOrThrow({ where: { id: e.id } })).salesStage).toBe("QUALIFIED");
    const stages = await prisma.buyerEnquiryActivity.findMany({ where: { buyerEnquiryId: e.id, type: "STAGE_CHANGED" }, orderBy: { occurredAt: "asc" } });
    expect(stages.map((s) => (s.metadata as { to: string }).to)).toEqual(["QUOTATION_IN_PROGRESS", "QUALIFIED"]);
    await expectCode(life.cancelQuotation(rep, q.id, { reason: "again" }), "INVALID_STATE_TRANSITION");
    await expectCode(svc.updateQuotationDraft(rep, q.id, { ...draft(), version: 1 }), "INVALID_STATE_TRANSITION");

    // An enquiry on hold can't be quoted.
    await enquiries.changeSalesEnquiryStage(rep, e.id, { stage: "ON_HOLD" });
    await expectCode(svc.getQuotationPrefillFromEnquiry(rep, e.id), "INVALID_STATE_TRANSITION");
    await expectCode(svc.createQuotation(rep, { ...body } as never), "INVALID_STATE_TRANSITION");
  });

  it("saves drafts with optimistic versioning and replaces lines", async () => {
    const q = await svc.createQuotation(rep, draft());
    const saved = await svc.updateQuotationDraft(rep, q.id, { ...draft({ lines: [{ description: "Only line", quantity: 10, unitPrice: 100, taxRateId: gst5 }] }), version: 1 });
    if (!("current" in saved)) throw new Error("expected the quotation back");
    expect(saved.current.version).toBe(2);
    expect(saved.current.lines).toHaveLength(1);
    expect(Number(saved.current.grandTotal)).toBe(1000 + 50 + 1500 + 270);
    await expectCode(svc.updateQuotationDraft(rep, q.id, { ...draft(), version: 1 }), "RECORD_VERSION_CONFLICT");
    // Standalone draft may change customer; owner change notifies.
    const moved = await svc.updateQuotationDraft(rep, q.id, { ...draft({ customerId: customerTN, buyerId: "", placeOfSupplyStateCode: "33", ownerUserId: otherRep.userId }), version: 2 });
    expect(moved).toEqual({ id: q.id, visible: false }); // rep can no longer see it
    expect(await prisma.quotation.findUniqueOrThrow({ where: { id: q.id } })).toMatchObject({ customerId: customerTN, ownerUserId: otherRep.userId });
    expect(await prisma.notification.count({ where: { relatedRecordId: q.id, userId: otherRep.userId } })).toBe(1);
  });

  it("applies own / team / all visibility, including attachments", async () => {
    const mine = await svc.createQuotation(rep, draft());
    const theirs = await svc.createQuotation(otherRep, draft());
    const ids = async (a: Actor) => (await svc.listQuotations(a, {}, sort, page(run))).data.map((r) => r.id);
    expect(await ids(rep)).toContain(mine.id);
    expect(await ids(rep)).not.toContain(theirs.id);
    expect(await ids(manager)).toEqual(expect.arrayContaining([mine.id, theirs.id]));
    await expectCode(svc.getQuotation(rep, theirs.id), "NOT_FOUND");
    await expectCode(assertAttachmentAccess(rep, "QUOTATION", theirs.id, "view"), "NOT_FOUND");
    await expect(assertAttachmentAccess(rep, "QUOTATION", mine.id, "view")).resolves.toEqual({ status: "DRAFT" });
    const listed = (await svc.listQuotations(rep, {}, sort, page(run))).data.find((r) => r.id === mine.id);
    expect(listed?.current).toMatchObject({ revisionNumber: 1, status: "DRAFT" });
    expect((await svc.listQuotations(rep, { view: "closed" }, sort, page(run))).data.map((r) => r.id)).not.toContain(mine.id);
  });

  it("offers only GST rates effective on the date and quotation-eligible owners", async () => {
    const opts = await svc.getQuotationEditorOptions(rep, today);
    const ids = opts.taxRates.map((t) => t.id);
    expect(ids).toEqual(expect.arrayContaining([gst5, gst18]));
    expect(ids).not.toContain(gstOld);
    expect(opts.companyStateCode).toBe("33");
    expect(opts.owners.map((o) => o.id)).not.toContain(outsider.userId);
    expect((await svc.getQuotationEditorOptions(rep, "2019-06-01")).taxRates.map((t) => t.id)).toContain(gstOld);
  });
});
