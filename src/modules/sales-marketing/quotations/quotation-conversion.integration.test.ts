/**
 * Accepted quotation → Sales Order (Sales & Marketing Release 1 / S4) against a
 * real, migrated + seeded Postgres database. Skipped unless CRM_IT_DATABASE_URL
 * points at a DISPOSABLE database.
 *
 * Permissions are mocked to "allowed" (the route layer checks them); the
 * service's own sales_orders.create assert is a spy so the test can deny it.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { alignEnquiryCounter } from "../integration-test-helpers";

const DB_URL = process.env.CRM_IT_DATABASE_URL;
if (DB_URL) process.env.DATABASE_URL = DB_URL;

const denied = new Set<string>(); // "userId:module:action"
vi.mock("@/core/rbac/PermissionService", () => ({
  PermissionService: {
    can: vi.fn(async (userId: string, module: string, action: string) => !denied.has(`${userId}:${module}:${action}`)),
    assert: vi.fn(async (userId: string, module: string, action: string) => {
      if (denied.has(`${userId}:${module}:${action}`)) throw Object.assign(new Error("denied"), { code: "PERMISSION_DENIED" });
    }),
    getAllowedBranchIds: vi.fn(async () => null),
    invalidate: vi.fn(),
  },
}));

type Actor = { companyId: string; userId: string; branchId: string | null };

describe.skipIf(!DB_URL)("Quotation → Sales Order conversion (database integration)", async () => {
  const { prisma } = await import("@/core/db/client");
  const svc = await import("./quotation.service");
  const life = await import("./quotation-lifecycle.service");
  const conv = await import("./quotation-conversion.service");
  const enquiries = await import("@/modules/sales-marketing/enquiries/sales-enquiry.service");
  const crmCompanies = await import("@/modules/crm/companies/crm-companies.service");
  const crmOpps = await import("@/modules/crm/opportunities/crm-opportunities.service");

  const run = `c${Date.now().toString(36)}`;
  let rep: Actor, other: Actor;
  let customer: string, buyer: string, otherCustomer: string, gst5: string, dzn: string;
  let style: string, style2: string, design: string;
  const variants: Record<string, string> = {}; // "style:color:size" → variant id
  const today = new Date().toISOString().slice(0, 10);
  const plusDays = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  const expectCode = (p: Promise<unknown>, code: string) =>
    code === "VALIDATION_ERROR"
      ? p.then(
          () => expect.unreachable("expected a validation error"),
          (e: { name?: string; code?: string }) => expect(e.name === "ZodError" || e.code === "VALIDATION_ERROR").toBe(true)
        )
      : expect(p).rejects.toMatchObject({ code });

  /** Issues and accepts a quotation; returns its id. */
  const accepted = async (body: Record<string, unknown>, ref = "PO-778") => {
    const q = await svc.createQuotation(rep, body as never);
    await life.issueQuotation(rep, q.id, {});
    await life.recordAcceptance(rep, q.id, { decisionDate: today, method: "PURCHASE_ORDER", customerReference: ref });
    return q.id;
  };
  const base = (lines: Record<string, unknown>[], extra: Record<string, unknown> = {}) => ({
    customerId: customer,
    buyerId: buyer,
    title: `${run} convert`,
    quotationDate: today,
    validUntil: plusDays(30),
    lines,
    ...extra,
  });
  /** The Sales Order form payload the convert screen would send for this plan. */
  const payload = (plan: Awaited<ReturnType<typeof conv.getConversionPlan>>, split: (pieces: number, i: number) => { productId?: string; breakdown: { productVariantId: string; orderedQuantity: number }[] }) => ({
    customerId: plan.customerId,
    buyerId: plan.buyerId ?? "",
    orderDate: today,
    requiredShipDate: plan.requiredShipDate ?? "",
    customerPoNumber: plan.customerPoNumber ?? "",
    quotationLineIds: plan.lines.map((l) => l.quotationLineId),
    items: plan.lines.map((l, i) => {
      const s = split(l.pieces!, i);
      return { productId: s.productId ?? l.productId!, sampleRequestId: l.sampleRequestId ?? "", unitPrice: 1, notes: "typed by user", breakdown: s.breakdown };
    }),
  });
  const v = (st: string, c: string, s: string) => variants[`${st}:${c}:${s}`];

  beforeAll(async () => {
    const company = await prisma.company.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
    await alignEnquiryCounter(prisma, company.id);
    const mk = (n: string) => prisma.user.create({ data: { companyId: company.id, email: `${n}.${run}@qc-it.local`, passwordHash: "x", fullName: `${n} ${run}` } });
    const [r, o] = await Promise.all([mk("rep"), mk("other")]);
    rep = { companyId: company.id, userId: r.id, branchId: null };
    other = { companyId: company.id, userId: o.id, branchId: null };
    const c = await prisma.customer.create({ data: { companyId: company.id, code: `QC-${run}`, name: `Convert Customer ${run}`, buyers: { create: { companyId: company.id, code: `QCB-${run}`, name: `Buyer ${run}` } } }, include: { buyers: true } });
    customer = c.id;
    buyer = c.buyers[0].id;
    otherCustomer = (await prisma.customer.create({ data: { companyId: company.id, code: `QC2-${run}`, name: `Other Customer ${run}` } })).id;
    const taxType = await prisma.taxType.create({ data: { companyId: company.id, code: `GSTC-${run}`, name: "GST" } });
    gst5 = (await prisma.taxRate.create({ data: { companyId: company.id, taxTypeId: taxType.id, name: `GST 5% ${run}`, ratePercentage: "5", effectiveFrom: new Date("2020-01-01") } })).id;
    const pcs = await prisma.unitOfMeasure.findFirstOrThrow({ where: { code: "PCS" } });
    dzn = (await prisma.unitOfMeasure.findFirstOrThrow({ where: { code: "DZN", baseUnitId: pcs.id } })).id;
    const colors = await Promise.all(["Navy", "Grey"].map((n) => prisma.color.create({ data: { companyId: company.id, code: `${n}-${run}`, name: `${n} ${run}` } })));
    const sizes = await Promise.all(["M", "L"].map((n, i) => prisma.size.create({ data: { companyId: company.id, code: `${n}-${run}`, name: `${n} ${run}`, sortOrder: i } })));
    const mkStyle = async (code: string) => {
      const p = await prisma.product.create({ data: { companyId: company.id, styleCode: `${code}-${run}`, styleName: `${code} ${run}`, itemType: "STYLE", baseUomId: pcs.id } });
      for (const col of colors)
        for (const sz of sizes) {
          const pv = await prisma.productVariant.create({ data: { productId: p.id, colorId: col.id, sizeId: sz.id, skuCode: `${code}-${run}-${col.code}-${sz.code}` } });
          variants[`${p.id}:${col.name.split(" ")[0]}:${sz.name.split(" ")[0]}`] = pv.id;
        }
      return p.id;
    };
    style = await mkStyle("POLO");
    style2 = await mkStyle("HOOD");
    design = (await prisma.sampleRequest.create({ data: { companyId: company.id, requestNumber: `SAM-${run}`, customerId: customer, requestedByUserId: r.id, requestDate: new Date(), status: "APPROVED", styleName: `Design ${run}` } })).id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("plans the order from the accepted revision: pieces through the unit master, net price before GST, PO ref, earliest delivery", async () => {
    const id = await accepted(
      base([
        { productId: style, description: "Polo", quantity: 10, uomId: dzn, unitPrice: 1200, discountPercent: 10, taxRateId: gst5, requestedDeliveryDate: plusDays(40) },
        { sampleRequestId: design, description: "Design hoodie", quantity: 30, unitPrice: 333.33, discountPercent: 0, taxRateId: gst5, requestedDeliveryDate: plusDays(20) },
        { description: "Kids tee (new)", quantity: 7, unitPrice: 100, taxRateId: gst5 },
      ], { freightAmount: 500 })
    );
    const plan = await conv.getConversionPlan(rep, id);
    expect(plan).toMatchObject({ status: "ACCEPTED", customerId: customer, buyerId: buyer, customerPoNumber: "PO-778", requiredShipDate: plusDays(20), chargesNotCarried: true, blockers: [], existingOrder: null });
    expect(plan.lines.map((l) => [l.lineType, l.pieces, l.unitPrice, l.productId, l.styleFixed])).toEqual([
      ["STYLE", 120, 90, style, true], // 10 DZN × ₹1,200 −10% = ₹10,800 → ₹90 a piece
      ["DESIGN", 30, 333.33, null, false], // the sample has no Style yet → picked on conversion
      ["FREE_TEXT", 7, 100, null, false],
    ]);
  });

  it("converts: one order line per quotation line, price and design from the quotation, quotation CONVERTED, enquiry WON, opportunity links, no second order", async () => {
    const crmCo = await crmCompanies.createCompany(rep, { name: `${run} Knits` });
    const opp = await crmOpps.createOpportunity(rep, { name: `${run} AW27`, crmCompanyId: crmCo.id });
    const e = await enquiries.createSalesEnquiry(rep, { customerId: customer, enquiryDate: today, source: "EMAIL", subject: `${run} enq`, lines: [{ productId: style, targetQuantity: 120 }] });
    await enquiries.linkSalesEnquiryOpportunity(rep, e.id, { opportunityId: opp.id });
    const prefill = await svc.getQuotationPrefillFromEnquiry(rep, e.id);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { enquiryNumber, customerName, ...body } = prefill;
    const id = await accepted({
      ...body,
      buyerId: buyer,
      lines: [
        { ...body.lines[0], quantity: 10, uomId: dzn, unitPrice: 1200, discountPercent: 10, taxRateId: gst5 },
        { sampleRequestId: design, description: "Design hoodie", quantity: 30, unitPrice: 333.33, taxRateId: gst5 },
      ],
    });
    const plan = await conv.getConversionPlan(rep, id);

    // Wrong split / wrong style / changed design are refused before anything is written.
    await expectCode(conv.convertQuotationToSalesOrder(rep, id, payload(plan, (n, i) => ({ productId: i === 1 ? style2 : undefined, breakdown: [{ productVariantId: v(i === 0 ? style : style2, "Navy", "M"), orderedQuantity: n - 1 }] }))), "VALIDATION_ERROR");
    await expectCode(conv.convertQuotationToSalesOrder(rep, id, payload(plan, (n) => ({ productId: style2, breakdown: [{ productVariantId: v(style2, "Navy", "M"), orderedQuantity: n }] }))), "VALIDATION_ERROR");
    await expectCode(conv.convertQuotationToSalesOrder(rep, id, { ...payload(plan, (n, i) => ({ productId: i === 1 ? style2 : undefined, breakdown: [{ productVariantId: v(i === 0 ? style : style2, "Navy", "M"), orderedQuantity: n }] })), customerId: otherCustomer }), "VALIDATION_ERROR");
    await expectCode(conv.convertQuotationToSalesOrder(rep, id, { ...payload(plan, () => ({ breakdown: [] })), quotationLineIds: [plan.lines[1].quotationLineId, plan.lines[0].quotationLineId] }), "VALIDATION_ERROR");
    expect(await prisma.salesOrder.count({ where: { sourceQuotationRevisionId: plan.revisionId } })).toBe(0);

    const good = payload(plan, (n, i) =>
      i === 0
        ? { breakdown: [{ productVariantId: v(style, "Navy", "M"), orderedQuantity: 60 }, { productVariantId: v(style, "Grey", "L"), orderedQuantity: n - 60 }] }
        : { productId: style2, breakdown: [{ productVariantId: v(style2, "Grey", "M"), orderedQuantity: n }] }
    );
    const result = await conv.convertQuotationToSalesOrder(rep, id, good);
    expect(result.alreadyConverted).toBe(false);

    const order = await prisma.salesOrder.findUniqueOrThrow({ where: { id: result.salesOrderId }, include: { items: { orderBy: { createdAt: "asc" }, include: { breakdown: true } } } });
    expect(order).toMatchObject({ customerId: customer, buyerId: plan.buyerId, customerPoNumber: "PO-778", sourceQuotationRevisionId: plan.revisionId, status: "DRAFT" });
    const items = [...order.items].sort((a, b) => (a.notes ?? "").localeCompare(b.notes ?? ""));
    expect(items.map((i) => [i.productId, Number(i.unitPrice), i.sampleRequestId, i.breakdown.reduce((s, b) => s + Number(b.orderedQuantity), 0)])).toEqual([
      [style, 90, null, 120],
      [style2, 333.33, design, 30],
    ]);
    expect(items[0].notes).toContain(`line 1: `);
    expect(Number(order.totalAmount)).toBe(120 * 90 + 30 * 333.33);

    const q = await svc.getQuotation(rep, id);
    expect(q.status).toBe("CONVERTED");
    expect(q.salesOrder).toMatchObject({ id: order.id, orderNumber: order.orderNumber, revisionNumber: plan.revisionNumber });
    expect(q.events.map((ev) => ev.type)).toContain("CONVERTED");
    const enq = await prisma.buyerEnquiry.findUniqueOrThrow({ where: { id: e.id } });
    expect(enq).toMatchObject({ salesStage: "WON" });
    expect(enq.closedAt).not.toBeNull();
    const links = await prisma.crmOpportunityErpLink.findMany({ where: { opportunityId: opp.id }, select: { docType: true, docId: true } });
    expect(links).toEqual(expect.arrayContaining([{ docType: "QUOTATION", docId: id }, { docType: "SALES_ORDER", docId: order.id }]));

    // A second click / retry returns the same order.
    const again = await conv.convertQuotationToSalesOrder(rep, id, {});
    expect(again).toEqual({ salesOrderId: order.id, orderNumber: order.orderNumber, alreadyConverted: true });
    expect(await prisma.salesOrder.count({ where: { sourceQuotationRevisionId: plan.revisionId } })).toBe(1);
    expect((await prisma.quotationEvent.findMany({ where: { quotationId: id, type: "CONVERTED" } })).length).toBe(1);
  });

  it("lets only one of two concurrent conversions create an order", async () => {
    const id = await accepted(base([{ productId: style, description: "Polo", quantity: 24, unitPrice: 100, taxRateId: gst5 }]));
    const plan = await conv.getConversionPlan(rep, id);
    const body = payload(plan, (n) => ({ breakdown: [{ productVariantId: v(style, "Navy", "L"), orderedQuantity: n }] }));
    const results = await Promise.allSettled([conv.convertQuotationToSalesOrder(rep, id, body), conv.convertQuotationToSalesOrder(rep, id, body)]);
    const ok = results.filter((r): r is PromiseFulfilledResult<{ salesOrderId: string; orderNumber: string; alreadyConverted: boolean }> => r.status === "fulfilled").map((r) => r.value);
    expect(ok.length).toBeGreaterThanOrEqual(1);
    expect(new Set(ok.map((r) => r.salesOrderId)).size).toBe(1);
    expect(await prisma.salesOrder.count({ where: { sourceQuotationRevisionId: plan.revisionId } })).toBe(1);
    expect(await svc.getQuotation(rep, id).then((q) => q.status)).toBe("CONVERTED");
  });

  it("blocks what can't be converted: not accepted, prospect without a customer, part pieces, no permission", async () => {
    const issued = await svc.createQuotation(rep, base([{ productId: style, description: "Polo", quantity: 5, unitPrice: 100, taxRateId: gst5 }]) as never);
    await life.issueQuotation(rep, issued.id, {});
    expect((await conv.getConversionPlan(rep, issued.id)).blockers[0]).toMatch(/Only an accepted quotation/);
    await expectCode(conv.convertQuotationToSalesOrder(rep, issued.id, {}), "INVALID_STATE_TRANSITION");

    const halfDozen = await accepted(base([{ productId: style, description: "Polo", quantity: 1.5, uomId: dzn, unitPrice: 1200, taxRateId: gst5 }]));
    expect((await conv.getConversionPlan(rep, halfDozen)).blockers).toEqual([]); // 18 pieces is fine
    const partPiece = await accepted(base([{ productId: style, description: "Polo", quantity: 0.1, uomId: dzn, unitPrice: 1200, taxRateId: gst5 }]));
    expect((await conv.getConversionPlan(rep, partPiece)).blockers.join(" ")).toMatch(/not a whole number of pieces/);

    // Prospect: link the real customer (only once, never re-pointed), then it converts.
    const prospect = await accepted(base([{ productId: style, description: "Polo", quantity: 12, unitPrice: 100, taxRateId: gst5 }], { customerId: "", buyerId: "", prospectName: `${run} Prospect Ltd`, placeOfSupplyStateCode: "33" }));
    expect((await conv.getConversionPlan(rep, prospect)).blockers.join(" ")).toMatch(/prospect/);
    await expectCode(conv.linkQuotationCustomer(rep, prospect, { customerId: customer, buyerId: crypto.randomUUID() }), "NOT_FOUND");
    const linked = await conv.linkQuotationCustomer(rep, prospect, { customerId: customer, buyerId: buyer });
    expect(linked).toMatchObject({ customer: { id: customer }, buyer: { id: buyer } });
    expect(linked.events.map((e) => e.type)).toContain("CUSTOMER_LINKED");
    await expectCode(conv.linkQuotationCustomer(rep, prospect, { customerId: otherCustomer }), "INVALID_STATE_TRANSITION");
    const plan = await conv.getConversionPlan(rep, prospect);
    expect(plan.blockers).toEqual([]);

    denied.add(`${other.userId}:sales_orders:create`);
    await expectCode(conv.convertQuotationToSalesOrder(other, prospect, payload(plan, (n) => ({ breakdown: [{ productVariantId: v(style, "Navy", "M"), orderedQuantity: n }] }))), "PERMISSION_DENIED");
    const done = await conv.convertQuotationToSalesOrder(rep, prospect, payload(plan, (n) => ({ breakdown: [{ productVariantId: v(style, "Navy", "M"), orderedQuantity: n }] })));
    expect(done.alreadyConverted).toBe(false);
    expect(await prisma.salesOrder.findUniqueOrThrow({ where: { id: done.salesOrderId } })).toMatchObject({ customerId: customer, buyerId: buyer, customerPoNumber: "PO-778" });
    // A converted quotation can no longer be cancelled or revised.
    await expectCode(life.cancelQuotation(rep, prospect, { reason: "too late" }), "INVALID_STATE_TRANSITION");
    await expectCode(life.reviseQuotation(rep, prospect, { reason: "too late" }), "INVALID_STATE_TRANSITION");
  });
});
