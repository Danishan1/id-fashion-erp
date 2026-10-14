/**
 * Phase 22 — outgoing webhook subscriptions against a real, migrated Postgres
 * database and a real HTTP receiver on 127.0.0.1 (allow-listed for the test
 * only): the signing secret is returned once and never again (list, detail,
 * update, rotate-less reads, test, deliveries, audit, overview), destination
 * validation (SSRF), signed delivery of real CRM events, retries / back-off,
 * permanent failures, redirects refused, rotation, disable → queue cancelled,
 * no replay on re-enable, redelivery and delete.
 *
 * Skipped unless CRM_IT_DATABASE_URL points at a DISPOSABLE database:
 *   CRM_IT_DATABASE_URL=postgresql://…/crm_it npx vitest run src/modules/crm/webhooks-out/webhooks-out.integration.test.ts
 */
import { createHmac } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const DB_URL = process.env.CRM_IT_DATABASE_URL;
if (DB_URL) process.env.DATABASE_URL = DB_URL;
process.env.NEXTAUTH_SECRET ??= "integration-test-secret";
// The local receiver: plain http on 127.0.0.1, allowed for this test only.
process.env.CRM_WORKFLOW_WEBHOOK_ALLOW_HTTP = "true";
process.env.CRM_WORKFLOW_WEBHOOK_ALLOWED_HOSTS = "127.0.0.1";

vi.mock("@/core/rbac/PermissionService", () => ({
  PermissionService: {
    can: vi.fn(async () => true),
    assert: vi.fn(async () => undefined),
    getAllowedBranchIds: vi.fn(async () => null),
    invalidate: vi.fn(),
  },
}));

type Actor = { companyId: string; userId: string; branchId: string | null };
type Hit = { headers: http.IncomingHttpHeaders; body: string; path: string };

describe.skipIf(!DB_URL)("Outgoing webhook subscriptions (database + HTTP integration)", async () => {
  const { prisma } = await import("@/core/db/client");
  const subs = await import("./crm-webhook-subscriptions.service");
  const delivery = await import("./webhook-delivery");
  const leads = await import("../leads/lead.service");
  const overview = await import("../settings/crm-integrations-overview.service");
  const workflows = await import("../workflows/crm-workflows.service");

  const run = `wh${Date.now().toString(36)}`;
  let admin: Actor;
  let base = "";
  const hits: Hit[] = [];
  let mode: { status: number; location?: string } = { status: 200 };
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      hits.push({ headers: req.headers, body, path: req.url ?? "" });
      res.writeHead(mode.status, mode.location ? { Location: mode.location } : {});
      res.end("receiver says: internal detail that must not be stored");
    });
  });

  const verify = (hit: Hit, secret: string) => {
    const m = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(String(hit.headers["x-crm-signature"]));
    if (!m) return false;
    return createHmac("sha256", secret).update(`${m[1]}.${hit.body}`).digest("hex") === m[2];
  };
  const ownSubs = () => prisma.crmWebhookSubscription.findMany({ where: { companyId: admin.companyId } });
  /** Ticks with a clock far enough ahead for every back-off, only for this company's rows (other tests' rows are left alone). */
  const tick = (now = new Date()) => delivery.tickWebhooks(now);

  beforeAll(async () => {
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const company = await prisma.company.create({ data: { name: `Webhook Co ${run}`, baseCurrencyCode: "INR" } });
    const u = await prisma.user.create({ data: { companyId: company.id, email: `admin.${run}@wh-it.local`, passwordHash: "x", fullName: `Admin ${run}` } });
    admin = { companyId: company.id, userId: u.id, branchId: null };
  });

  afterAll(async () => {
    await prisma.crmWebhookSubscription.deleteMany({ where: { companyId: admin?.companyId } });
    await new Promise((r) => server.close(r));
    await prisma.$disconnect();
  });

  let subId = "";
  let secret = "";

  it("returns the signing secret once at creation and never again", async () => {
    const created = await subs.createSubscription(admin, { name: `Warehouse ${run}`, url: `${base}/hook`, eventTypes: ["lead.created", "lead.status_changed"] });
    expect(created.secretOnce).toMatch(/^whsec_[A-Za-z0-9_-]{40,}$/);
    expect(created.secret).toEqual({ configured: true, masked: "whsec_••••••••", rotatedAt: null });
    subId = created.id;
    secret = created.secretOnce;

    const row = await prisma.crmWebhookSubscription.findUniqueOrThrow({ where: { id: subId } });
    expect(row.secretEncrypted).not.toContain(secret);

    const reads = [
      await subs.listSubscriptions(admin),
      await subs.getSubscription(admin, subId),
      await subs.updateSubscription(admin, subId, { version: row.version, description: "BI pipeline" }),
      await overview.getSettingsOverview(admin),
    ];
    for (const r of reads) {
      const json = JSON.stringify(r);
      expect(json).not.toContain(secret);
      expect(json).not.toContain(row.secretEncrypted);
      expect(json).not.toContain("secretEncrypted");
    }
    const audits = await prisma.auditLog.findMany({ where: { recordId: subId } });
    expect(audits.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(audits)).not.toContain(secret);
    expect(audits.some((a) => (a.newValues as Record<string, unknown>)?.secret === "generated")).toBe(true);
  });

  it("can't set or read a secret through create / update payloads", async () => {
    await expect(subs.createSubscription(admin, { name: `X ${run}`, url: `${base}/x`, eventTypes: ["lead.created"], secret: "mine" })).rejects.toThrow();
    const row = await prisma.crmWebhookSubscription.findUniqueOrThrow({ where: { id: subId } });
    await expect(subs.updateSubscription(admin, subId, { version: row.version, secret: "mine" })).rejects.toThrow();
    await expect(subs.createSubscription(admin, { name: `Y ${run}`, url: `${base}/y`, eventTypes: ["workflow.draft_saved"] })).rejects.toThrow(/not available/);
  });

  it("refuses unsafe destinations (SSRF): metadata, private ranges, credentials, odd ports, internal names", async () => {
    const bad = ["http://169.254.169.254/latest/meta-data", "https://10.0.0.5/hook", "https://192.168.1.10/hook", "https://[::1]/hook", "https://user:pw@example.com/hook", "https://example.com:22/hook", "https://intranet.local/hook", "ftp://example.com/x", "not a url"];
    for (const url of bad) await expect(subs.createSubscription(admin, { name: `Bad ${run} ${url.length}`, url, eventTypes: ["lead.created"] }), url).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("sends a signed test event now, recorded in the log without its body", async () => {
    hits.length = 0;
    const r = await subs.sendTestDelivery(admin, subId, { eventType: "lead.status_changed" });
    expect(r).toMatchObject({ status: "SUCCEEDED", responseStatus: 200 });
    expect(hits).toHaveLength(1);
    const hit = hits[0];
    expect(verify(hit, secret)).toBe(true);
    expect(hit.headers["user-agent"]).toBe("FashionERP-CRM-Webhooks/1");
    expect(hit.headers["x-crm-event-type"]).toBe("lead.status_changed");
    expect(hit.headers["idempotency-key"]).toBe(r.deliveryId);
    const body = JSON.parse(hit.body);
    expect(body).toMatchObject({ type: "lead.status_changed", test: true, data: { entity: { type: "LEAD" } } });
    expect(hit.body).not.toContain(secret);

    const log = await subs.listDeliveries(admin, subId, { skip: 0, take: 10 });
    expect(log.rows[0]).toMatchObject({ id: r.deliveryId, isTest: true, status: "SUCCEEDED", statusLabel: "Delivered" });
    expect(JSON.stringify(log)).not.toContain("payload");
    expect(JSON.stringify(log)).not.toContain("internal detail");
    await expect(subs.redeliver(admin, subId, r.deliveryId)).rejects.toThrow(/new test event/);
  });

  let leadId = "";
  it("delivers real CRM events once, signed, with the event id", async () => {
    hits.length = 0;
    const lead = (await leads.createLead(admin, { firstName: "Asha", lastName: run, email: `asha.${run}@wh-it.local` })) as { id: string };
    leadId = lead.id;
    const ev = await prisma.crmEvent.findFirstOrThrow({ where: { companyId: admin.companyId, eventType: "lead.created", entityId: leadId } });
    await tick();
    const mine = hits.filter((h) => h.path === "/hook");
    expect(mine).toHaveLength(1);
    expect(verify(mine[0], secret)).toBe(true);
    expect(mine[0].headers["x-crm-event-id"]).toBe(ev.id);
    expect(JSON.parse(mine[0].body)).toMatchObject({ id: ev.id, type: "lead.created", test: false, data: { entity: { type: "LEAD", id: leadId } } });
    // Queued once per (subscription, event): another tick sends nothing new.
    await tick();
    expect(hits.filter((h) => h.path === "/hook")).toHaveLength(1);
    const d = await prisma.crmWebhookDelivery.findFirstOrThrow({ where: { subscriptionId: subId, eventId: ev.id } });
    expect(d).toMatchObject({ status: "SUCCEEDED", attempts: 1, responseStatus: 200, payload: null });
  });

  it("does not replay events from before a subscription existed", async () => {
    const later = await subs.createSubscription(admin, { name: `Late ${run}`, url: `${base}/late`, eventTypes: ["lead.created"] });
    hits.length = 0;
    await tick();
    expect(hits.filter((h) => h.path === "/late")).toHaveLength(0);
    await subs.deleteSubscription(admin, later.id);
  });

  it("retries 5xx with back-off, then succeeds; 4xx and redirects fail at once", async () => {
    mode = { status: 503 };
    hits.length = 0;
    const t0 = new Date();
    // A status change is a subscribed event.
    const ev = await prisma.crmEvent.create({ data: { companyId: admin.companyId, eventType: "lead.status_changed", entityType: "LEAD", entityId: leadId, summary: "it", payload: {}, occurredAt: t0, actorUserId: admin.userId } });
    await tick(t0);
    let d = await prisma.crmWebhookDelivery.findFirstOrThrow({ where: { subscriptionId: subId, eventId: ev.id } });
    expect(d).toMatchObject({ status: "RETRYING", attempts: 1, responseStatus: 503, errorCode: "HTTP_503" });
    expect(d.nextAttemptAt.getTime() - t0.getTime()).toBeGreaterThanOrEqual(59_000);
    expect(d.errorMessage).not.toContain("internal detail");

    await tick(new Date(t0.getTime() + 30_000)); // not due yet
    expect((await prisma.crmWebhookDelivery.findUniqueOrThrow({ where: { id: d.id } })).attempts).toBe(1);

    mode = { status: 200 };
    await tick(new Date(t0.getTime() + 61_000));
    d = await prisma.crmWebhookDelivery.findUniqueOrThrow({ where: { id: d.id } });
    expect(d).toMatchObject({ status: "SUCCEEDED", attempts: 2 });
    const sends = hits.filter((h) => h.headers["x-crm-event-id"] === ev.id);
    expect(sends.map((h) => h.headers["x-crm-delivery-attempt"])).toEqual(["1", "2"]);
    expect(new Set(sends.map((h) => h.headers["idempotency-key"])).size).toBe(1); // same key on retry

    mode = { status: 400 };
    const ev2 = await prisma.crmEvent.create({ data: { companyId: admin.companyId, eventType: "lead.status_changed", entityType: "LEAD", entityId: leadId, summary: "it", payload: {}, occurredAt: new Date(), actorUserId: admin.userId } });
    await tick();
    expect(await prisma.crmWebhookDelivery.findFirstOrThrow({ where: { subscriptionId: subId, eventId: ev2.id } })).toMatchObject({ status: "FAILED", attempts: 1, errorCode: "HTTP_400" });

    mode = { status: 302, location: "http://169.254.169.254/" };
    const ev3 = await prisma.crmEvent.create({ data: { companyId: admin.companyId, eventType: "lead.status_changed", entityType: "LEAD", entityId: leadId, summary: "it", payload: {}, occurredAt: new Date(), actorUserId: admin.userId } });
    hits.length = 0;
    await tick();
    expect(await prisma.crmWebhookDelivery.findFirstOrThrow({ where: { subscriptionId: subId, eventId: ev3.id } })).toMatchObject({ status: "FAILED", errorCode: "REDIRECT_REFUSED" });
    expect(hits.every((h) => h.path === "/hook")).toBe(true); // the redirect target was never called

    // Redeliver a failed one: back to the queue, sent again with the same key.
    mode = { status: 200 };
    const failed = await prisma.crmWebhookDelivery.findFirstOrThrow({ where: { subscriptionId: subId, eventId: ev2.id } });
    await subs.redeliver(admin, subId, failed.id);
    await tick();
    expect(await prisma.crmWebhookDelivery.findUniqueOrThrow({ where: { id: failed.id } })).toMatchObject({ status: "SUCCEEDED", attempts: 1 });
    await expect(subs.redeliver(admin, subId, failed.id).then(() => subs.redeliver(admin, subId, failed.id))).rejects.toThrow(/already queued/);
  });

  it("rotation returns a new secret once; the old one stops working at once", async () => {
    await tick(); // flush the queued redelivery
    const before = await prisma.crmWebhookSubscription.findUniqueOrThrow({ where: { id: subId } });
    await expect(subs.rotateSubscriptionSecret(admin, subId, { version: before.version - 1 })).rejects.toMatchObject({ code: "RECORD_VERSION_CONFLICT" });
    const rotated = await subs.rotateSubscriptionSecret(admin, subId, { version: before.version });
    expect(rotated.secretOnce).not.toBe(secret);
    expect(rotated.secret.rotatedAt).toBeTruthy();
    hits.length = 0;
    await subs.sendTestDelivery(admin, subId, {});
    expect(verify(hits[0], rotated.secretOnce)).toBe(true);
    expect(verify(hits[0], secret)).toBe(false);
    expect(JSON.stringify(await subs.getSubscription(admin, subId))).not.toContain(rotated.secretOnce);
    const audits = await prisma.auditLog.findMany({ where: { recordId: subId } });
    expect(JSON.stringify(audits)).not.toContain(rotated.secretOnce);
    expect(audits.some((a) => (a.newValues as Record<string, unknown>)?.secret === "rotated")).toBe(true);
    secret = rotated.secretOnce;
  });

  it("disabling cancels the queue; re-enabling never replays what happened meanwhile", async () => {
    mode = { status: 503 };
    const ev = await prisma.crmEvent.create({ data: { companyId: admin.companyId, eventType: "lead.status_changed", entityType: "LEAD", entityId: leadId, summary: "it", payload: {}, occurredAt: new Date(), actorUserId: admin.userId } });
    await tick();
    const queued = await prisma.crmWebhookDelivery.findFirstOrThrow({ where: { subscriptionId: subId, eventId: ev.id } });
    expect(queued.status).toBe("RETRYING");
    let row = await prisma.crmWebhookSubscription.findUniqueOrThrow({ where: { id: subId } });
    await subs.updateSubscription(admin, subId, { version: row.version, isActive: false });
    expect((await prisma.crmWebhookDelivery.findUniqueOrThrow({ where: { id: queued.id } })).status).toBe("CANCELLED");
    await expect(subs.redeliver(admin, subId, queued.id)).rejects.toThrow(/Enable/);

    const whileOff = await prisma.crmEvent.create({ data: { companyId: admin.companyId, eventType: "lead.status_changed", entityType: "LEAD", entityId: leadId, summary: "it", payload: {}, occurredAt: new Date(), actorUserId: admin.userId } });
    await new Promise((r) => setTimeout(r, 20));
    row = await prisma.crmWebhookSubscription.findUniqueOrThrow({ where: { id: subId } });
    mode = { status: 200 };
    await subs.updateSubscription(admin, subId, { version: row.version, isActive: true });
    await tick();
    expect(await prisma.crmWebhookDelivery.count({ where: { subscriptionId: subId, eventId: whileOff.id } })).toBe(0);
  });

  it("overview reports the subscription as a real, connected integration; planned ones stay planned", async () => {
    const o = await overview.getSettingsOverview(admin);
    expect(o.timezone).toBe("Asia/Kolkata");
    expect(o.integrations.find((i) => i.key === "outgoing-webhooks")?.status).toBe("CONNECTED");
    expect(o.integrations.find((i) => i.key === "lead-api")?.status).toBe("AVAILABLE");
    for (const k of ["meta-lead-ads", "indiamart", "whatsapp-cloud-native", "email-sync"]) expect(o.integrations.find((i) => i.key === k)?.status).toBe("PLANNED");
  });

  it("workflow signing secrets can only be rotated (shown once), never revealed", async () => {
    expect("revealWebhookSecret" in workflows).toBe(false);
    const wf = (await workflows.createWorkflow(admin, { name: `WF ${run}`, trigger: "lead.created" })) as { id: string };
    const a = await workflows.rotateWebhookSecret(admin, wf.id);
    const b = await workflows.rotateWebhookSecret(admin, wf.id);
    expect(a.secret).not.toBe(b.secret);
    const got = await workflows.getWorkflow(admin, wf.id);
    expect(JSON.stringify(got)).not.toContain(b.secret);
    expect(got).toMatchObject({ hasWebhookSecret: true });
    expect(JSON.stringify(await prisma.auditLog.findMany({ where: { recordId: wf.id } }))).not.toContain(b.secret);
  });

  it("delete removes the subscription and its log", async () => {
    await subs.deleteSubscription(admin, subId);
    expect(await ownSubs()).toHaveLength(0);
    expect(await prisma.crmWebhookDelivery.count({ where: { subscriptionId: subId } })).toBe(0);
    await expect(subs.getSubscription(admin, subId)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
