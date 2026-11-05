/**
 * Campaign delivery (Phase 10) against a real, migrated + seeded Postgres
 * database, with the provider mocked (no network). Skipped unless
 * CRM_IT_DATABASE_URL points at a DISPOSABLE database.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const DB_URL = process.env.CRM_IT_DATABASE_URL;
if (DB_URL) process.env.DATABASE_URL = DB_URL;
process.env.APP_BASE_URL = "https://erp.example.com";
process.env.AUTH_SECRET ||= "integration-test-secret-integration-1234";
delete process.env.REDIS_URL;

vi.mock("@/core/rbac/PermissionService", () => ({
  PermissionService: {
    can: vi.fn(async () => true),
    assert: vi.fn(async () => undefined),
    assertAny: vi.fn(async () => undefined),
    getAllowedBranchIds: vi.fn(async () => null),
    invalidate: vi.fn(),
  },
}));

type Actor = { companyId: string; userId: string; branchId: string | null };

describe.skipIf(!DB_URL)("Campaign delivery (database integration)", async () => {
  const { prisma } = await import("@/core/db/client");
  const connections = await import("./connection.service");
  const runs = await import("./delivery-run.service");
  const engine = await import("./delivery-engine");
  const events = await import("./delivery-events.service");
  const common = await import("./delivery-common");
  const segs = await import("@/modules/sales-marketing/segments/segment.service");
  const evals = await import("@/modules/sales-marketing/segments/segment-evaluation.service");
  const audience = await import("@/modules/sales-marketing/segments/campaign-audience.service");
  const campaigns = await import("@/modules/sales-marketing/campaigns/campaign.service");
  const lookups = await import("@/modules/sales-marketing/campaigns/campaign-lookup.service");

  const run = `d${Date.now().toString(36)}`;
  let owner: Actor;
  const stranger: Actor = { companyId: "00000000-0000-4000-8000-000000000000", userId: "00000000-0000-4000-8000-000000000001", branchId: null };
  const c: Record<"ok1" | "ok2" | "ok3" | "noEmail" | "dnc" | "dup", string> = { ok1: "", ok2: "", ok3: "", noEmail: "", dnc: "", dup: "" };
  let campaignId = "";
  let connectionId = "";
  let channelId = "";
  let runId = "";
  const expectCode = (p: Promise<unknown>, code: string) => expect(p).rejects.toMatchObject({ code });

  // Fake Brevo: accepts ok1, times out (no answer) for ok3.
  const sent: string[] = [];
  const fakeFetch = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { to: { email: string }[] };
    const to = body.to[0].email;
    sent.push(to);
    if (to.startsWith("ok3")) throw Object.assign(new Error("aborted"), { name: "AbortError" });
    return new Response(JSON.stringify({ messageId: `<${to}@relay>` }), { status: 201 });
  }) as unknown as typeof fetch;
  const scheduled: { step: string; at: Date | null | undefined }[] = [];
  const deps = { fetch: fakeFetch, now: () => new Date(), sleep: async () => undefined, schedule: async (step: "run.prepare" | "run.dispatch", _id: string, at?: Date | null) => (scheduled.push({ step, at }), true) };

  beforeAll(async () => {
    const company = await prisma.company.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
    const u = await prisma.user.create({ data: { companyId: company.id, email: `owner.${run}@del-it.local`, passwordHash: "x", fullName: `Owner ${run}` } });
    owner = { companyId: company.id, userId: u.id, branchId: null };
    const contact = (key: keyof typeof c, name: string, email: string | null) =>
      prisma.crmContact.create({ data: { companyId: company.id, firstName: name, fullName: `${name} ${run}`, email, ownerUserId: u.id, createdByUserId: u.id } }).then((r) => (c[key] = r.id));
    await contact("ok1", "Asha", `ok1.${run}@example.com`);
    await contact("ok2", "Bina", `ok2.${run}@example.com`);
    await contact("ok3", "Chetan", `ok3.${run}@example.com`);
    await contact("noEmail", "Dev", null);
    await contact("dnc", "Esha", `dnc.${run}@example.com`);
    await contact("dup", "Farah", `OK1.${run}@example.com`);
    await prisma.crmContactConsent.create({ data: { companyId: company.id, contactId: c.dnc, channel: "EMAIL", status: "DO_NOT_CONTACT" } });

    const seg = await segs.createSegment(owner, { code: `del-${run}`, name: `Delivery ${run}`, sourceType: "CONTACT", segmentType: "STATIC", ownerUserId: owner.userId });
    await segs.addSegmentMembers(owner, seg.id, { recordIds: Object.values(c), kind: "INCLUDED" });
    const ev = await evals.requestSegmentEvaluation(owner, seg.id, {});
    expect(await evals.runSegmentEvaluation(ev.evaluation.id)).toMatchObject({ status: "COMPLETED", memberCount: 6 });
    await segs.segmentAction(owner, seg.id, "activate", {});

    const list = await lookups.listCampaignLookups(owner, {});
    const camp = await campaigns.createCampaign(owner, {
      code: `del-${run}`,
      name: `Delivery ${run}`,
      typeId: list.find((l) => l.kind === "TYPE")!.id,
      objectiveId: list.find((l) => l.kind === "OBJECTIVE")!.id,
      ownerUserId: owner.userId,
      plannedStartDate: new Date().toISOString().slice(0, 10),
      plannedEndDate: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
    });
    campaignId = camp.id;
    await audience.addCampaignAudience(owner, campaignId, { segmentId: seg.id, role: "INCLUDE", pinLatest: true });

    const t = await prisma.crmMessageTemplate.create({ data: { companyId: company.id, name: `Promo ${run}`, nameKey: `promo ${run}`, channelType: "EMAIL", status: "DRAFT", createdByUserId: u.id } });
    const v = await prisma.crmMessageTemplateVersion.create({ data: { companyId: company.id, templateId: t.id, versionNumber: 1, subject: "Hello {{contact.first_name}}", body: "Hi {{contact.first_name}}, new styles are in.", variables: ["contact.first_name"], createdByUserId: u.id } });
    await prisma.crmMessageTemplate.update({ where: { id: t.id }, data: { currentVersionId: v.id, currentVersionNumber: 1, status: "ACTIVE", activatedAt: new Date(), activatedByUserId: u.id } });
    (globalThis as { __tpl?: string }).__tpl = t.id;
    // Phase 11: a template version must be approved for marketing (by someone else) before it can be sent.
    const reviewer = await prisma.user.create({ data: { companyId: company.id, email: `reviewer.${run}@del-it.local`, passwordHash: "x", fullName: `Reviewer ${run}` } });
    const { reviewVersion } = await import("@/modules/sales-marketing/content/content-review.service");
    await reviewVersion(owner, "TEMPLATE_VERSION", v.id, "submit", {});
    await reviewVersion({ companyId: company.id, userId: reviewer.id, branchId: null }, "TEMPLATE_VERSION", v.id, "approve", {});
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("connections keep secrets encrypted and never return them", async () => {
    const created = await connections.createConnection(owner, { code: `BREVO-${run}`.toUpperCase().slice(0, 30), name: `Brevo ${run}`, providerKey: "BREVO", config: { fromEmail: "news@example.com" }, secrets: { apiKey: "xkeysib-supersecret-123456" } });
    connectionId = created.id;
    expect(JSON.stringify(created)).not.toContain("supersecret");
    expect(created.secretHints).toEqual({ apiKey: "••••3456" });
    const row = await prisma.marketingChannelConnection.findUniqueOrThrow({ where: { id: connectionId } });
    expect(row.secretsEncrypted).not.toContain("supersecret");
    expect(JSON.stringify(await connections.listConnections(owner))).not.toContain("supersecret");
    await expectCode(connections.createConnection(owner, { code: `BAD-${run}`.toUpperCase().slice(0, 30), name: "x", providerKey: "BREVO", config: { fromEmail: "news@example.com", evil: "1" }, secrets: { apiKey: "k" } }), "VALIDATION_ERROR");
    // Edit without the secret keeps it.
    const updated = await connections.updateConnection(owner, connectionId, { name: `Brevo ${run} main`, config: { fromEmail: "news@example.com" }, consentPolicy: "OPT_OUT", ratePerMinute: 600, batchSize: 50, version: created.version });
    expect(common.runtimeOf(await prisma.marketingChannelConnection.findUniqueOrThrow({ where: { id: connectionId } })).secrets.apiKey).toBe("xkeysib-supersecret-123456");
    expect(updated.version).toBe(created.version + 1);
    await expectCode(connections.getConnection(stranger, connectionId), "NOT_FOUND");
  });

  it("channel setup and the eligibility preview (counts only)", async () => {
    const ch = await runs.addCampaignChannel(owner, campaignId, { connectionId, templateId: (globalThis as { __tpl?: string }).__tpl });
    channelId = ch.id;
    const p = await runs.previewEligibility(owner, channelId);
    expect(p).toMatchObject({ audience: 6, eligible: 3, skipped: { NO_ADDRESS: 1, CONSENT_RESTRICTED: 1, DUPLICATE_ADDRESS: 1 } });
    expect(await prisma.marketingDelivery.count({ where: { connectionId } })).toBe(0);
  });

  it("only an active campaign sends, and only on explicit confirmation", async () => {
    await expectCode(runs.startRun(owner, channelId, { confirmed: true }), "INVALID_STATE_TRANSITION");
    await prisma.marketingCampaign.update({ where: { id: campaignId }, data: { status: "ACTIVE", actualStartDate: new Date() } });
    await expect(runs.startRun(owner, channelId, {})).rejects.toBeTruthy();
    await expectCode(runs.startRun(stranger, channelId, { confirmed: true }), "NOT_FOUND");
  });

  it("starts once per idempotency key; one open run per channel", async () => {
    const a = await runs.startRun(owner, channelId, { confirmed: true, idempotencyKey: `key-${run}-1` });
    const b = await runs.startRun(owner, channelId, { confirmed: true, idempotencyKey: `key-${run}-1` });
    expect([a.created, b.created, b.run.id]).toEqual([true, false, a.run.id]);
    await expectCode(runs.startRun(owner, channelId, { confirmed: true, idempotencyKey: `key-${run}-2` }), "REQUEST_IN_PROGRESS");
    runId = a.run.id;
    expect(a.run).toMatchObject({ status: "PREPARING", plannedCount: 6, runNumber: 1 });
  });

  it("prepares recipients from the frozen snapshot", async () => {
    expect((await engine.prepareRun(runId, deps)).status).toBe("QUEUED");
    const ds = await prisma.marketingDelivery.findMany({ where: { runId } });
    expect(ds).toHaveLength(6);
    // ok1 and dup share an address: one keeps it (snapshot order), the other is skipped. Call the winner ok1.
    if (ds.find((d) => d.contactId === c.dup)!.status === "PENDING") [c.ok1, c.dup] = [c.dup, c.ok1];
    expect(ds.filter((d) => d.status === "PENDING").map((d) => d.contactId).sort()).toEqual([c.ok1, c.ok2, c.ok3].sort());
    expect(Object.fromEntries(ds.filter((d) => d.status === "SUPPRESSED").map((d) => [d.contactId, d.skipReason]))).toEqual({ [c.noEmail]: "NO_ADDRESS", [c.dnc]: "CONSENT_RESTRICTED", [c.dup]: "DUPLICATE_ADDRESS" });
    expect((await engine.prepareRun(runId, deps)).status).toBe("SKIPPED");
  });

  it("re-checks consent before each message; a timeout is UNKNOWN and never resent automatically", async () => {
    // ok2 opts out after the list was prepared.
    await prisma.crmContactConsent.create({ data: { companyId: owner.companyId, contactId: c.ok2, channel: "ALL", status: "UNSUBSCRIBED" } });
    await engine.dispatchRun(runId, deps);
    expect(sent.sort()).toEqual([`ok1.${run}@example.com`, `ok3.${run}@example.com`]);
    const by = Object.fromEntries((await prisma.marketingDelivery.findMany({ where: { runId } })).map((d) => [d.contactId, d]));
    expect(by[c.ok1]).toMatchObject({ status: "ACCEPTED", providerMessageId: `<ok1.${run}@example.com@relay>`, attempts: 1 });
    expect(by[c.ok2]).toMatchObject({ status: "SUPPRESSED", skipReason: "CONSENT_RESTRICTED" });
    expect(by[c.ok3]).toMatchObject({ status: "UNKNOWN", errorCode: "TIMEOUT" });
    const r = await runs.getRun(owner, runId);
    expect(r.status).toBe("PARTIALLY_COMPLETED");
    expect(r.counts).toMatchObject({ accepted: 1, unknown: 1, excluded: 4, pending: 0 });
    // Running the step again sends nothing.
    await engine.dispatchRun(runId, deps);
    await engine.recoverDelivery(deps);
    expect(sent).toHaveLength(2);
    await expectCode(runs.resumeRun(owner, runId), "VALIDATION_ERROR");
    await expectCode(runs.resolveUnknown(owner, runId, { resolution: "RESEND", reason: "check" }), "VALIDATION_ERROR");
  });

  it("webhooks: authenticated, stored once, applied forward-only; a callback settles an unknown", async () => {
    const conn = await prisma.marketingChannelConnection.findUniqueOrThrow({ where: { id: connectionId } });
    const ok1 = await prisma.marketingDelivery.findFirstOrThrow({ where: { runId, contactId: c.ok1 } });
    const ok3 = await prisma.marketingDelivery.findFirstOrThrow({ where: { runId, contactId: c.ok3 } });
    const req = (payload: unknown) => ({ method: "POST" as const, headers: new Headers({ "content-type": "application/json" }), rawBody: JSON.stringify(payload), query: new URLSearchParams() });
    const ts = Math.floor(Date.now() / 1000);
    const delivered = [
      { event: "delivered", "message-id": ok1.providerMessageId, "X-Mailin-custom": ok1.id, ts_event: ts },
      { event: "delivered", "message-id": "<lost@relay>", "X-Mailin-custom": ok3.id, ts_event: ts },
    ];
    await expectCode(events.receiveWebhook(connectionId, "0".repeat(48), req(delivered)), "NOT_FOUND");
    expect(await events.receiveWebhook(connectionId, conn.webhookToken, req(delivered))).toEqual({ received: 2, stored: 2 });
    expect(await events.receiveWebhook(connectionId, conn.webhookToken, req(delivered))).toEqual({ received: 2, stored: 0 });
    await events.processPendingEvents();
    // A "request" (sent) event arriving after delivery was applied must not move it back.
    await events.receiveWebhook(connectionId, conn.webhookToken, req([{ event: "request", "message-id": ok1.providerMessageId, "X-Mailin-custom": ok1.id, ts_event: ts - 60 }]));
    await events.processPendingEvents();
    const after = Object.fromEntries((await prisma.marketingDelivery.findMany({ where: { id: { in: [ok1.id, ok3.id] } } })).map((d) => [d.id, d]));
    expect(after[ok1.id].status).toBe("DELIVERED");
    expect(after[ok3.id]).toMatchObject({ status: "DELIVERED", providerMessageId: "<lost@relay>", errorCode: null });
    const results = await prisma.marketingDeliveryEvent.findMany({ where: { connectionId, source: "PROVIDER" }, orderBy: { occurredAt: "asc" } });
    expect(results.map((e) => e.result).sort()).toEqual(["APPLIED", "APPLIED", "STALE"]);
  });

  it("unsubscribes and complaints become CRM restrictions that only get stricter", async () => {
    const conn = await prisma.marketingChannelConnection.findUniqueOrThrow({ where: { id: connectionId } });
    const ok1 = await prisma.marketingDelivery.findFirstOrThrow({ where: { runId, contactId: c.ok1 } });
    await events.receiveWebhook(connectionId, conn.webhookToken, { method: "POST", headers: new Headers(), rawBody: JSON.stringify({ event: "unsubscribed", "message-id": ok1.providerMessageId, "X-Mailin-custom": ok1.id, ts_event: Math.floor(Date.now() / 1000) }), query: new URLSearchParams() });
    await events.processPendingEvents();
    expect(await prisma.crmContactConsent.findFirst({ where: { contactId: c.ok1, channel: "EMAIL" } })).toMatchObject({ status: "UNSUBSCRIBED", source: "SYSTEM" });

    // The link in the email: GET shows a masked address, POST records it; repeats are harmless.
    const ok3 = await prisma.marketingDelivery.findFirstOrThrow({ where: { runId, contactId: c.ok3 } });
    const token = common.signUnsubscribeToken(ok3.id);
    expect(await events.describeUnsubscribe(token)).toMatchObject({ channel: "EMAIL", maskedAddress: `ok•••@example.com` });
    expect(await events.unsubscribeByToken(token)).toBe(true);
    expect(await events.unsubscribeByToken(token)).toBe(true);
    expect(await prisma.crmContactConsent.count({ where: { contactId: c.ok3, channel: "EMAIL", status: "UNSUBSCRIBED" } })).toBe(1);
    expect(await events.unsubscribeByToken(token.slice(0, -2) + "zz")).toBe(false);
    // DO_NOT_CONTACT is never weakened to UNSUBSCRIBED.
    const dnc = await prisma.marketingDelivery.findFirstOrThrow({ where: { runId, contactId: c.dnc } });
    await events.unsubscribeByToken(common.signUnsubscribeToken(dnc.id));
    expect(await prisma.crmContactConsent.findFirst({ where: { contactId: c.dnc, channel: "EMAIL" } })).toMatchObject({ status: "DO_NOT_CONTACT" });
  });

  it("a scheduled run can be cancelled before it sends", async () => {
    const at = new Date(Date.now() + 3600_000).toISOString();
    await expectCode(runs.startRun(owner, channelId, { confirmed: true, scheduledFor: at }), "VALIDATION_ERROR"); // no worker configured
    process.env.REDIS_URL = "redis://worker.invalid:6379"; // only startRun's check reads it here
    const { run: r } = await runs.startRun(owner, channelId, { confirmed: true, scheduledFor: at });
    delete process.env.REDIS_URL;
    expect(r.runNumber).toBe(2);
    expect((await engine.prepareRun(r.id, deps)).status).toBe("SCHEDULED");
    const before = sent.length;
    const cancelled = await runs.cancelRun(owner, r.id, { reason: "Wrong date" });
    expect(cancelled.status).toBe("CANCELLED");
    expect(await prisma.marketingDelivery.count({ where: { runId: r.id, status: "PENDING" } })).toBe(0);
    await engine.dispatchRun(r.id, deps);
    expect(sent.length).toBe(before);
    await expectCode(runs.getRun(stranger, r.id), "NOT_FOUND");
  });
});
