/**
 * Sales & Marketing dashboard (module home) against a real, migrated Postgres
 * database: KPIs equal the governed analytics metrics and compare with the
 * previous period; Analytics access is NOT needed; tiles without access are
 * HIDDEN (never zero); the work queue counts in the viewer's own scope and
 * only for what they can act on; system health; tenant isolation.
 *
 * Skipped unless CRM_IT_DATABASE_URL points at a DISPOSABLE database.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { alignEnquiryCounter } from "./integration-test-helpers";

const DB_URL = process.env.CRM_IT_DATABASE_URL;
if (DB_URL) process.env.DATABASE_URL = DB_URL;
delete process.env.REDIS_URL;

const denied = new Set<string>(); // "userId:module.action"
const can = async (userId: string, module: string, action: string) => !denied.has(`${userId}:${module}.${action}`);
vi.mock("@/core/rbac/PermissionService", () => ({
  PermissionService: {
    can: vi.fn(can),
    assert: vi.fn(async (userId: string, module: string, action: string) => {
      if (!(await can(userId, module, action))) {
        const { BusinessRuleError } = await import("@/core/errors/BusinessRuleError");
        throw new BusinessRuleError("PERMISSION_DENIED", `denied ${module}.${action}`);
      }
    }),
    assertAny: vi.fn(async () => undefined),
    getAllowedBranchIds: vi.fn(async () => null),
    getViewableModules: vi.fn(async () => []),
    invalidate: vi.fn(),
  },
}));

type Actor = { companyId: string; userId: string; branchId: string | null };

describe.skipIf(!DB_URL)("Sales & Marketing dashboard (database integration)", async () => {
  const { prisma } = await import("@/core/db/client");
  const home = await import("./sales-marketing-home.service");
  const enquiries = await import("./enquiries/sales-enquiry.service");
  const lookups = await import("./campaigns/campaign-lookup.service");
  const { invalidateTeamScope } = await import("@/core/hierarchy/team-scope");
  const { indiaToday, resolvePreset } = await import("./analytics/analytics-periods");

  const run = `h${Date.now().toString(36)}`;
  let admin: Actor, rep: Actor, limited: Actor, outsider: Actor;
  let n = 0;
  const today = indiaToday();
  const thisMonth = resolvePreset("this_month", today);
  const lastMonth = resolvePreset("last_month", today);

  const order = (a: Actor, customerId: string, value: number, date: string) =>
    prisma.salesOrder.create({ data: { companyId: a.companyId, orderNumber: `ORD-${run}-${++n}`, customerId, orderDate: new Date(`${date}T00:00:00Z`), status: "CONFIRMED", currencyCode: "INR", baseCurrencyCode: "INR", totalAmount: value, baseTotalAmount: value, requestedByUserId: a.userId, salesRepUserId: a.userId } });

  beforeAll(async () => {
    const company = await prisma.company.create({ data: { name: `Home Co ${run}`, baseCurrencyCode: "INR" } });
    const other = await prisma.company.create({ data: { name: `Home Other ${run}`, baseCurrencyCode: "INR" } });
    await alignEnquiryCounter(prisma, company.id);
    const mk = (nm: string, companyId = company.id) => prisma.user.create({ data: { companyId, email: `${nm}.${run}@home-it.local`, passwordHash: "x", fullName: `${nm} ${run}` } });
    const [a, r, l] = await Promise.all([mk("admin"), mk("rep"), mk("limited")]);
    const actor = (id: string, companyId = company.id) => ({ companyId, userId: id, branchId: null });
    [admin, rep, limited] = [actor(a.id), actor(r.id), actor(l.id)];
    outsider = actor((await mk("outsider", other.id)).id, other.id);
    for (const m of ["sales_marketing", "sales_quotations", "crm", "marketing_campaigns"]) denied.add(`${r.id}:${m}.view_all`);
    for (const [m, act] of [["accounts", "view"], ["sales_analytics", "view"], ["sales_quotations", "approve"], ["marketing_campaigns", "approve"]]) denied.add(`${l.id}:${m}.${act}`);
    invalidateTeamScope();

    const c1 = (await prisma.customer.create({ data: { companyId: company.id, code: `HC1-${run}`, name: `Home One ${run}` } })).id;
    const pcs = await prisma.unitOfMeasure.findFirstOrThrow({ where: { code: "PCS" } });
    const style = (await prisma.product.create({ data: { companyId: company.id, styleCode: `HM-${run}`, styleName: `Home Tee ${run}`, itemType: "STYLE", baseUomId: pcs.id } })).id;

    // Bookings: ₹3,000 this month (₹2,000 admin + ₹1,000 rep), ₹1,500 last month.
    await order(admin, c1, 2000, thisMonth.from);
    await order(rep, c1, 1000, thisMonth.from);
    await order(admin, c1, 1500, lastMonth.from);
    const oc = (await prisma.customer.create({ data: { companyId: other.id, code: `HX-${run}`, name: `X ${run}` } })).id;
    await order(outsider, oc, 99999, thisMonth.from);

    // Overdue follow-ups: two for admin, one for the rep.
    const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
    for (const who of [admin, admin, rep]) {
      const e = await enquiries.createSalesEnquiry(who, { customerId: c1, enquiryDate: today, source: "EMAIL", subject: `${run} follow`, lines: [{ productId: style, targetQuantity: 10 }] });
      await prisma.buyerEnquiry.update({ where: { id: e.id }, data: { nextFollowUpDate: new Date(`${yesterday}T00:00:00Z`) } });
    }
    // A campaign waiting for approval.
    await lookups.ensureCampaignLookups(company.id);
    const all = await prisma.marketingCampaignLookup.findMany({ where: { companyId: company.id } });
    await prisma.marketingCampaign.create({
      data: { companyId: company.id, code: `HC-${run}`.toUpperCase(), name: `Home campaign ${run}`, typeId: all.find((x) => x.kind === "TYPE")!.id, objectiveId: all.find((x) => x.kind === "OBJECTIVE")!.id, ownerUserId: a.id, status: "PENDING_APPROVAL", plannedStartDate: new Date(`${today}T00:00:00Z`), plannedEndDate: new Date(`${today}T00:00:00Z`), plannedBudget: 1000, currencyCode: "INR", createdByUserId: a.id, updatedByUserId: a.id },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const kpi = (h: Awaited<ReturnType<typeof home.getSalesMarketingHome>>, key: string) => h.kpis.find((k) => k.key === key)!;
  const queue = (h: Awaited<ReturnType<typeof home.getSalesMarketingHome>>, key: string) => h.queue.find((q) => q.key === key);

  it("KPIs are the governed metrics vs the previous period; trend, funnel and rankings in the same scope; tenant isolated", async () => {
    const h = await home.getSalesMarketingHome(admin, { preset: "this_month" });
    expect(h.period).toEqual(thisMonth);
    expect(kpi(h, "booked")).toMatchObject({ value: 3000, metricId: "booked_order_value" });
    // The previous period is the same length immediately before (not the calendar month).
    expect(kpi(h, "enquiries")).toMatchObject({ value: 3 });
    expect(kpi(h, "booked")).toHaveProperty("query.dataset", "orders");
    expect(h.trend.status).toBe("OK");
    if (h.trend.status === "OK") expect(h.trend.result.totals.values.booked_order_value).toBe(3000);
    expect(h.funnel.status).toBe("OK");
    if (h.team.byRep.status === "OK") expect(h.team.byRep.result.rows.map((r) => r.values.booked_order_value)).toEqual([2000, 1000]);
    expect(h.canOpenAnalytics).toBe(true);
    const o = await home.getSalesMarketingHome(outsider, { preset: "this_month" });
    expect(kpi(o, "booked")).toMatchObject({ value: 99999 });
  });

  it("works without Analytics access; tiles without their source module are hidden, not zero", async () => {
    const h = await home.getSalesMarketingHome(limited, { preset: "this_month" });
    expect(h.canOpenAnalytics).toBe(false);
    expect(kpi(h, "booked")).toMatchObject({ value: 3000 });
    expect(kpi(h, "invoiced")).toHaveProperty("hidden");
    expect(kpi(h, "cash")).toHaveProperty("hidden");
    expect(kpi(h, "invoiced")).not.toHaveProperty("value");
  });

  it("work queue: own scope, and approval items only for approvers", async () => {
    const a = await home.getSalesMarketingHome(admin, {});
    expect(queue(a, "overdue_followups")?.count).toBe(3);
    expect(queue(a, "campaigns_to_approve")?.count).toBe(1);
    const r = await home.getSalesMarketingHome(rep, {});
    expect(queue(r, "overdue_followups")?.count).toBe(1);
    const l = await home.getSalesMarketingHome(limited, {});
    expect(queue(l, "campaigns_to_approve")).toBeUndefined();
    expect(queue(l, "quotes_to_approve")).toBeUndefined();
    expect(queue(l, "budget_alerts")?.count).toBe(0);
  });

  it("system health lists the checks the viewer can see", async () => {
    const h = await home.getSalesMarketingHome(admin, {});
    expect(h.health.map((x) => x.key)).toEqual(expect.arrayContaining(["attribution", "bulk", "report_deliveries"]));
    expect(h.health.find((x) => x.key === "attribution")?.status).toBe("UNKNOWN"); // no model yet
    expect(h.health.find((x) => x.key === "bulk")?.label).toBe("Bulk jobs (7 days)");
    const l = await home.getSalesMarketingHome(limited, {});
    expect(l.health.find((x) => x.key === "report_deliveries")).toBeUndefined();
  });

  it("rejects an unknown period", async () => {
    await expect(home.getSalesMarketingHome(admin, { preset: "forever" })).rejects.toBeTruthy();
  });
});
