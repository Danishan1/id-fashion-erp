/**
 * Sales & Marketing Phase 16 — integrations against a real, migrated Postgres
 * database and a real HTTP receiver on 127.0.0.1 (allow-listed for this test
 * only): scoped API keys through the real route handlers (auth, scopes, run-as
 * permission, rate limits, tenant isolation, rotation, revocation, disable),
 * enquiry intake (external ids, idempotency, ordering, field ownership,
 * conflicts and their resolution, concurrency), S&M outgoing webhooks from
 * the public event outbox (signature, minimal payload, duplicates, retries,
 * SSRF refusals), the registry, and CRM isolation.
 *
 * Skipped unless CRM_IT_DATABASE_URL points at a DISPOSABLE database.
 */
import { createHmac } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const DB_URL = process.env.CRM_IT_DATABASE_URL;
if (DB_URL) process.env.DATABASE_URL = DB_URL;
delete process.env.REDIS_URL;
process.env.NEXTAUTH_SECRET ??= "integration-test-secret";
process.env.CRM_WORKFLOW_WEBHOOK_ALLOW_HTTP = "true";
process.env.CRM_WORKFLOW_WEBHOOK_ALLOWED_HOSTS = "127.0.0.1";

const denied = new Set<string>();
const can = async (userId: string, module: string, action: string) => !denied.has(`${userId}:${module}.${action}`);
vi.mock("@/core/rbac/PermissionService", () => ({
  PermissionService: {
    can: vi.fn(can),
    assert: vi.fn(async (userId: string, module: string, action: string) => {
      if (!(await can(userId, module, action))) {
        const { BusinessRuleError } = await import("@/core/errors/BusinessRuleError");
        throw new BusinessRuleError("PERMISSION_DENIED", "denied");
      }
    }),
    assertAny: vi.fn(async () => undefined),
    getAllowedBranchIds: vi.fn(async () => null),
    getViewableModules: vi.fn(async () => []),
    invalidate: vi.fn(),
  },
}));

type Actor = { companyId: string; userId: string; branchId: string | null };

describe.skipIf(!DB_URL)("S&M integrations (database integration)", async () => {
  const { NextRequest } = await import("next/server");
  const { prisma } = await import("@/core/db/client");
  const keys = await import("./sm-api-keys.service");
  const hooks = await import("./sm-webhooks.service");
  const intake = await import("./enquiry-intake.service");
  const integrations = await import("./integrations.service");
  const registry = await import("./integration-registry.service");
  const { smPublicEnvelopeSchema } = await import("./integration-registry");
  const engine = await import("@/modules/sales-marketing/workflows/sm-workflow-engine");
  const delivery = await import("@/modules/crm/webhooks-out/webhook-delivery");
  const crmSubs = await import("@/modules/crm/webhooks-out/crm-webhook-subscriptions.service");
  const crmKeys = await import("@/modules/crm/capture/crm-api-keys.service");
  const enquiries = await import("@/modules/sales-marketing/enquiries/sales-enquiry.service");
  const lookups = await import("@/modules/sales-marketing/campaigns/campaign-lookup.service");
  const routes = {
    campaigns: await import("@/app/api/v1/integrations/sales-marketing/campaigns/route"),
    campaign: await import("@/app/api/v1/integrations/sales-marketing/campaigns/[id]/route"),
    enquiries: await import("@/app/api/v1/integrations/sales-marketing/enquiries/route"),
    enquiryStatus: await import("@/app/api/v1/integrations/sales-marketing/enquiries/[system]/[externalId]/route"),
    segments: await import("@/app/api/v1/integrations/sales-marketing/segments/route"),
  };

  const run = `i${Date.now().toString(36)}`;
  let admin: Actor, rep: Actor, outsider: Actor;
  let campaignId = "", otherCampaignId = "";
  const today = new Date().toISOString().slice(0, 10);

  // ── local receiver ──
  const received: { headers: http.IncomingHttpHeaders; body: string }[] = [];
  let answer = 204;
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      received.push({ headers: req.headers, body });
      res.statusCode = answer;
      res.end(answer >= 400 ? "receiver internal detail" : "");
    });
  });
  let base = "";

  const call = async <P,>(handler: (req: InstanceType<typeof NextRequest>, ctx: { params: Promise<P> }) => Promise<Response>, path: string, opts: { key?: string | null; method?: string; body?: unknown; params?: P; headers?: Record<string, string> } = {}) => {
    const headers: Record<string, string> = { "content-type": "application/json", ...(opts.headers ?? {}) };
    if (opts.key) headers.authorization = `Bearer ${opts.key}`;
    const req = new NextRequest(`http://erp.test/api/v1/integrations/sales-marketing${path}`, { method: opts.method ?? "GET", headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
    const res = await handler(req, { params: Promise.resolve((opts.params ?? {}) as P) });
    return { status: res.status, headers: res.headers, body: (res.headers.get("content-type") ?? "").includes("json") ? await res.json() : null };
  };
  const newKey = async (scopes: string[], extra: Record<string, unknown> = {}, actor = admin) => keys.createSmApiKey(actor, { name: `Key ${scopes.join(",")} ${Math.random().toString(36).slice(2, 6)}`, scopes, ...extra });

  beforeAll(async () => {
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const company = await prisma.company.create({ data: { name: `Integrations Co ${run}`, baseCurrencyCode: "INR" } });
    const mk = (n: string, companyId = company.id) => prisma.user.create({ data: { companyId, email: `${n}.${run}@int-it.local`, passwordHash: "x", fullName: `${n} ${run}` } });
    const [a, r] = await Promise.all([mk("admin"), mk("rep")]);
    admin = { companyId: company.id, userId: a.id, branchId: null };
    rep = { companyId: company.id, userId: r.id, branchId: null };
    const other = await prisma.company.create({ data: { name: `Other ${run}`, baseCurrencyCode: "INR" } });
    outsider = { companyId: other.id, userId: (await mk("outsider", other.id)).id, branchId: null };
    for (const c of [company.id, other.id]) await lookups.ensureCampaignLookups(c);
    const mkCampaign = async (companyId: string, owner: string, code: string) => {
      const all = await prisma.marketingCampaignLookup.findMany({ where: { companyId } });
      return prisma.marketingCampaign.create({
        data: { companyId, code: `${code}-${run}`.toUpperCase(), name: `${code} ${run}`, typeId: all.find((l) => l.kind === "TYPE")!.id, objectiveId: all.find((l) => l.kind === "OBJECTIVE")!.id, ownerUserId: owner, status: "ACTIVE", approvedRevisionNumber: 1, actualStartDate: new Date(`${today}T00:00:00Z`), plannedStartDate: new Date(`${today}T00:00:00Z`), plannedEndDate: new Date(`${today}T00:00:00Z`), plannedBudget: 5000, currencyCode: "INR", createdByUserId: owner, updatedByUserId: owner },
      });
    };
    campaignId = (await mkCampaign(company.id, a.id, "API")).id;
    otherCampaignId = (await mkCampaign(other.id, outsider.userId, "OTHER")).id;
  });

  afterAll(async () => {
    await prisma.crmWebhookSubscription.updateMany({ where: { companyId: admin.companyId }, data: { isActive: false } });
    await new Promise<void>((r) => server.close(() => r()));
    await prisma.$disconnect();
  });

  it("API keys: full key returned once, hashed at rest, least privilege, not shown in CRM; registry row", async () => {
    const k = await newKey(["sm.campaigns:read"]);
    expect(k.keyOnce).toMatch(/^crmk_[0-9a-f]{12}_/);
    const row = await prisma.crmApiKey.findUniqueOrThrow({ where: { id: k.id } });
    expect(row.keyHash).not.toContain(k.keyOnce);
    expect(row.purpose).toBe("SALES_MARKETING_API");
    expect(JSON.stringify(await keys.listSmApiKeys(admin))).not.toContain(k.keyOnce);
    const audit = await prisma.auditLog.findMany({ where: { recordId: k.id } });
    expect(JSON.stringify(audit)).not.toContain(k.keyOnce);
    // Not a CRM capture key: not listed there, and refused by the lead-ingest auth.
    expect((await crmKeys.listApiKeys(admin)).some((x) => x.id === k.id)).toBe(false);
    expect(await crmKeys.authenticateApiKey(k.keyOnce)).toBeNull();
    // Least privilege: nobody grants a scope whose permission they lack.
    denied.add(`${rep.userId}:marketing_attribution.view`);
    await expect(keys.createSmApiKey(rep, { name: "x", scopes: ["sm.performance:read"] })).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    denied.delete(`${rep.userId}:marketing_attribution.view`);
    const reg = await prisma.integration.findFirstOrThrow({ where: { companyId: admin.companyId, resourceId: k.id } });
    expect(reg).toMatchObject({ kind: "API_CLIENT", status: "PENDING_VERIFICATION" });
  });

  it("API auth: 401 without / with a bad key, 403 without the scope or the run-as permission, tenant isolation, usage counted", async () => {
    const k = await newKey(["sm.campaigns:read"]);
    expect((await call(routes.campaigns.GET, "/campaigns")).status).toBe(401);
    expect((await call(routes.campaigns.GET, "/campaigns", { key: "crmk_000000000000_wrongwrongwrongwrongwrongwrongwr" })).status).toBe(401);
    expect((await call(routes.campaigns.GET, "/campaigns", { key: k.keyOnce.slice(0, -1) + (k.keyOnce.endsWith("a") ? "b" : "a") })).status).toBe(401);
    const ok = await call(routes.campaigns.GET, "/campaigns", { key: k.keyOnce });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("x-request-id")).toBeTruthy();
    expect(ok.body.data.map((c: { id: string }) => c.id)).toContain(campaignId);
    expect(ok.body.data.map((c: { id: string }) => c.id)).not.toContain(otherCampaignId);
    expect(Object.keys(ok.body.data[0]).sort()).not.toContain("owner"); // minimal DTO
    // Another company's campaign by id: not found.
    expect((await call(routes.campaign.GET, `/campaigns/${otherCampaignId}`, { key: k.keyOnce, params: { id: otherCampaignId } })).status).toBe(404);
    expect((await call(routes.campaign.GET, `/campaigns/${campaignId}`, { key: k.keyOnce, params: { id: campaignId } })).body.data.code).toMatch(/^API-/);
    // Scope missing.
    const seg = await call(routes.segments.GET, "/segments", { key: k.keyOnce });
    expect(seg.status).toBe(403);
    expect(seg.body.error.code).toBe("PERMISSION_DENIED");
    // The run-as user loses the permission → refused on the next call.
    denied.add(`${admin.userId}:marketing_campaigns.view`);
    expect((await call(routes.campaigns.GET, "/campaigns", { key: k.keyOnce })).status).toBe(403);
    denied.delete(`${admin.userId}:marketing_campaigns.view`);
    const usage = await prisma.integrationApiUsage.findMany({ where: { apiKeyId: k.id } });
    expect(usage.reduce((a, u) => a + u.requests, 0)).toBeGreaterThanOrEqual(5);
    expect(usage.reduce((a, u) => a + u.denied, 0)).toBeGreaterThanOrEqual(2);
    await registry.refreshRegistry(admin.companyId, { kind: "API_CLIENT", resourceId: k.id });
    expect((await prisma.integration.findFirstOrThrow({ where: { resourceId: k.id } })).status).toBe("CONNECTED");
  });

  it("rate limit per key: 429 with Retry-After; rotation (no grace) and revocation stop the old key; disabling refuses calls", async () => {
    const k = await newKey(["sm.campaigns:read"], { rateLimitPerMinute: 3 });
    for (let i = 0; i < 3; i++) expect((await call(routes.campaigns.GET, "/campaigns", { key: k.keyOnce })).status).toBe(200);
    const limited = await call(routes.campaigns.GET, "/campaigns", { key: k.keyOnce });
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);

    const k2 = await newKey(["sm.campaigns:read"]);
    const rotated = await keys.rotateSmApiKey(admin, k2.id, { graceHours: 0 });
    expect(rotated.keyOnce).not.toBe(k2.keyOnce);
    expect((await call(routes.campaigns.GET, "/campaigns", { key: k2.keyOnce })).status).toBe(401);
    expect((await call(routes.campaigns.GET, "/campaigns", { key: rotated.keyOnce })).status).toBe(200);

    const reg = await prisma.integration.findFirstOrThrow({ where: { resourceId: rotated.id } });
    await integrations.integrationAction(admin, reg.id, { action: "disable", reason: "maintenance" });
    expect((await call(routes.campaigns.GET, "/campaigns", { key: rotated.keyOnce })).status).toBe(401);
    await integrations.integrationAction(admin, reg.id, { action: "enable" });
    expect((await call(routes.campaigns.GET, "/campaigns", { key: rotated.keyOnce })).status).toBe(200);

    await expect(keys.revokeSmApiKey(admin, rotated.id, { reason: "x" })).rejects.toBeTruthy(); // reason too short
    denied.add(`${rep.userId}:sales_integrations.approve`);
    await expect(keys.revokeSmApiKey(rep, rotated.id, { reason: "leaked" })).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await keys.revokeSmApiKey(admin, rotated.id, { reason: "leaked" });
    expect((await call(routes.campaigns.GET, "/campaigns", { key: rotated.keyOnce })).status).toBe(401);
    expect((await prisma.integration.findFirstOrThrow({ where: { resourceId: rotated.id } })).status).toBe("REVOKED");
    await expect(integrations.integrationAction(admin, reg.id, { action: "enable" })).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  });

  it("enquiry intake: created once per external id, idempotent replay, updates, stale ignored, conflicts never overwrite", async () => {
    const k = await newKey(["sm.enquiries:write", "sm.enquiries:read"]);
    const ext = `web-${run}`;
    const at0 = Date.now() - 6 * 3_600_000;
    const T = (h: number) => new Date(at0 + h * 3_600_000).toISOString();
    const body = (over: Record<string, unknown> = {}, at = T(1)) => ({ system: "website", externalId: ext, sourceUpdatedAt: at, enquiry: { subject: "Polo shirts", remarks: "First contact", prospect: { name: `Prospect ${run}`, email: "buyer@example.com" }, lines: [{ styleName: "Polo", quantity: 500 }], ...over } });

    const first = await call(routes.enquiries.POST, "/enquiries", { key: k.keyOnce, method: "POST", body: body(), headers: { "idempotency-key": `idem-${run}-1` } });
    expect(first.body).toMatchObject({ data: { result: "CREATED" } });
    expect(first.status).toBe(201);
    expect(first.body.data.result).toBe("CREATED");
    const enquiryId = first.body.data.enquiryId as string;
    const replay = await call(routes.enquiries.POST, "/enquiries", { key: k.keyOnce, method: "POST", body: body(), headers: { "idempotency-key": `idem-${run}-1` } });
    expect(replay.headers.get("idempotent-replayed")).toBe("true");
    expect(replay.body.data.enquiryId).toBe(enquiryId);
    expect((await call(routes.enquiries.POST, "/enquiries", { key: k.keyOnce, method: "POST", body: body({ subject: "Different" }), headers: { "idempotency-key": `idem-${run}-1` } })).status).toBe(400);
    // Same data again without a key: still one enquiry.
    expect((await call(routes.enquiries.POST, "/enquiries", { key: k.keyOnce, method: "POST", body: body() })).body.data.result).toBe("UNCHANGED");
    const refs = await prisma.integrationExternalRef.findMany({ where: { companyId: admin.companyId, externalId: ext } });
    expect(refs).toHaveLength(1);
    expect(refs[0].entityId).toBe(enquiryId);

    // External changes an intake field nobody touched in the ERP: applied through the enquiry service.
    const upd = await call(routes.enquiries.POST, "/enquiries", { key: k.keyOnce, method: "POST", body: body({ subject: "Polo shirts — 600 pcs" }, T(2)) });
    expect(upd.body.data).toMatchObject({ result: "UPDATED", applied: ["subject"] });
    expect((await prisma.buyerEnquiry.findUniqueOrThrow({ where: { id: enquiryId } })).subject).toBe("Polo shirts — 600 pcs");
    // Late / replayed older event: ignored.
    expect((await call(routes.enquiries.POST, "/enquiries", { key: k.keyOnce, method: "POST", body: body({ subject: "Old" }, T(0)) })).body.data.result).toBe("STALE_IGNORED");
    expect((await prisma.buyerEnquiry.findUniqueOrThrow({ where: { id: enquiryId } })).subject).toBe("Polo shirts — 600 pcs");

    // A person edits remarks in the ERP; a later external remarks change becomes a conflict.
    await enquiries.updateSalesEnquiryDetails(admin, enquiryId, { remarks: "Called, wants samples" });
    const c1 = await call(routes.enquiries.POST, "/enquiries", { key: k.keyOnce, method: "POST", body: body({ subject: "Polo shirts — 600 pcs", remarks: "Updated on website", prospect: { name: `Prospect ${run}`, email: "new@example.com" } }, T(3)) });
    expect(c1.body.data.result).toBe("UNCHANGED");
    expect(c1.body.data.conflicts.map((c: { field: string; reason: string }) => `${c.field}:${c.reason}`).sort()).toEqual(["prospectEmail:NOT_UPDATABLE", "remarks:ERP_CHANGED"]);
    const e1 = await prisma.buyerEnquiry.findUniqueOrThrow({ where: { id: enquiryId } });
    expect(e1.remarks).toBe("Called, wants samples");
    expect(e1.prospectEmail).toBe("buyer@example.com");

    // Past intake: every external change is a conflict.
    await prisma.buyerEnquiry.update({ where: { id: enquiryId }, data: { salesStage: "QUALIFIED" } });
    const c2 = await call(routes.enquiries.POST, "/enquiries", { key: k.keyOnce, method: "POST", body: body({ subject: "Changed after qualification", remarks: "Updated on website", prospect: { name: `Prospect ${run}`, email: "new@example.com" } }, T(4)) });
    expect(c2.body.data.conflicts.map((c: { field: string; reason: string }) => `${c.field}:${c.reason}`)).toEqual(["subject:RECORD_ADVANCED"]);
    expect((await prisma.buyerEnquiry.findUniqueOrThrow({ where: { id: enquiryId } })).subject).toBe("Polo shirts — 600 pcs");

    const status = await call(routes.enquiryStatus.GET, `/enquiries/website/${ext}`, { key: k.keyOnce, params: { system: "website", externalId: ext } });
    expect(status.body.data.openConflicts).toHaveLength(3);

    // Resolution by a person: apply the external subject (through the service), keep the ERP remarks; email can't be applied.
    const open = (await intake.listConflicts(admin, { status: "OPEN", skip: 0, take: 10 })).rows;
    await prisma.buyerEnquiry.update({ where: { id: enquiryId }, data: { salesStage: "UNDER_REVIEW" } });
    await intake.resolveConflict(admin, open.find((c) => c.field === "subject")!.id, { action: "apply_external", note: "Customer confirmed" });
    expect((await prisma.buyerEnquiry.findUniqueOrThrow({ where: { id: enquiryId } })).subject).toBe("Changed after qualification");
    await intake.resolveConflict(admin, open.find((c) => c.field === "remarks")!.id, { action: "keep_erp" });
    await expect(intake.resolveConflict(admin, open.find((c) => c.field === "prospectEmail")!.id, { action: "apply_external" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(intake.resolveConflict(admin, open.find((c) => c.field === "remarks")!.id, { action: "dismiss" })).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
    await expect(intake.resolveConflict(outsider, open.find((c) => c.field === "prospectEmail")!.id, { action: "dismiss" })).rejects.toMatchObject({ code: "NOT_FOUND" });

    const cp = await prisma.integrationSyncCheckpoint.findFirstOrThrow({ where: { companyId: admin.companyId, stream: "enquiries:website" } });
    expect(cp).toMatchObject({ created: 1, updated: 1, staleIgnored: 1 });
    expect(cp.conflicts).toBeGreaterThanOrEqual(2);
  });

  it("enquiry intake: concurrent submissions of one external id create one enquiry; other company can't read it", async () => {
    const k = await newKey(["sm.enquiries:write", "sm.enquiries:read"]);
    const ext = `race-${run}`;
    const b = { system: "marketplace", externalId: ext, enquiry: { prospect: { name: `Race ${run}` }, lines: [{ styleName: "Tee", quantity: 10 }] } };
    const results = await Promise.all([1, 2, 3, 4].map(() => call(routes.enquiries.POST, "/enquiries", { key: k.keyOnce, method: "POST", body: b })));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.every((r) => [200, 201, 409].includes(r.status))).toBe(true);
    expect(await prisma.buyerEnquiry.count({ where: { companyId: admin.companyId, prospectName: `Race ${run}` } })).toBe(1);
    const otherKey = await newKey(["sm.enquiries:read"], {}, outsider);
    expect((await call(routes.enquiryStatus.GET, `/enquiries/marketplace/${ext}`, { key: otherKey.keyOnce, params: { system: "marketplace", externalId: ext } })).status).toBe(404);
  });

  it("outgoing S&M webhooks: SSRF refused, signed minimal envelope from the outbox, once per event, retries, replay needs approve; CRM unaffected", async () => {
    for (const url of ["https://169.254.169.254/latest/meta-data", "https://10.0.0.5/hook", "https://localhost/hook", "http://example.com/hook", "https://user:pw@example.com/hook"]) {
      await expect(hooks.createSmSubscription(admin, { name: `Bad ${url}`, url, eventTypes: ["sm.budget.alert_raised"] })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    }
    await expect(hooks.createSmSubscription(admin, { name: "CRM type", url: `${base}/hook`, eventTypes: ["lead.created"] })).rejects.toBeTruthy();
    const sub = await hooks.createSmSubscription(admin, { name: `Budget ${run}`, url: `${base}/hook`, eventTypes: ["sm.budget.alert_raised"] });
    expect(sub.secretOnce).toMatch(/^whsec_/);
    expect(JSON.stringify(await hooks.listSmSubscriptions(admin))).not.toContain(sub.secretOnce);
    expect((await crmSubs.listSubscriptions(admin)).some((s) => s.id === sub.id)).toBe(false);
    await expect(hooks.getSmSubscription(outsider, sub.id)).rejects.toMatchObject({ code: "NOT_FOUND" });

    // A real committed transition: a budget alert → Phase 15 reader → public outbox → delivery.
    const alert = await prisma.marketingBudgetAlert.create({ data: { companyId: admin.companyId, campaignId, scopeKey: "TOTAL", kind: "OVER_BUDGET", message: "Over budget by ₹1,200 — internal note" } });
    await engine.dispatchEvents(new Date());
    const pub = await prisma.integrationEvent.findFirstOrThrow({ where: { companyId: admin.companyId, entityId: alert.id } });
    expect(pub).toMatchObject({ eventType: "sm.budget.alert_raised", eventVersion: 1 });
    received.length = 0;
    await delivery.tickWebhooks(new Date());
    const got = received.filter((r) => r.headers["x-erp-delivery-id"]);
    expect(got).toHaveLength(1);
    const { headers, body } = got[0];
    const sig = String(headers["x-crm-signature"]);
    const [t, v1] = sig.split(",").map((p) => p.split("=")[1]);
    expect(createHmac("sha256", sub.secretOnce).update(`${t}.${body}`).digest("hex")).toBe(v1);
    expect(headers["x-erp-event-type"]).toBe("sm.budget.alert_raised");
    expect(headers["idempotency-key"]).toBe(headers["x-erp-delivery-id"]);
    const env = smPublicEnvelopeSchema.parse(JSON.parse(body));
    expect(env.data.payload).toEqual({ kind: "OVER_BUDGET", campaignId });
    expect(body).not.toContain("internal note");

    // Re-reading the same events publishes and delivers nothing new.
    await prisma.smWorkflowCheckpoint.deleteMany({ where: { source: "budget" } });
    await engine.dispatchEvents(new Date());
    expect(await prisma.integrationEvent.count({ where: { entityId: alert.id } })).toBe(1);
    received.length = 0;
    await delivery.tickWebhooks(new Date());
    expect(received.filter((r) => r.headers["x-erp-delivery-id"])).toHaveLength(0);

    // Receiver failing: retried later with the same Idempotency-Key, receiver body never stored.
    answer = 503;
    const alert2 = await prisma.marketingBudgetAlert.create({ data: { companyId: admin.companyId, campaignId, scopeKey: "MEDIA", kind: "OVER_BUDGET", message: "x" } });
    await engine.dispatchEvents(new Date());
    await delivery.tickWebhooks(new Date());
    const pub2 = await prisma.integrationEvent.findFirstOrThrow({ where: { entityId: alert2.id } });
    const d = await prisma.crmWebhookDelivery.findFirstOrThrow({ where: { subscriptionId: sub.id, eventId: pub2.id } });
    expect(d).toMatchObject({ status: "RETRYING", errorCode: "HTTP_503" });
    expect(JSON.stringify(d)).not.toContain("receiver internal detail");
    answer = 204;
    await delivery.tickWebhooks(new Date(d.nextAttemptAt.getTime() + 1000));
    expect((await prisma.crmWebhookDelivery.findUniqueOrThrow({ where: { id: d.id } })).status).toBe("SUCCEEDED");

    // Replay is an approve-level action.
    denied.add(`${rep.userId}:sales_integrations.approve`);
    await expect(hooks.redeliverSm(rep, sub.id, d.id)).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    expect(await hooks.redeliverSm(admin, sub.id, d.id)).toEqual({ queued: true });

    // Registry: subscription connected; test event marked as test.
    const t2 = await hooks.testSmSubscription(admin, sub.id, {});
    expect(t2.status).toBe("SUCCEEDED");
    const last = received.at(-1)!;
    expect(JSON.parse(last.body)).toMatchObject({ test: true, version: 1 });
    await registry.refreshRegistry(admin.companyId);
    expect((await prisma.integration.findFirstOrThrow({ where: { resourceId: sub.id } })).status).toBe("CONNECTED");
  });

  it("workflow transitions publish once; registry lists providers as not live-verified; metrics; tenant isolation of the registry", async () => {
    const pubs = await import("./public-events");
    const inst = { id: crypto.randomUUID(), companyId: admin.companyId, workflowKey: "quotation_to_order", entityType: "QUOTATION", entityId: crypto.randomUUID(), correlationId: "smwf:test" };
    await pubs.publishWorkflowEvent(inst, "completed", { outcome: "CONVERTED" }, new Date());
    await pubs.publishWorkflowEvent(inst, "completed", { outcome: "CONVERTED" }, new Date());
    expect(await prisma.integrationEvent.count({ where: { entityId: inst.id } })).toBe(1);

    await prisma.marketingChannelConnection.create({ data: { companyId: admin.companyId, code: `BREVO-${run}`, name: `Brevo ${run}`, channelType: "EMAIL", providerKey: "BREVO", webhookToken: `t${run}${"0".repeat(40)}`.slice(0, 48), createdByUserId: admin.userId } });
    const list = await integrations.listIntegrations(admin);
    const prov = list.find((x) => x.kind === "DELIVERY_PROVIDER" && x.name === `Brevo ${run}`)!;
    expect(prov).toMatchObject({ status: "CONFIGURED", liveVerified: false });
    expect(JSON.stringify(list)).not.toMatch(/crmk_[0-9a-f]{12}_[A-Za-z0-9_-]{32}|whsec_[A-Za-z0-9_-]{20}/);
    await expect(integrations.getIntegration(outsider, prov.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const detail = await integrations.getIntegration(admin, prov.id);
    expect(detail.detail).toMatchObject({ notLiveVerified: true });
    const m = await integrations.integrationMetrics(admin);
    expect(m.api.requests).toBeGreaterThan(0);
    expect(m.webhooks.delivered).toBeGreaterThanOrEqual(1);
    expect(m.sync.openConflicts).toBeGreaterThanOrEqual(1);
    const otherList = await integrations.listIntegrations(outsider);
    expect(otherList.some((x) => x.id === prov.id)).toBe(false);
  });
});
