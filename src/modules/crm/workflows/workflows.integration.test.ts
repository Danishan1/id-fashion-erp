/**
 * CRM workflow engine (Phase 18) against a real, migrated Postgres database:
 * versioning + immutability, publish validation, exactly-once triggering from
 * the crm_events outbox, conditions, actions through the real CRM services,
 * persistent waits, recursion protection, re-entry, pause, failure, test mode.
 *
 * Skipped unless CRM_IT_DATABASE_URL points at a DISPOSABLE database:
 *   CRM_IT_DATABASE_URL=postgresql://…/crm_it npx vitest run src/modules/crm/workflows/workflows.integration.test.ts
 *
 * Only permissions are mocked (every check passes; view_all for the manager).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const DB_URL = process.env.CRM_IT_DATABASE_URL;
if (DB_URL) process.env.DATABASE_URL = DB_URL;
// Webhook secrets are encrypted with the app secret.
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

describe.skipIf(!DB_URL)("CRM workflows (database integration)", async () => {
  const { prisma } = await import("@/core/db/client");
  const wf = await import("./crm-workflows.service");
  const engine = await import("./workflow-engine");
  const leads = await import("../leads/lead.service");

  const run = `wf${Date.now().toString(36)}`;
  let admin: Actor;
  const expectCode = (p: Promise<unknown>, code: string) => expect(p).rejects.toMatchObject({ code });
  const group = (conditions: unknown[], logic: "AND" | "OR" = "AND") => ({ kind: "group", logic, conditions });
  const cond = (field: string, operator: string, value?: unknown) => ({ kind: "condition", field, operator, ...(value !== undefined ? { value } : {}) });
  /** Advances the scheduler like the worker: dispatch new events, then run due executions. */
  const tick = (now = new Date()) => engine.tickWorkflows(now);
  const execsFor = (workflowId: string, mode = "LIVE") => prisma.crmWorkflowExecution.findMany({ where: { workflowId, mode }, orderBy: { createdAt: "asc" } });

  async function makeWorkflow(name: string, definition: Record<string, unknown>, trigger = "lead.created") {
    const { id } = await wf.createWorkflow(admin, { name: `${name} ${run}`, trigger, ...(trigger === "manual" ? { entityType: "LEAD" } : {}) });
    const w = await wf.getWorkflow(admin, id);
    const saved = await wf.saveDraft(admin, id, { version: w.version, definition: { schemaVersion: 1, trigger: { type: trigger, ...(trigger === "manual" ? { entityType: "LEAD" } : {}), conditions: group([]) }, settings: { timezone: "Asia/Kolkata", reentry: "AFTER_FINISH", allowWorkflowTriggers: false }, ...definition } });
    return saved.workflow;
  }
  async function publish(id: string) {
    const w = await wf.getWorkflow(admin, id);
    return wf.publishWorkflow(admin, id, { version: w.version });
  }
  const lead = (firstName: string, extra: Record<string, unknown> = {}) => leads.createLead(admin, { firstName, lastName: run, email: `${firstName.toLowerCase()}.${run}@wf-it.local`, ...extra }) as Promise<{ id: string }>;

  beforeAll(async () => {
    const company = await prisma.company.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
    const u = await prisma.user.create({ data: { companyId: company.id, email: `admin.${run}@wf-it.local`, passwordHash: "x", fullName: `Wendy Admin ${run}` } });
    admin = { companyId: company.id, userId: u.id, branchId: null };
    viewAllUsers.add(u.id);
    // Only events from now on are relevant: settle anything older.
    await tick();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("drafts are editable, publishing freezes a version and the database refuses changes to it", async () => {
    const w = await makeWorkflow("Freeze", { entryNodeId: "a", nodes: [{ id: "a", type: "EXIT", reason: "nothing" }] });
    expect(w.status).toBe("DRAFT");
    expect(w.draft?.versionNumber).toBe(1);
    const { workflow } = await publish(w.id);
    expect(workflow.status).toBe("PUBLISHED");
    expect(workflow.published?.versionNumber).toBe(1);
    expect(workflow.draft).toBeNull();
    await expect(prisma.crmWorkflowVersion.update({ where: { id: workflow.published!.id }, data: { definition: { hacked: true } } })).rejects.toThrow();
    // Editing a published workflow creates draft v2; the live version is untouched.
    const v2 = await wf.saveDraft(admin, w.id, { version: workflow.version, definition: { ...workflow.published!.definition, nodes: [{ id: "a", type: "EXIT", reason: "changed" }] } });
    expect(v2.workflow.draft?.versionNumber).toBe(2);
    expect(v2.workflow.published?.versionNumber).toBe(1);
    await publish(w.id);
    const versions = await wf.listVersions(admin, w.id);
    expect(versions.map((v) => `${v.versionNumber}:${v.status}`)).toEqual(["2:PUBLISHED", "1:SUPERSEDED"]);
    await wf.changeWorkflowStatus(admin, w.id, "ARCHIVED", { version: (await wf.getWorkflow(admin, w.id)).version });
  });

  it("refuses to publish invalid definitions (with the reasons) and webhooks to private addresses", async () => {
    const w = await makeWorkflow("Invalid", {
      entryNodeId: "a",
      nodes: [
        { id: "a", type: "ACTION", action: "webhook.post", params: { url: "https://127.0.0.1/hook" }, next: "b", onError: "STOP" },
        { id: "b", type: "ACTION", action: "note.add", params: {}, next: "a", onError: "STOP" },
      ],
    });
    const err = await publish(w.id).catch((e) => e);
    expect(err.code).toBe("CRM_WORKFLOW_INVALID");
    const messages = (err.details.errors as { message: string }[]).map((e) => e.message).join(" | ");
    expect(messages).toMatch(/private|internal/i);
    expect(messages).toMatch(/loop|cycle/i);
    expect(messages).toMatch(/required/i);
    await wf.changeWorkflowStatus(admin, w.id, "ARCHIVED", { version: (await wf.getWorkflow(admin, w.id)).version });
  });

  let mainId = "";

  it("starts exactly once per event, checks enrolment conditions and runs actions through the CRM services", async () => {
    const w = await makeWorkflow("Welcome", {
      trigger: { type: "lead.created", conditions: group([cond("record.full_name", "starts_with", "Hot")]) },
      entryNodeId: "task",
      nodes: [
        { id: "task", type: "ACTION", action: "task.create", params: { type: "CALL", subject: "Call {{lead.full_name}}", recipient: "RUN_AS", dueInDays: 1 }, next: "note", onError: "STOP" },
        { id: "note", type: "ACTION", action: "note.add", params: { body: "Auto: welcome sent to {{lead.full_name}}" }, next: "wait", onError: "STOP" },
        { id: "wait", type: "WAIT", wait: { mode: "DURATION", amount: 2, unit: "DAYS" }, next: "tag" },
        { id: "tag", type: "ACTION", action: "record.add_tags", params: { tagNames: `followed-${run}` }, next: null, onError: "STOP" },
      ],
    });
    mainId = w.id;
    await publish(w.id);

    const hot = await lead("Hotlead");
    const cold = await lead("Coldlead");
    const first = await tick();
    expect(first.started).toBeGreaterThanOrEqual(1);
    // A second pass over the same events starts nothing new.
    await tick();
    const execs = await execsFor(w.id);
    expect(execs).toHaveLength(1);
    expect(execs[0].entityId).toBe(hot.id);
    expect(execs.some((e) => e.entityId === cold.id)).toBe(false);

    // Ran up to the wait: the task and the note exist, the tag does not yet.
    const ex = await prisma.crmWorkflowExecution.findUniqueOrThrow({ where: { id: execs[0].id } });
    expect(ex.status).toBe("WAITING");
    expect(ex.nextRunAt!.getTime()).toBeGreaterThan(Date.now() + 47 * 3600_000);
    const tasks = await prisma.crmActivity.findMany({ where: { companyId: admin.companyId, source: "WORKFLOW", subject: { contains: `Hotlead ${run}` } } });
    expect(tasks).toHaveLength(1);
    expect(tasks[0].type).toBe("CALL");
    expect(await prisma.crmNote.count({ where: { entityId: hot.id, body: { contains: "welcome sent to Hotlead" } } })).toBe(1);

    // Two days later the scheduler resumes it and it completes.
    await tick(new Date(Date.now() + 49 * 3600_000));
    const done = await wf.getExecution(admin, ex.id);
    expect(done.status).toBe("COMPLETED");
    expect(done.outcome).toBe("COMPLETED");
    // The wait step row is updated in place when it resumes (WAITING → COMPLETED).
    expect(done.steps.map((s) => `${s.nodeId}:${s.status}`)).toEqual(["task:COMPLETED", "note:COMPLETED", "wait:COMPLETED", "tag:COMPLETED"]);
    const tagged = await prisma.crmEntityTag.findMany({ where: { entityId: hot.id }, include: { tag: true } });
    expect(tagged.some((t) => t.tag.name === `followed-${run}`)).toBe(true);
    // Still exactly one task — nothing ran twice.
    expect(await prisma.crmActivity.count({ where: { companyId: admin.companyId, source: "WORKFLOW", subject: { contains: `Hotlead ${run}` } } })).toBe(1);
  });

  it("two schedulers racing over the same events still start one execution per event", async () => {
    const l = await lead("Hotrace");
    await Promise.all([engine.dispatchWorkflowEvents(), engine.dispatchWorkflowEvents(), engine.dispatchWorkflowEvents()]);
    expect((await execsFor(mainId)).filter((e) => e.entityId === l.id)).toHaveLength(1);
  });

  it("is not re-triggered by its own changes (recursion protection) and respects re-entry", async () => {
    // A second workflow on "task created" must not fire for the workflow-created task.
    const w2 = await makeWorkflow("On task", { entryNodeId: "x", nodes: [{ id: "x", type: "EXIT" }] }, "task.created");
    await publish(w2.id);
    await lead("Hotagain");
    await tick();
    await tick();
    expect(await execsFor(w2.id)).toHaveLength(0);
    // Re-entry ONCE: a manual second start on a record that already ran is refused.
    const main = await wf.getWorkflow(admin, mainId);
    const draft = await wf.saveDraft(admin, mainId, { version: main.version, definition: { ...main.published!.definition, settings: { ...main.published!.definition.settings, reentry: "ONCE" } } });
    await wf.publishWorkflow(admin, mainId, { version: draft.workflow.version });
    const someone = (await execsFor(mainId))[0];
    await expectCode(wf.runWorkflowManually(admin, mainId, { entityType: "LEAD", entityId: someone.entityId }), "INVALID_STATE_TRANSITION");
    await wf.changeWorkflowStatus(admin, w2.id, "DISABLED", { version: (await wf.getWorkflow(admin, w2.id)).version });
  });

  it("pausing a workflow holds waiting executions; disabling cancels them", async () => {
    const w = await makeWorkflow("Pausable", { entryNodeId: "w", nodes: [{ id: "w", type: "WAIT", wait: { mode: "DURATION", amount: 1, unit: "HOURS" }, next: "n" }, { id: "n", type: "ACTION", action: "note.add", params: { body: "after wait" }, next: null, onError: "STOP" }] }, "manual");
    // manual workflows need a record type
    const cur = await wf.getWorkflow(admin, w.id);
    await wf.saveDraft(admin, w.id, { version: cur.version, definition: { ...cur.draft!.definition, trigger: { type: "manual", entityType: "LEAD", conditions: group([]) } } });
    await publish(w.id);
    const l = await lead("Pauseme");
    const started = await wf.runWorkflowManually(admin, w.id, { entityType: "LEAD", entityId: l.id });
    expect(started.status).toBe("WAITING");
    await wf.changeWorkflowStatus(admin, w.id, "PAUSED", { version: (await wf.getWorkflow(admin, w.id)).version });
    await engine.runExecution(started.id, { now: new Date(Date.now() + 2 * 3600_000) });
    expect((await prisma.crmWorkflowExecution.findUniqueOrThrow({ where: { id: started.id } })).status).toBe("PAUSED");
    expect(await prisma.crmNote.count({ where: { entityId: l.id, body: "after wait" } })).toBe(0);
    await wf.changeWorkflowStatus(admin, w.id, "DISABLED", { version: (await wf.getWorkflow(admin, w.id)).version });
    const after = await prisma.crmWorkflowExecution.findUniqueOrThrow({ where: { id: started.id } });
    expect(after.status).toBe("CANCELLED");
  });

  it("publish refuses an unknown message template", async () => {
    const w = await makeWorkflow("Bad template", { entryNodeId: "m", nodes: [{ id: "m", type: "ACTION", action: "message.send", params: { templateId: "00000000-0000-0000-0000-000000000000" }, next: null, onError: "STOP" }] }, "manual");
    const err = await publish(w.id).catch((e) => e);
    expect(err.code).toBe("CRM_WORKFLOW_INVALID");
    expect((err.details.errors as { message: string }[]).some((e) => /template/i.test(e.message))).toBe(true);
  });

  it("a step failing at run time fails the execution with a reason and an event; retry resumes from that step", async () => {
    const statuses = await prisma.crmLeadStatus.findMany({ where: { companyId: admin.companyId, isActive: true, kind: "OPEN" }, orderBy: { sortOrder: "asc" } });
    const target = statuses.find((x) => !x.isDefault) ?? statuses[0];
    const w = await makeWorkflow("Runtime fail", { entryNodeId: "s", nodes: [{ id: "s", type: "ACTION", action: "lead.change_status", params: { statusId: target.id }, next: "n", onError: "STOP" }, { id: "n", type: "ACTION", action: "note.add", params: { body: "after status" }, next: null, onError: "STOP" }] }, "manual");
    await publish(w.id);
    const l = await lead("Failme");
    // The status becomes unusable after publishing.
    await prisma.crmLeadStatus.update({ where: { id: target.id }, data: { isActive: false } });
    try {
      const ex = await wf.runWorkflowManually(admin, w.id, { entityType: "LEAD", entityId: l.id });
      expect(ex.status).toBe("FAILED");
      expect(ex.error?.message).toBeTruthy();
      expect(ex.steps.find((s) => s.nodeId === "s")?.status).toBe("FAILED");
      expect(await prisma.crmNote.count({ where: { entityId: l.id, body: "after status" } })).toBe(0);
      expect(await prisma.crmEvent.count({ where: { entityType: "WORKFLOW", entityId: w.id, eventType: "workflow.execution_failed" } })).toBe(1);
      await prisma.crmLeadStatus.update({ where: { id: target.id }, data: { isActive: true } });
      const retried = await wf.retryExecution(admin, ex.id);
      expect(retried.status).toBe("COMPLETED");
      expect(await prisma.crmNote.count({ where: { entityId: l.id, body: "after status" } })).toBe(1);
      expect((await prisma.crmLead.findUniqueOrThrow({ where: { id: l.id } })).statusId).toBe(target.id);
    } finally {
      await prisma.crmLeadStatus.update({ where: { id: target.id }, data: { isActive: true } });
    }
  });

  it("test mode simulates every action: nothing is created, the trace shows what would happen", async () => {
    const l = await lead("Hottest");
    const before = await prisma.crmActivity.count({ where: { companyId: admin.companyId, source: "WORKFLOW" } });
    const res = await wf.testWorkflow(admin, mainId, { entityType: "LEAD", entityId: l.id, source: "published" });
    expect(res.execution.mode).toBe("TEST");
    expect(res.enrolment?.wouldEnrol).toBe(true);
    expect(res.execution.steps.filter((s) => s.nodeType === "ACTION").every((s) => s.status === "SIMULATED")).toBe(true);
    expect(res.execution.status).toBe("COMPLETED");
    expect(await prisma.crmActivity.count({ where: { companyId: admin.companyId, source: "WORKFLOW" } })).toBe(before);
    // Test runs never appear in the live list.
    const live = await wf.listExecutions(admin, { workflowId: mainId }, { page: 1, pageSize: 50, skip: 0, take: 50, search: "", sortBy: "createdAt", sortOrder: "desc" } as never);
    expect(live.data.every((e) => e.mode === "LIVE")).toBe(true);
  });

  it("writes audit rows and timeline events for workflow changes", async () => {
    const events = await prisma.crmEvent.findMany({ where: { entityType: "WORKFLOW", entityId: mainId }, select: { eventType: true } });
    const types = events.map((e) => e.eventType);
    expect(types).toEqual(expect.arrayContaining(["workflow.created", "workflow.draft_saved", "workflow.published"]));
    expect(await prisma.auditLog.count({ where: { recordId: mainId, tableName: "crm_workflows" } })).toBeGreaterThan(1);
  });
});
