/**
 * Phase 21 — CRM dashboard against a real, migrated Postgres database, in a
 * company created for this test (so every number is known): KPI definitions,
 * period vs current counts, business-day (Asia/Kolkata) boundaries, pipeline
 * and owner filters, record visibility (crm.view vs crm.view_all), drill-down
 * links that reproduce the same number through the list API filters, widget
 * errors isolated, settings-only automation health, and an empty company.
 *
 * Skipped unless CRM_IT_DATABASE_URL points at a DISPOSABLE database:
 *   CRM_IT_DATABASE_URL=postgresql://…/crm_it npx vitest run src/modules/crm/dashboard/dashboard.integration.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const DB_URL = process.env.CRM_IT_DATABASE_URL;
if (DB_URL) process.env.DATABASE_URL = DB_URL;

const viewAllUsers = new Set<string>();
const denied = new Set<string>();
vi.mock("@/core/rbac/PermissionService", () => ({
  PermissionService: {
    can: vi.fn(async (userId: string, module: string, action: string) => {
      if (denied.has(`${userId}:${module}.${action}`)) return false;
      return action === "view_all" ? viewAllUsers.has(userId) : true;
    }),
    assert: vi.fn(async () => undefined),
    getAllowedBranchIds: vi.fn(async () => null),
    invalidate: vi.fn(),
  },
}));

type Actor = { companyId: string; userId: string; branchId: string | null };

describe.skipIf(!DB_URL)("CRM dashboard (database integration)", async () => {
  const { prisma } = await import("@/core/db/client");
  const dash = await import("./crm-dashboard.service");
  const leads = await import("../leads/lead.service");
  const opps = await import("../opportunities/crm-opportunities.service");
  const acts = await import("../activities/crm-activities.service");
  const settings = await import("../settings/crm-settings.service");
  const { businessToday, addCalendarDays, businessDayStart } = await import("../core/crm-dates");
  const { parseLeadFilterParams } = await import("../leads/lead.schema");
  const { parseOpportunityFilterParams } = await import("../opportunities/opportunity.schema");
  const { buildLeadWhere } = await import("../leads/lead-filters");
  const { buildOpportunityWhere } = await import("../opportunities/opportunity-filters");
  const { getCrmRecordScope } = await import("../core/crm-visibility");

  const run = `db${Date.now().toString(36)}`;
  const now = new Date();
  const today = businessToday(now);
  let manager: Actor;
  let rep: Actor;
  let rep2: Actor;
  let sourceA: string;
  const ids: Record<string, string> = {};

  const q = (o: Record<string, unknown> = {}) => dash.dashboardQuerySchema.parse({ range: "7d", ...o });
  type W = Record<string, { status: string; data: any; message?: string }>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const get = async (actor: Actor, o: Record<string, unknown> = {}) => (await dash.getCrmDashboard(actor, q(o), now)).widgets as W;
  const card = (w: W, key: string) => w.kpis.data.cards.find((c: { key: string }) => c.key === key);

  /** Re-counts a drill-down link through the list API's own parser + where-builder (what the list page will show). */
  async function countHref(actor: Actor, href: string) {
    const url = new URL(href, "http://x");
    const scope = await getCrmRecordScope(actor);
    if (url.pathname === "/crm/leads") return prisma.crmLead.count({ where: buildLeadWhere(actor.companyId, parseLeadFilterParams(url.searchParams), scope) });
    if (url.pathname === "/crm/opportunities") return prisma.crmOpportunity.count({ where: buildOpportunityWhere(actor.companyId, parseOpportunityFilterParams(url.searchParams), scope) });
    throw new Error(`not a list href: ${href}`);
  }

  beforeAll(async () => {
    const company = await prisma.company.create({ data: { name: `Dash Co ${run}`, baseCurrencyCode: "INR" } });
    const mk = (n: string) => prisma.user.create({ data: { companyId: company.id, email: `${n}.${run}@dash-it.local`, passwordHash: "x", fullName: `${n} ${run}` } });
    const [m, r, r2] = await Promise.all([mk("Mona Manager"), mk("Ravi Rep"), mk("Rita Rep")]);
    manager = { companyId: company.id, userId: m.id, branchId: null };
    rep = { companyId: company.id, userId: r.id, branchId: null };
    rep2 = { companyId: company.id, userId: r2.id, branchId: null };
    viewAllUsers.add(m.id);
    denied.add(`${r.id}:crm_settings.view`);
    denied.add(`${r.id}:crm_settings.edit`);

    await settings.listLeadStatuses(company.id);
    sourceA = ((await settings.createLeadSource(manager, { name: `Fair ${run}` })) as { id: string }).id;

    const lead = async (key: string, by: Actor, extra: Record<string, unknown>, createdAt?: Date) => {
      const l = (await leads.createLead(by, { firstName: key, lastName: run, email: `${key.toLowerCase()}.${run}@dash-it.local`, ...extra })) as { id: string };
      if (createdAt) await prisma.crmLead.update({ where: { id: l.id }, data: { createdAt } });
      ids[key] = l.id;
      return l.id;
    };
    // Business-day boundary: 00:10 IST today is "today"; 23:50 IST yesterday is "yesterday".
    const startToday = businessDayStart(today);
    await lead("Fresh", rep, { ownerUserId: rep.userId });
    await lead("JustAfterMidnight", rep2, { ownerUserId: rep2.userId }, new Date(startToday.getTime() + 10 * 60_000));
    await lead("JustBeforeMidnight", rep, { ownerUserId: rep.userId, sourceId: sourceA, nextFollowUpAt: new Date(businessDayStart(addCalendarDays(today, -3)).getTime() + 3600_000).toISOString(), lastContactedAt: new Date(now.getTime() - 86_400_000).toISOString() }, new Date(startToday.getTime() - 10 * 60_000));
    await lead("Old", manager, { ownerUserId: manager.userId }, new Date(businessDayStart(addCalendarDays(today, -40)).getTime() + 3600_000));
    const archived = await lead("Archived", rep, { ownerUserId: rep.userId });
    await leads.archiveLead(rep, archived);

    const opp = async (key: string, by: Actor, extra: Record<string, unknown>) => {
      const o = (await opps.createOpportunity(by, { name: `${key} ${run}`, ...extra })) as { id: string };
      ids[key] = o.id;
      return o.id;
    };
    await opp("Open1", rep, { ownerUserId: rep.userId, amount: "1000", currencyCode: "INR" });
    await opp("Open2", rep2, { ownerUserId: rep2.userId, amount: "500", currencyCode: "USD" });
    const won = await opp("Won", rep, { ownerUserId: rep.userId, amount: "300", currencyCode: "INR" });
    await opps.changeOpportunityStatus(rep, won, { status: "WON", reason: "it" });
    const lostOld = await opp("LostOld", rep, { ownerUserId: rep.userId, amount: "50", currencyCode: "INR" });
    await opps.changeOpportunityStatus(rep, lostOld, { status: "LOST", reason: "price" });
    await prisma.crmOpportunity.update({ where: { id: lostOld }, data: { closedAt: businessDayStart(addCalendarDays(today, -20)) } });

    const act = (subject: string, extra: Record<string, unknown>) => acts.createActivity(rep, { type: "TASK", subject: `${subject} ${run}`, entityType: "LEAD", entityId: ids.Fresh, assignedToUserId: rep.userId, ...extra });
    await act("Overdue", { dueDate: addCalendarDays(today, -2) });
    await act("Today", { dueDate: today });
    await act("Soon", { dueDate: addCalendarDays(today, 3) });
    const done = (await act("Done", { dueDate: today })) as { id: string; version: number };
    await acts.completeActivity(rep, done.id, { version: done.version });
    await acts.createActivity(rep, { type: "APPOINTMENT", subject: `Visit ${run}`, entityType: "LEAD", entityId: ids.Fresh, assignedToUserId: rep.userId, dueDate: addCalendarDays(today, 2), dueTime: "11:00", endTime: "12:00" });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("KPIs: current totals vs period counts, value per currency, overdue work — for a manager seeing everyone", async () => {
    const w = await get(manager);
    expect(w.kpis.status).toBe("ok");
    expect(card(w, "activeLeads").value).toBe(4); // Fresh, AfterMidnight, BeforeMidnight, Old (archived excluded)
    expect(card(w, "activeLeads").scope).toBe("now");
    expect(card(w, "newLeads").value).toBe(4); // last 7 days incl. the archived one, excl. Old
    expect(card(w, "newLeads").scope).toBe("period");
    expect(card(w, "openOpportunities").value).toBe(2);
    expect(card(w, "openPipelineValue").money).toEqual([
      { currencyCode: "INR", total: 1000 },
      { currencyCode: "USD", total: 500 },
    ]);
    expect(card(w, "wonInPeriod").value).toBe(1);
    expect(card(w, "wonInPeriod").money).toEqual([{ currencyCode: "INR", total: 300 }]);
    expect(card(w, "overdueTasks").value).toBe(1);
    expect(card(w, "followUpsPassed").value).toBe(1);
    expect(card(w, "upcomingAppointments").value).toBe(1);
  });

  it("every KPI drill-down link reproduces its number through the list filters", async () => {
    const w = await get(manager);
    for (const key of ["activeLeads", "newLeads", "openOpportunities", "wonInPeriod", "followUpsPassed"]) {
      const c = card(w, key);
      expect(await countHref(manager, c.href), key).toBe(c.value);
    }
    for (const s of w.pipeline.data.stages) expect(await countHref(manager, s.href)).toBe(s.count);
    for (const s of w.leads.data.bySource.filter((x: { id: string | null }) => x.id)) expect(await countHref(manager, s.href)).toBe(s.count);
    for (const s of w.leads.data.byStatus) expect(await countHref(manager, s.href)).toBe(s.count);
    expect(await countHref(manager, w.attention.data.neverContacted.href)).toBe(w.attention.data.neverContacted.count);
  });

  it("periods are business days in Asia/Kolkata (00:10 IST today is today, 23:50 IST yesterday is yesterday)", async () => {
    const w = await get(manager, { range: "today" });
    expect(card(w, "newLeads").value).toBe(3); // Fresh, AfterMidnight, Archived — not BeforeMidnight
    const trend = (await get(manager)).leads.data.trend as { bucket: string; count: number }[];
    expect(trend.find((t) => t.bucket === today)!.count).toBe(3);
    expect(trend.find((t) => t.bucket === addCalendarDays(today, -1))!.count).toBe(1);
    expect(trend).toHaveLength(7);
    // Custom range validation.
    await expect(dash.getCrmDashboard(manager, q({ range: "custom", from: today, to: addCalendarDays(today, -1) }), now)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(dash.getCrmDashboard(manager, q({ range: "custom", from: "2024-01-01", to: today }), now)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    const custom = await get(manager, { range: "custom", from: addCalendarDays(today, -45), to: today });
    expect(card(custom, "newLeads").value).toBe(5); // includes Old
    expect(custom.leads.data.unit).toBe("week");
  });

  it("owner filter narrows every widget; a rep only sees their own records and can't pick another owner", async () => {
    const forRep = await get(manager, { owner: rep.userId });
    expect(card(forRep, "activeLeads").value).toBe(2); // Fresh, BeforeMidnight
    expect(card(forRep, "openOpportunities").value).toBe(1);
    expect(forRep.myWork.data.forUser).toContain("Ravi Rep");

    const asRep = await get(rep);
    expect(card(asRep, "activeLeads").value).toBe(2);
    expect(card(asRep, "openPipelineValue").money).toEqual([{ currencyCode: "INR", total: 1000 }]);
    expect(asRep.myWork.data.overdue.count).toBe(1);
    expect(asRep.myWork.data.today.count).toBe(1);
    expect(asRep.myWork.data.upcoming.count).toBe(1);
    expect(asRep.myWork.data.appointments.count).toBe(1);
    expect(asRep.myWork.data.completed.items.map((i: { subject: string }) => i.subject)).toContain(`Done ${run}`);
    expect(asRep.myWork.data.overdue.items[0].related.href).toBe(`/crm/leads/${ids.Fresh}`);
    // Feed shows only the rep's own actions.
    expect(asRep.activity.data.events.every((e: { actor: string | null }) => e.actor === `Ravi Rep ${run}`)).toBe(true);
    await expect(dash.getCrmDashboard(rep, q({ owner: rep2.userId }), now)).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    expect(card(await get(rep, { owner: "me" }), "activeLeads").value).toBe(2);
  });

  it("pipeline widget: stages from the pipeline's own configuration, won/lost in the period, unknown pipeline refused", async () => {
    const w = await get(manager, { range: "30d" });
    const p = w.pipeline.data;
    expect(p.stages.length).toBeGreaterThan(0);
    expect(p.stages.reduce((n: number, s: { count: number }) => n + s.count, 0)).toBe(2);
    expect(p.outcomes.won).toBe(1);
    expect(p.outcomes.lost).toBe(1);
    expect(p.outcomes.winRate).toBe(50);
    expect(p.outcomes.points.reduce((n: number, x: { won: number; lost: number }) => n + x.won + x.lost, 0)).toBe(2);
    expect((await get(manager, { range: "7d" })).pipeline.data.outcomes.lost).toBe(0);
    await expect(dash.getCrmDashboard(manager, q({ pipelineId: "00000000-0000-4000-8000-000000000000" }), now)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("leads needing attention and recent activity", async () => {
    const w = await get(manager);
    // Fresh counts as contacted: completing a task on it set its last-contacted date.
    expect(w.attention.data.neverContacted.count).toBe(2);
    expect(w.attention.data.followUpPassed.rows[0].id).toBe(ids.JustBeforeMidnight);
    expect(w.leads.data.bySource.find((s: { id: string }) => s.id === sourceA)?.count).toBeGreaterThanOrEqual(1);
    const types = w.activity.data.events.map((e: { eventType: string }) => e.eventType);
    expect(types).toEqual(expect.arrayContaining(["lead.created", "opportunity.created", "opportunity.won", "activity.completed"]));
    expect(types).not.toContain("lead.archived");
  });

  it("automation & integrations: settings users get workflow / capture / message health; others only their bulk jobs", async () => {
    const m = await get(manager);
    expect(m.automation.data.workflows).toMatchObject({ failed: 0, started: 0 });
    expect(m.automation.data.integrations).toMatchObject({ failedLeadCaptures: 0, failedMessages: 0 });
    const r = await get(rep);
    expect(r.automation.data.workflows).toBeNull();
    expect(r.automation.data.integrations).toBeNull();
    expect(r.automation.data.bulk).toMatchObject({ active: 0 });
  });

  it("returns only the requested widgets, and an empty company shows zeros, not errors", async () => {
    const only = await dash.getCrmDashboard(manager, q({ widgets: ["kpis"] }), now);
    expect(Object.keys(only.widgets)).toEqual(["kpis"]);
    const empty = await prisma.company.create({ data: { name: `Empty ${run}`, baseCurrencyCode: "INR" } });
    const u = await prisma.user.create({ data: { companyId: empty.id, email: `e.${run}@dash-it.local`, passwordHash: "x", fullName: "Empty" } });
    viewAllUsers.add(u.id);
    const e = (await dash.getCrmDashboard({ companyId: empty.id, userId: u.id, branchId: null }, q(), now)).widgets as W;
    for (const [k, v] of Object.entries(e)) expect(v.status, k).toBe("ok");
    expect(e.kpis.data.cards.every((c: { value: number | null; money?: unknown[] }) => (c.value ?? 0) === 0 && (c.money ?? []).length === 0)).toBe(true);
    expect(e.activity.data.events).toEqual([]);
  });
});
