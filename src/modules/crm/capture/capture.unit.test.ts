import { describe, expect, it, vi } from "vitest";

vi.mock("@/core/db/client", () => ({ prisma: {} }));
vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("../imports/crm-import.queue", () => ({ enqueueCrmIngestJob: vi.fn() }));

const { mapApiBody } = await import("./api-ingest");
const { generateApiKey } = await import("./crm-api-keys.service");
const { redactPayload } = await import("./crm-ingest-events.service");
const { assertCaptureRateLimit } = await import("./capture-rate-limit");
const { genericWebhookAdapter, getPath, signGenericWebhook } = await import("./providers/generic-webhook.adapter");
const { getLeadProviderAdapter } = await import("./providers/registry");

const h = (o: Record<string, string>) => new Headers(o);

describe("generic webhook adapter", () => {
  const secret = "whsec_test";
  const body = JSON.stringify({ name: "A", email: "a@b.co" });
  const now = new Date("2026-10-02T10:00:00Z");
  const ts = Math.floor(now.getTime() / 1000);

  it("accepts a correct signature and rejects wrong, missing or stale ones", () => {
    const ok = genericWebhookAdapter.verifySignature({ headers: h({ "x-crm-timestamp": String(ts), "x-crm-signature": signGenericWebhook(secret, ts, body) }), rawBody: body, secret, now });
    expect(ok).toEqual({ ok: true });
    expect(genericWebhookAdapter.verifySignature({ headers: h({ "x-crm-timestamp": String(ts), "x-crm-signature": signGenericWebhook("other", ts, body) }), rawBody: body, secret, now }).ok).toBe(false);
    expect(genericWebhookAdapter.verifySignature({ headers: h({ "x-crm-timestamp": String(ts), "x-crm-signature": signGenericWebhook(secret, ts, body) }), rawBody: body + " ", secret, now }).ok).toBe(false);
    expect(genericWebhookAdapter.verifySignature({ headers: h({}), rawBody: body, secret, now }).ok).toBe(false);
    const old = ts - 600;
    expect(genericWebhookAdapter.verifySignature({ headers: h({ "x-crm-timestamp": String(old), "x-crm-signature": signGenericWebhook(secret, old, body) }), rawBody: body, secret, now })).toEqual({ ok: false, reason: expect.stringMatching(/too old/) });
  });

  it("maps payloads automatically or with a configured mapping, single or batched", () => {
    const [auto] = genericWebhookAdapter.parse({ headers: h({ "x-crm-event-id": "e1" }), rawBody: JSON.stringify({ id: "L1", full_name: "Asha", contact: { email: "a@b.co", phone_number: "98765" }, customFields: { qty: 5 }, extra: 1 }), fieldMapping: {} });
    expect(auto).toMatchObject({ externalLeadId: "L1", externalEventId: "e1", mapped: { fullName: "Asha", email: "a@b.co", phone: "98765", "cf:qty": 5 }, unmappedKeys: ["extra"] });

    const batch = genericWebhookAdapter.parse({ headers: h({ "x-crm-event-id": "batch" }), rawBody: JSON.stringify({ leads: [{ who: { n: "A" } }, { who: { n: "B" } }] }), fieldMapping: { fullName: "who.n" } });
    expect(batch.map((r) => [r.mapped.fullName, r.externalEventId])).toEqual([
      ["A", "batch:0"],
      ["B", "batch:1"],
    ]);
    expect(() => genericWebhookAdapter.parse({ headers: h({}), rawBody: "not json", fieldMapping: {} })).toThrow(/JSON/);
    expect(() => genericWebhookAdapter.parse({ headers: h({}), rawBody: JSON.stringify({ leads: Array.from({ length: 51 }, () => ({})) }), fieldMapping: {} })).toThrow(/50/);
    expect(getPath({ a: [{ b: 1 }] }, "a.0.b")).toBe(1);
  });

  it("only registered providers resolve", () => {
    expect(getLeadProviderAdapter("generic")).toBe(genericWebhookAdapter);
    expect(getLeadProviderAdapter("facebook")).toBeNull();
    expect(getLeadProviderAdapter("__proto__")).toBeNull();
  });
});

describe("API ingestion body", () => {
  it("accepts flat or nested fields, exact keys and aliases, and reports unknown keys", () => {
    expect(mapApiBody({ name: "Asha", mobile_no: "98765", "Email ID": "a@b.co", requirement: "Tees", favourite: "x", customFields: { qty: 3 }, externalLeadId: "W1" })).toMatchObject({
      mapped: { fullName: "Asha", mobile: "98765", email: "a@b.co", requirement: "Tees", "cf:qty": 3 },
      unmappedFields: ["favourite"],
      externalLeadId: "W1",
      channel: "API",
    });
    expect(mapApiBody({ lead: { firstName: "B", email: "b@c.co" }, channel: "WEBSITE_FORM" })).toMatchObject({ mapped: { firstName: "B", email: "b@c.co" }, channel: "WEBSITE_FORM" });
  });
});

describe("capture security helpers", () => {
  it("generates distinct, well-formed API keys", () => {
    const a = generateApiKey();
    const b = generateApiKey();
    expect(a.key).toMatch(/^crmk_[0-9a-f]{12}_[A-Za-z0-9_-]{32}$/);
    expect(a.key.startsWith(`crmk_${a.prefix}_`)).toBe(true);
    expect(a.key).not.toBe(b.key);
  });

  it("redacts secrets from stored payloads", () => {
    expect(redactPayload({ email: "a@b.co", password: "x", nested: { apiKey: "k", Authorization: "Bearer t" }, list: [{ token: "t" }] })).toEqual({
      email: "a@b.co",
      password: "[redacted]",
      nested: { apiKey: "[redacted]", Authorization: "[redacted]" },
      list: [{ token: "[redacted]" }],
    });
  });

  it("rate-limits per bucket per minute", () => {
    const t = 1_000_000;
    for (let i = 0; i < 3; i++) assertCaptureRateLimit("bucket-a", 3, t + i);
    expect(() => assertCaptureRateLimit("bucket-a", 3, t + 10)).toThrow(/Too many requests/);
    expect(() => assertCaptureRateLimit("bucket-b", 3, t + 10)).not.toThrow();
    expect(() => assertCaptureRateLimit("bucket-a", 3, t + 61_000)).not.toThrow();
  });
});
