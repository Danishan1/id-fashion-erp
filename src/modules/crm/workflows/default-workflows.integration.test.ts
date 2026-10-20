/**
 * Default CRM automations against a real, migrated Postgres database, in a
 * company created for this test: install (published v1, on / off per the
 * catalogue, run-as = installer), idempotency (never duplicated or
 * overwritten, archived copies not re-added), and that the switched-on
 * defaults really run on CRM events while the switched-off ones don't.
 *
 * Skipped unless CRM_IT_DATABASE_URL points at a DISPOSABLE database:
 *   CRM_IT_DATABASE_URL=postgresql://…/crm_it npx vitest run src/modules/crm/workflows/default-workflows.integration.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const DB_URL = process.env.CRM_IT_DATABASE_URL;
if (DB_URL) process.env.DATABASE_URL = DB_URL;
process.env.AUTH_SECRET ??= "crm-it-workflow-secret";

const viewAllUsers = new Set<string>();
vi.mock("@/core/rbac/PermissionService", () => ({
  PermissionService: {
    can: vi.fn(async (userId: string, _module: string, action: string) => (action === "view_all" ? viewAllUsers.has(userId) : true)),
    assert: vi.fn(async () => undefined),
    getAllowedBranchIds: vi.fn(async () => null),
    invalidate: vi.fn(),
  },
}));

type Actor = { companyId: string; userId: string; branchId: string | null };

describe.skipIf(!DB_URL)("Default CRM automations (database integration)", async () => {
  const { prisma } = await import("@/core/db/client");
  const wf = await import("./crm-workflows.service");
  const engine = await import("./workflow-engine");
  const leads = await import("../leads/lead.service");
  const opps = await import("../opportunities/crm-opportunities.service");
  const { DEFAULT_WORKFLOWS } = await import("./default-workflows");

  const run = `dw${Date.now().toString(36)}`;
  let admin: Actor;
  let rep: Actor;
  const byKey = async (key: string) => prisma.crmWorkflow.findFirstOrThrow({ where: { companyId: admin.companyId, templateKey: key } });
  const tasksOn = (entityId: string) => prisma.crmActivity.findMany({ where: { companyId: admin.companyId, entityId, source: "WORKFLOW" }, orderBy: { createdAt: "asc" } });
  /** Like the worker: dispatch new events, then run the executions they queued. */
  const tick = async () => {
    await engine.tickWorkflows(new Date());
    await engine.tickWorkflows(new Date(Date.now() + 1000));
  };
  const notes = (userId: string) => prisma.notification.findMany({ where: { companyId: admin.companyId, userId }, orderBy: { createdAt: "asc" } });

  beforeAll(async () => {
    const company = await prisma.company.create({ data: { name: `Defaults Co ${run}`, baseCurrencyCode: "INR" } });
    const mk = (n: string) => prisma.user.create({ data: { companyId: company.id, email: `${n}.${run}@dw-it.local`, passwordHash: "x", fullName: `${n} ${run}` } });
    const [a, r] = await Promise.all([mk("Manager"), mk("Rep")]);
    admin = { companyId: company.id, userId: a.id, branchId: null };
    rep = { companyId: company.id, userId: r.id, branchId: null };
    viewAllUsers.add(a.id);
    await engine.tickWorkflows(new Date()); // settle older events
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("installs every default once: published v1, on / off per the catalogue, running as the installer", async () => {
    const before = await wf.listDefaultWorkflows(admin);
    expect(before).toHaveLength(DEFAULT_WORKFLOWS.length);
    expect(before.every((d) => d.installed === null)).toBe(true);

    const r = await wf.installDefaultWorkflows(admin, {});
    expect(r.skipped).toEqual([]);
    expect(r.installed).toHaveLength(DEFAULT_WORKFLOWS.length);

    for (const d of DEFAULT_WORKFLOWS) {
      const w = await byKey(d.key);
      expect(w.status, d.key).toBe(d.enabledByDefault ? "PUBLISHED" : "DISABLED");
      expect(w.runAsUserId).toBe(admin.userId);
      expect(w.publishedVersionId).toBeTruthy();
      expect(w.draftVersionId).toBeNull();
      const detail = await wf.getWorkflow(admin, w.id);
      expect(detail.templateKey).toBe(d.key);
      expect(detail.published?.versionNumber).toBe(1);
    }
    const audits = await prisma.auditLog.count({ where: { companyId: admin.companyId, tableName: "crm_workflows", action: "CREATE" } });
    expect(audits).toBe(DEFAULT_WORKFLOWS.length);
  });

  it("is idempotent and never overwrites a team's choices; archived defaults stay removed", async () => {
    const hot = await byKey("lead-hot-alert");
    await wf.changeWorkflowStatus(admin, hot.id, "DISABLED", { version: hot.version });
    const lost = await byKey("opportunity-lost-review");
    await wf.changeWorkflowStatus(admin, lost.id, "ARCHIVED", { version: lost.version });

    const again = await wf.installDefaultWorkflows(admin, {});
    expect(again.installed).toEqual([]);
    expect(again.skipped).toHaveLength(DEFAULT_WORKFLOWS.length);
    expect((await byKey("lead-hot-alert")).status).toBe("DISABLED");
    expect((await byKey("opportunity-lost-review")).status).toBe("ARCHIVED");
    expect(await prisma.crmWorkflow.count({ where: { companyId: admin.companyId, templateKey: { not: null } } })).toBe(DEFAULT_WORKFLOWS.length);

    const list = await wf.listDefaultWorkflows(admin);
    expect(list.find((d) => d.key === "lead-hot-alert")?.installed?.status).toBe("DISABLED");
    await expect(wf.installDefaultWorkflows(admin, { keys: ["no-such-default"] })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    // Turned back on through the normal lifecycle.
    const h = await byKey("lead-hot-alert");
    await wf.changeWorkflowStatus(admin, h.id, "PUBLISHED", { version: h.version });
  });

  it("installs only the chosen keys for a company that has none", async () => {
    const company = await prisma.company.create({ data: { name: `Defaults Co B ${run}`, baseCurrencyCode: "INR" } });
    const u = await prisma.user.create({ data: { companyId: company.id, email: `b.${run}@dw-it.local`, passwordHash: "x", fullName: `B ${run}` } });
    const b = { companyId: company.id, userId: u.id, branchId: null };
    const r = await wf.installDefaultWorkflows(b, { keys: ["lead-first-contact", "inbox-reply-sla"] });
    expect(r.installed.map((x) => [x.key, x.status])).toEqual([
      ["lead-first-contact", "PUBLISHED"],
      ["inbox-reply-sla", "DISABLED"],
    ]);
    expect(await prisma.crmWorkflow.count({ where: { companyId: company.id } })).toBe(2);
  });

  it("switched-on defaults run on real CRM events; switched-off ones don't", async () => {
    // Owned lead → first-call task for the owner. High value → tagged + manager alerted.
    const owned = (await leads.createLead(admin, { firstName: "Asha", lastName: run, email: `asha.${run}@dw-it.local`, ownerUserId: rep.userId, estimatedValue: "750000" })) as { id: string };
    // Unassigned lead → the run-as user (manager) is told to assign it.
    const orphan = (await leads.createLead(admin, { firstName: "Nobody", lastName: run, email: `nobody.${run}@dw-it.local`, ownerUserId: null })) as { id: string };
    await tick();

    const t = await tasksOn(owned.id);
    expect(t.map((x) => x.subject)).toContain(`First call: Asha ${run}`);
    expect(t.find((x) => x.subject.startsWith("First call"))).toMatchObject({ assignedToUserId: rep.userId, priority: "HIGH", type: "CALL" });
    const tagged = await prisma.crmEntityTag.findMany({ where: { companyId: admin.companyId, entityId: owned.id }, include: { tag: true } });
    expect(tagged.map((x) => x.tag.name)).toContain("high-value");
    const mgr = (await notes(admin.userId)).map((n) => n.title);
    expect(mgr).toContain(`High-value lead: Asha ${run}`);
    expect(mgr).toContain(`Unassigned new lead: Nobody ${run}`);
    expect(await tasksOn(orphan.id)).toEqual([]);

    // The switched-off cadence never started.
    const cadence = await byKey("lead-no-response-cadence");
    expect(await prisma.crmWorkflowExecution.count({ where: { workflowId: cadence.id } })).toBe(0);

    // Reassignment → the new owner is notified.
    const l = await prisma.crmLead.findUniqueOrThrow({ where: { id: orphan.id } });
    await leads.updateLead(admin, orphan.id, { version: l.version, ownerUserId: rep.userId });
    await tick();
    expect((await notes(rep.userId)).map((n) => n.title)).toContain(`Lead assigned to you: Nobody ${run}`);

    // Opportunity: qualification task; won → handover task + manager alert, then a 30-day wait.
    const opp = (await opps.createOpportunity(admin, { name: `Polo order ${run}`, ownerUserId: rep.userId, amount: "1200000", currencyCode: "INR" })) as { id: string };
    await tick();
    expect((await tasksOn(opp.id)).map((x) => x.subject)).toContain(`Qualify Polo order ${run}`);
    expect((await notes(admin.userId)).map((n) => n.title)).toContain(`Big deal: Polo order ${run}`);

    await opps.changeOpportunityStatus(admin, opp.id, { status: "WON", reason: "it" });
    await tick();
    expect((await tasksOn(opp.id)).map((x) => x.subject)).toContain(`Hand over Polo order ${run} to merchandising`);
    expect((await notes(admin.userId)).map((n) => n.title)).toContain(`Deal won: Polo order ${run}`);
    const won = await byKey("opportunity-won-handover");
    const exec = await prisma.crmWorkflowExecution.findFirstOrThrow({ where: { workflowId: won.id, entityId: opp.id } });
    expect(exec.status).toBe("WAITING");
    expect(exec.nextRunAt!.getTime() - Date.now()).toBeGreaterThan(29 * 86_400_000);
  });
});
