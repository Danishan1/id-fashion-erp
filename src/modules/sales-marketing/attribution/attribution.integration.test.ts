/**
 * Attribution & ROI (Sales & Marketing Phase 13) against a real, migrated +
 * seeded Postgres database. Skipped unless CRM_IT_DATABASE_URL points at a
 * DISPOSABLE database. Deliveries, leads and orders are synthetic fixtures
 * written straight to the tables (no provider is called).
 *
 * Permissions are mocked: "manager" approves (never their own work),
 * "rep" does everything else, "noOrders" can't view Sales Orders.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const DB_URL = process.env.CRM_IT_DATABASE_URL;
if (DB_URL) process.env.DATABASE_URL = DB_URL;

const approvers = new Set<string>();
const noOrders = new Set<string>();
const noEdit = new Set<string>();
const can = async (userId: string, module: string, action: string, ctx?: { createdBy?: string }) => {
  if (action === "approve" || action === "reject") return approvers.has(userId) && ctx?.createdBy !== userId;
  if (module === "sales_orders" && noOrders.has(userId)) return false;
  if (action === "edit" && noEdit.has(userId)) return false;
  return true;
};
vi.mock("@/core/rbac/PermissionService", () => ({
  PermissionService: {
    can: vi.fn(can),
    assert: vi.fn(async (userId: string, module: string, action: string, ctx?: { createdBy?: string }) => {
      if (!(await can(userId, module, action, ctx))) throw Object.assign(new Error("denied"), { code: "PERMISSION_DENIED" });
    }),
    assertAny: vi.fn(async () => undefined),
    getAllowedBranchIds: vi.fn(async () => null),
    invalidate: vi.fn(),
  },
}));

type Actor = { companyId: string; userId: string; branchId: string | null };

describe.skipIf(!DB_URL)("Attribution & ROI (database integration)", async () => {
  const { prisma } = await import("@/core/db/client");
  const models = await import("./attribution-model.service");
  const runs = await import("./attribution-run.service");
  const sync = await import("./attribution-sync.service");
  const report = await import("./attribution-report.service");
  const lookups = await import("@/modules/sales-marketing/campaigns/campaign-lookup.service");

  const run = `a${Date.now().toString(36)}`;
  const RUN = run.toUpperCase();
  let rep: Actor, manager: Actor, viewer: Actor, readOnly: Actor, outsider: Actor;
  let customer = "", contact = "", campA = "", campB = "", chanA = "", chanB = "", conn = "", tpl = "", tplv = "";
  let s1 = "", s3 = "", lead = "", modelId = "";
  const P = { from: "2026-10-01", to: "2026-10-31" };
  const expectCode = (p: Promise<unknown>, code: string) =>
    code === "VALIDATION_ERROR"
      ? p.then(
          () => expect.unreachable("expected a validation error"),
          (e: { name?: string; code?: string }) => expect(e.name === "ZodError" || e.code === "VALIDATION_ERROR").toBe(true)
        )
      : expect(p).rejects.toMatchObject({ code });
  const T = (s: string) => new Date(s);
  let runNo = 0;
  const deliveryRun = (campaignId: string, channelId: string) =>
    prisma.marketingDeliveryRun.create({ data: { companyId: rep.companyId, campaignId, campaignChannelId: channelId, connectionId: conn, runNumber: ++runNo, channelType: "EMAIL", providerKey: "SMTP", templateId: tpl, templateVersionId: tplv, initiatedByUserId: rep.userId, status: "COMPLETED" } });
  const delivery = async (runId: string, status: "DELIVERED" | "SENT" | "BOUNCED", at: string) =>
    prisma.marketingDelivery.create({ data: { companyId: rep.companyId, runId, connectionId: conn, contactId: contact, status, acceptedAt: T(at), deliveredAt: status === "DELIVERED" ? T(at) : null } });
  const order = (n: string, date: string, status: "CONFIRMED" | "CANCELLED", value: number) =>
    prisma.salesOrder.create({ data: { companyId: rep.companyId, orderNumber: `ATT-${RUN}-${n}`, customerId: customer, orderDate: T(`${date}T00:00:00Z`), currencyCode: "INR", baseCurrencyCode: "INR", requestedByUserId: rep.userId, status, totalAmount: value, baseTotalAmount: value } });
  const calculate = async (key: string) => {
    const r = await runs.requestRun(rep, modelId, { ...P, idempotencyKey: `${run}-${key}` });
    expect(await runs.executeRun(r.run.id)).toBe(true);
    return prisma.marketingAttributionRun.findUniqueOrThrow({ where: { id: r.run.id } });
  };
  const creditsOf = async (runId: string, conversionSourceId: string) => {
    const res = await prisma.marketingAttributionResult.findFirstOrThrow({ where: { runId, conversion: { sourceId: conversionSourceId } }, include: { credits: { orderBy: { position: "asc" } } } });
    return res;
  };

  beforeAll(async () => {
    const company = await prisma.company.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
    const mk = (n: string) => prisma.user.create({ data: { companyId: company.id, email: `${n}.${run}@attr-it.local`, passwordHash: "x", fullName: `${n} ${run}` } });
    const [r, m, v, ro] = await Promise.all([mk("rep"), mk("manager"), mk("viewer"), mk("readonly")]);
    const actor = (id: string) => ({ companyId: company.id, userId: id, branchId: null });
    [rep, manager, viewer, readOnly] = [actor(r.id), actor(m.id), actor(v.id), actor(ro.id)];
    approvers.add(m.id);
    noOrders.add(v.id);
    noEdit.add(ro.id);
    const other = await prisma.company.create({ data: { name: `Other ${run}`, baseCurrencyCode: "INR" } });
    outsider = { companyId: other.id, userId: r.id, branchId: null };
    // Models from earlier runs must not be the default here.
    await prisma.marketingAttributionModel.updateMany({ where: { companyId: company.id, status: { not: "RETIRED" } }, data: { status: "RETIRED", isDefault: false } });

    customer = (await prisma.customer.create({ data: { companyId: company.id, code: `AC-${run}`, name: `Attr Customer ${run}` } })).id;
    const crmCompany = await prisma.crmCompany.create({ data: { companyId: company.id, name: `Attr Co ${run}`, nameKey: `attr co ${run}`, customerId: customer, createdByUserId: r.id } });
    contact = (await prisma.crmContact.create({ data: { companyId: company.id, firstName: "Asha", fullName: `Asha ${run}`, crmCompanyId: crmCompany.id, createdByUserId: r.id } })).id;
    await lookups.ensureCampaignLookups(company.id);
    const all = await prisma.marketingCampaignLookup.findMany({ where: { companyId: company.id } });
    const mkCampaign = async (code: string) =>
      (
        await prisma.marketingCampaign.create({
          data: { companyId: company.id, code, name: code, typeId: all.find((l) => l.kind === "TYPE")!.id, objectiveId: all.find((l) => l.kind === "OBJECTIVE")!.id, ownerUserId: r.id, status: "ACTIVE", plannedStartDate: T("2026-09-01T00:00:00Z"), plannedEndDate: T("2026-12-31T00:00:00Z"), actualStartDate: T("2026-09-01T00:00:00Z"), plannedBudget: 50000, approvedRevisionNumber: 1, currencyCode: "INR", createdByUserId: r.id, updatedByUserId: r.id },
        })
      ).id;
    [campA, campB] = [await mkCampaign(`ATA-${RUN}`), await mkCampaign(`ATB-${RUN}`)];
    conn = (await prisma.marketingChannelConnection.create({ data: { companyId: company.id, code: `AT-${RUN}`, name: `Mail ${run}`, channelType: "EMAIL", providerKey: "SMTP", webhookToken: `wh-${run}`, createdByUserId: r.id } })).id;
    const t = await prisma.crmMessageTemplate.create({ data: { companyId: company.id, name: `Attr ${run}`, nameKey: `attr ${run}`, channelType: "EMAIL", status: "DRAFT", createdByUserId: r.id } });
    tpl = t.id;
    tplv = (await prisma.crmMessageTemplateVersion.create({ data: { companyId: company.id, templateId: t.id, versionNumber: 1, subject: "Hi", body: "Hi", variables: [], createdByUserId: r.id } })).id;
    chanA = (await prisma.marketingCampaignChannel.create({ data: { companyId: company.id, campaignId: campA, connectionId: conn, templateId: tpl, createdByUserId: r.id } })).id;
    chanB = (await prisma.marketingCampaignChannel.create({ data: { companyId: company.id, campaignId: campB, connectionId: conn, templateId: tpl, createdByUserId: r.id } })).id;
    const runA = await deliveryRun(campA, chanA);
    const runB = await deliveryRun(campB, chanB);
    await delivery(runA.id, "DELIVERED", "2026-10-01T10:00:00Z"); // A, delivered
    await delivery(runB.id, "SENT", "2026-10-10T10:00:00Z"); // B, sent (no receipt)
    const runB2 = await deliveryRun(campB, chanB);
    await delivery(runB2.id, "BOUNCED", "2026-10-12T10:00:00Z"); // B, bounced → excluded

    const status = (await prisma.crmLeadStatus.findFirst({ where: { companyId: company.id } })) ?? (await prisma.crmLeadStatus.create({ data: { companyId: company.id, key: `new-${run}`, name: "New" } }));
    lead = (await prisma.crmLead.create({ data: { companyId: company.id, leadNumber: `LD-${RUN}`, firstName: "Asha", fullName: `Asha ${run}`, statusId: status.id, crmContactId: contact, campaignId: campA, createdByUserId: r.id, createdAt: T("2026-10-05T09:00:00Z") } })).id;
    s1 = (await order("1", "2026-10-20", "CONFIRMED", 10000)).id;
    await prisma.salesInvoice.create({ data: { companyId: company.id, invoiceNumber: `ATI-${RUN}`, salesOrderId: s1, customerId: customer, invoiceDate: T("2026-10-22T00:00:00Z"), dueDate: T("2026-11-22T00:00:00Z"), currencyCode: "INR", baseCurrencyCode: "INR", createdByUserId: r.id, status: "POSTED", subtotalAmount: 4000, taxAmount: 720, totalAmount: 4720, baseTotalAmount: 4720 } });
    await order("2", "2026-10-21", "CANCELLED", 999); // never booked: no conversion
    s3 = (await order("3", "2026-10-23", "CONFIRMED", 3000)).id;
    await prisma.expense.create({ data: { companyId: company.id, expenseNumber: `ATX-${RUN}`, expenseDate: T("2026-10-15T00:00:00Z"), description: "Mailer", amount: 2000, taxAmount: 360, totalAmount: 2360, currencyCode: "INR", status: "APPROVED", campaignId: campA, createdByUserId: r.id } });
  });

  afterAll(async () => {
    await prisma.marketingAttributionModel.updateMany({ where: { companyId: rep.companyId, code: { contains: RUN } }, data: { status: "RETIRED", isDefault: false } });
    await prisma.$disconnect();
  });

  it("model lifecycle: validated, approved by someone else, frozen after approval", async () => {
    await expectCode(models.createModel(rep, { code: `X-${RUN}`, name: "Bad", rules: { modelType: "POSITION_BASED", windowDays: 30, touchpointTypes: ["MESSAGE_SENT"], conversionTypes: ["SALES_ORDER_BOOKED"], firstTouchPercent: 80, lastTouchPercent: 40 } }), "VALIDATION_ERROR");
    const { id } = await models.createModel(rep, { code: `LIN-${RUN}`, name: "Linear 90", rules: { modelType: "LINEAR", windowDays: 90, touchpointTypes: ["MESSAGE_SENT", "MESSAGE_DELIVERED", "CAMPAIGN_RESPONSE"], conversionTypes: ["LEAD_CREATED", "SALES_ORDER_BOOKED"], collapseRepeats: false } });
    modelId = id;
    const v1 = await prisma.marketingAttributionModelVersion.findFirstOrThrow({ where: { modelId } });
    await expectCode(runs.requestRun(rep, modelId, P), "INVALID_STATE_TRANSITION"); // not approved yet
    await models.submitVersion(rep, modelId, v1.id, {});
    await expectCode(models.approveVersion(rep, modelId, v1.id, {}), "PERMISSION_DENIED");
    await models.approveVersion(manager, modelId, v1.id, {});
    const m = await prisma.marketingAttributionModel.findUniqueOrThrow({ where: { id: modelId } });
    expect([m.status, m.approvedVersionId]).toEqual(["ACTIVE", v1.id]);
    await expect(prisma.marketingAttributionModelVersion.update({ where: { id: v1.id }, data: { windowDays: 7 } })).rejects.toThrow(/can't be changed/);
    await models.setDefaultModel(manager, modelId);
  });

  it("sync: touchpoints and conversions from the authoritative records, idempotent", async () => {
    await sync.syncAttributionSources(rep.companyId);
    const touches = await prisma.marketingTouchpoint.findMany({ where: { companyId: rep.companyId, campaignId: { in: [campA, campB] } }, orderBy: { occurredAt: "asc" } });
    expect(touches.map((t) => [t.campaignId === campA ? "A" : "B", t.touchpointType, t.status])).toEqual([
      ["A", "MESSAGE_DELIVERED", "VALID"],
      ["A", "CAMPAIGN_RESPONSE", "VALID"],
      ["B", "MESSAGE_SENT", "VALID"],
      ["B", "MESSAGE_SENT", "EXCLUDED"],
    ]);
    expect(touches[0].identityKeys).toEqual([`CONTACT:${contact}`, `CUSTOMER:${customer}`].sort());
    const so = await prisma.marketingConversion.findFirstOrThrow({ where: { companyId: rep.companyId, conversionType: "SALES_ORDER_BOOKED", sourceId: s1 } });
    expect([so.status, Number(so.orderValue), Number(so.invoicedValue), so.occurredAt.toISOString()]).toEqual(["ACTIVE", 10000, 4000, "2026-10-20T18:29:59.999Z"]);
    expect(await prisma.marketingConversion.count({ where: { companyId: rep.companyId, reference: `ATT-${RUN}-2` } })).toBe(0); // cancelled, never booked
    const again = await sync.syncAttributionSources(rep.companyId, { full: true });
    expect(Object.values(again.sources).reduce((s, x) => s + x.changed, 0)).toBe(0);
  });

  it("calculation: shared credit, exact reconciliation, unattributed never invented; ROI only with spend", async () => {
    const r1 = await calculate("r1");
    expect(r1.status).toBe("COMPLETED");
    const so = await creditsOf(r1.id, s1);
    expect(so.status).toBe("ATTRIBUTED");
    // Delivered A (1 Oct) and sent B (10 Oct) reach the order through the contact's customer; the bounced message and the lead's own tag don't.
    expect(so.credits.map((c) => [c.campaignId === campA ? "A" : "B", Number(c.weight), Number(c.orderCredit), Number(c.invoicedCredit)])).toEqual([
      ["A", 0.5, 5000, 2000],
      ["B", 0.5, 5000, 2000],
    ]);
    const ld = await creditsOf(r1.id, lead);
    expect(ld.credits.map((c) => (c.campaignId === campA ? "A" : "B"))).toEqual(["A", "A"]); // the delivery, then the lead's own campaign
    const bad = await prisma.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*) AS n FROM (SELECT r.id FROM marketing_attribution_results r JOIN marketing_attribution_credits c ON c.result_id = r.id WHERE r.run_id = ${r1.id}::uuid GROUP BY r.id HAVING SUM(c.weight) <> 1 OR SUM(c.order_credit) <> MAX(r.order_value)) x`;
    expect(Number(bad[0].n)).toBe(0);
    await expect(prisma.marketingAttributionResult.update({ where: { id: so.id }, data: { reason: "x" } })).rejects.toThrow(/recalculate/);

    const rep1 = await report.attributionReport(rep, { modelId, ...P, basis: "ORDER_VALUE" });
    const a = rep1.rows.find((x) => x.campaignId === campA)!;
    const b = rep1.rows.find((x) => x.campaignId === campB)!;
    // Orders 1 (10,000) and 3 (3,000) are each shared ½ / ½: A = 6,500 against 2,000 spend.
    expect([a.revenue, a.actualSpend, a.roi, a.roas.value, a.credited.SALES_ORDER_BOOKED, a.costPerOrder]).toEqual([6500, 2000, { value: 225, status: "OK" }, 3.25, 1, 2000]);
    expect([b.revenue, b.actualSpend, b.roi.status, b.roas.status]).toEqual([6500, 0, "NO_COST", "NO_COST"]);
    expect(a.messagesDelivered).toBe(1);
    const inv = await report.attributionReport(rep, { modelId, ...P, basis: "INVOICED_VALUE" });
    expect(inv.rows.find((x) => x.campaignId === campA)!.revenue).toBe(2000);
  });

  it("late events, reversals and model versions: a new run, the old one unchanged", async () => {
    const r1 = await prisma.marketingAttributionRun.findFirstOrThrow({ where: { modelId, status: "COMPLETED" }, orderBy: { finishedAt: "desc" } });
    // Late delivery for B before the order, and the third order is cancelled.
    const late = await deliveryRun(campB, chanB);
    await delivery(late.id, "DELIVERED", "2026-10-18T10:00:00Z");
    await prisma.salesOrder.update({ where: { id: s3 }, data: { status: "CANCELLED" } });
    await sync.syncAttributionSources(rep.companyId);
    const stale = await report.attributionReport(rep, { modelId, ...P });
    expect(stale.quality.notices.join(" ")).toMatch(/Out of date/);
    const r2 = await calculate("r2");
    const so = await creditsOf(r2.id, s1);
    expect(so.credits.map((c) => (c.campaignId === campA ? "A" : "B"))).toEqual(["A", "B", "B"]);
    expect(so.credits.reduce((s, c) => s + Number(c.orderCredit), 0)).toBe(10000);
    expect((await creditsOf(r2.id, s3)).status).toBe("EXCLUDED");
    // Run 1 still says what it said.
    expect((await creditsOf(r1.id, s1)).credits).toHaveLength(2);
    expect((await creditsOf(r1.id, s3)).status).toBe("ATTRIBUTED");

    // A new approved version: runs keep their version; reports wait for a run under the new rules.
    await models.newVersion(rep, modelId);
    const v2 = await prisma.marketingAttributionModelVersion.findFirstOrThrow({ where: { modelId, versionNumber: 2 } });
    await models.saveVersionRules(rep, modelId, v2.id, { modelType: "FIRST_TOUCH", windowDays: 90, touchpointTypes: ["MESSAGE_SENT", "MESSAGE_DELIVERED", "CAMPAIGN_RESPONSE"], conversionTypes: ["LEAD_CREATED", "SALES_ORDER_BOOKED"], changeNote: "First touch" });
    await models.submitVersion(rep, modelId, v2.id, {});
    await models.approveVersion(manager, modelId, v2.id, {});
    expect((await report.attributionReport(rep, { modelId, ...P })).run).toBeNull();
    const r3 = await calculate("r3");
    expect(r3.modelVersionId).toBe(v2.id);
    expect((await prisma.marketingAttributionRun.findUniqueOrThrow({ where: { id: r2.id } })).modelVersionId).not.toBe(v2.id);
    const first = await creditsOf(r3.id, s1);
    expect(first.credits.map((c) => [c.campaignId === campA ? "A" : "B", Number(c.weight)])).toEqual([["A", 1]]);
  });

  it("one calculation at a time, idempotent requests, a run can't be executed twice", async () => {
    const a = await runs.requestRun(rep, modelId, { ...P, idempotencyKey: `${run}-dup-1` });
    const again = await runs.requestRun(rep, modelId, { ...P, idempotencyKey: `${run}-dup-1` });
    expect([again.created, again.run.id]).toEqual([false, a.run.id]);
    await expectCode(runs.requestRun(rep, modelId, { ...P, idempotencyKey: `${run}-dup-2` }), "INVALID_STATE_TRANSITION");
    const [x, y] = await Promise.all([runs.executeRun(a.run.id), runs.executeRun(a.run.id)]);
    expect([x, y].filter(Boolean)).toHaveLength(1);
    await expectCode(runs.requestRun(rep, modelId, { from: "2024-01-01", to: "2026-10-31" }), "VALIDATION_ERROR"); // > 731 days
  });

  it("drill-down hides records and money the viewer can't open; permissions and other companies", async () => {
    const full = await report.campaignAttributionDetail(rep, campA, { modelId, ...P });
    const row = full.conversions.find((c) => c.conversionType === "SALES_ORDER_BOOKED")!;
    expect(row.reference).toBe(`ATT-${RUN}-1`);
    expect(row.values?.order).toBe(10000);
    const limited = await report.campaignAttributionDetail(viewer, campA, { modelId, ...P });
    const hidden = limited.conversions.find((c) => c.conversionType === "SALES_ORDER_BOOKED")!;
    expect([hidden.reference, hidden.href, hidden.values]).toEqual(["Hidden — no access", null, null]);
    expect(JSON.stringify(full)).not.toContain("Asha"); // no person data in the drill-down
    await expectCode(runs.requestRun(readOnly, modelId, P), "PERMISSION_DENIED");
    await expectCode(models.getModel(outsider, modelId), "NOT_FOUND");
    expect((await report.attributionReport(outsider, {})).model).toBeNull();
    await expectCode(report.campaignAttributionDetail(outsider, campA, {}), "NOT_FOUND");
  });
});
