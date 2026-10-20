/**
 * Phase 14 — end to end through the real queue: submit → BullMQ message →
 * worker (the same startBulkActionWorker the worker process runs) → job
 * completed in Postgres; plus the recovery tick re-enqueueing a job whose
 * message was lost.
 *
 * Skipped unless BOTH a disposable database and a Redis are given:
 *   CRM_IT_DATABASE_URL=postgresql://…/crm_it BULK_IT_REDIS_URL=redis://localhost:6379 npx vitest run src/modules/bulk-actions/bulk-queue.integration.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const DB_URL = process.env.CRM_IT_DATABASE_URL;
const REDIS = process.env.BULK_IT_REDIS_URL;
if (DB_URL) process.env.DATABASE_URL = DB_URL;
if (REDIS) process.env.REDIS_URL = REDIS;
// Own queue name so a developer's running worker never picks these up.
process.env.BULK_ACTION_QUEUE_NAME = `bulk-actions-it-${Date.now().toString(36)}`;

vi.mock("@/core/rbac/PermissionService", () => ({
  PermissionService: { can: vi.fn(async () => true), assert: vi.fn(async () => undefined), getAllowedBranchIds: vi.fn(async () => null), invalidate: vi.fn() },
}));

describe.skipIf(!DB_URL || !REDIS)("Bulk jobs through the real queue + worker", async () => {
  const { prisma } = await import("@/core/db/client");
  const svc = await import("./bulk-jobs.service");
  const { startBulkActionWorker } = await import("./bulk-actions.worker");
  const { getBulkActionQueue } = await import("./bulk-queue");
  const { recoverBulkJobs } = await import("./bulk-engine");
  const { enqueueBulkJob } = await import("./bulk-queue");
  const leads = await import("@/modules/crm/leads/lead.service");
  const run = `bq${Date.now().toString(36)}`;
  let actor: { companyId: string; userId: string; branchId: null };
  let worker: Awaited<ReturnType<typeof startBulkActionWorker>>;

  const waitFor = async (id: string, statuses: string[], ms = 20_000) => {
    const end = Date.now() + ms;
    for (;;) {
      const j = await prisma.bulkJob.findUniqueOrThrow({ where: { id } });
      if (statuses.includes(j.status)) return j;
      if (Date.now() > end) throw new Error(`timeout: job is ${j.status}`);
      await new Promise((r) => setTimeout(r, 200));
    }
  };

  beforeAll(async () => {
    const company = await prisma.company.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
    const u = await prisma.user.create({ data: { companyId: company.id, email: `q.${run}@bulk-it.local`, passwordHash: "x", fullName: `Queue ${run}` } });
    actor = { companyId: company.id, userId: u.id, branchId: null };
    worker = startBulkActionWorker();
  });

  afterAll(async () => {
    await worker?.close();
    const q = getBulkActionQueue();
    await q.obliterate({ force: true }).catch(() => undefined);
    await q.close();
    await prisma.$disconnect();
  });

  it("a submitted job is picked up by the worker and completed", async () => {
    const ls = [];
    for (let i = 0; i < 3; i++) ls.push((await leads.createLead(actor, { firstName: `Queue ${i}`, lastName: run })) as { id: string });
    const job = await svc.createBulkJob(actor, { entityType: "LEAD", actionKey: "lead.add_tags", selection: { mode: "IDS", ids: ls.map((l) => l.id) }, params: { tagNames: [`${run}-q`] } });
    expect(job.queued).toBe(true);
    const done = await waitFor(job.id, ["COMPLETED", "COMPLETED_WITH_ERRORS", "FAILED"]);
    expect(done.status).toBe("COMPLETED");
    expect(done.succeededCount).toBe(3);
  });

  it("the recovery tick re-enqueues a job whose queue message was lost", async () => {
    const l = (await leads.createLead(actor, { firstName: "Lost", lastName: run })) as { id: string };
    // Create without a queue message (simulates Redis being down at submit time).
    const saved = process.env.REDIS_URL;
    delete process.env.REDIS_URL;
    const job = await svc.createBulkJob(actor, { entityType: "LEAD", actionKey: "lead.add_tags", selection: { mode: "IDS", ids: [l.id] }, params: { tagNames: [`${run}-lost`] } });
    process.env.REDIS_URL = saved;
    expect(job.queued).toBe(false);
    await prisma.bulkJob.update({ where: { id: job.id }, data: { createdAt: new Date(Date.now() - 5 * 60_000) } });
    const r = await recoverBulkJobs(new Date(), enqueueBulkJob);
    expect(r.resumed).toContain(job.id);
    expect((await waitFor(job.id, ["COMPLETED"])).succeededCount).toBe(1);
  });
});
