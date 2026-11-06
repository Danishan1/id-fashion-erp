import { createHmac } from "crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/core/db/client", () => ({ prisma: {} }));

const { backoffMs } = await import("./delivery-engine");
const { hintsFor, maskSecret, pickConfig, pickSecrets, signUnsubscribeToken, verifyUnsubscribeToken, encryptSecrets, decryptSecrets } = await import("./delivery-common");
const { DELIVERY_RANK, canRunMove, connectionCreateSchema, MARKETING_PROVIDERS, MARKETING_PROVIDER_KEYS } = await import("./delivery-registry");
const { classifyHttp, normalizeEmail, normalizePhone, request, retryAfterMs, safeEqual } = await import("./providers/http");
const { classifySmtpError, smtpAdapter } = await import("./providers/smtp");
const { brevoAdapter } = await import("./providers/brevo");
const { msg91Adapter } = await import("./providers/msg91");
const { whatsappCloudAdapter } = await import("./providers/whatsapp-cloud");
const { getProviderAdapter } = await import("./providers");
const { markDuplicateAddresses } = await import("./audience-eligibility");
const { withUnsubscribeFooter } = await import("./delivery-render");

beforeAll(() => {
  process.env.AUTH_SECRET ||= "unit-test-secret-unit-test-secret-1234";
});

const DELIVERY = "2d8f4c1e-6a2b-4c7d-9e1f-0a1b2c3d4e5f";
const msg = (over: Partial<Parameters<typeof brevoAdapter.send>[1]> = {}) => ({
  deliveryId: DELIVERY,
  to: "asha@example.com",
  toName: "Asha",
  subject: "Hello",
  body: "Body",
  parameters: [],
  providerMetadata: {},
  unsubscribeUrl: "https://erp.example.com/api/v1/public/marketing/unsubscribe/x",
  tag: "CMP-1",
  ...over,
});
const conn = (config: Record<string, string | number>, secrets: Record<string, string>) => ({ id: "c1", companyId: "co1", config, secrets });
const fakeFetch = (status: number, body: unknown, headers: Record<string, string> = {}) => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers });
  }) as unknown as typeof fetch;
  return { fn, calls };
};
const deps = (f: typeof fetch) => ({ fetch: f, now: () => new Date() });
const hook = (rawBody: string, headers: Record<string, string> = {}, method: "GET" | "POST" = "POST", query = "") => ({ method, headers: new Headers(headers), rawBody, query: new URLSearchParams(query) });

describe("registry rules", () => {
  it("every provider is not live-verified and has an adapter", () => {
    for (const k of MARKETING_PROVIDER_KEYS) {
      expect(MARKETING_PROVIDERS[k].liveVerified).toBe(false);
      expect(getProviderAdapter(k).key).toBe(k);
    }
  });
  it("delivery status only moves forward by rank", () => {
    expect(DELIVERY_RANK.DELIVERED).toBeGreaterThan(DELIVERY_RANK.ACCEPTED);
    expect(DELIVERY_RANK.UNKNOWN).toBeLessThan(DELIVERY_RANK.ACCEPTED);
    expect(DELIVERY_RANK.BOUNCED).toBe(DELIVERY_RANK.DELIVERED);
  });
  it("run transitions", () => {
    expect(canRunMove("PREPARING", "QUEUED")).toBe(true);
    expect(canRunMove("COMPLETED", "RUNNING")).toBe(false);
    expect(canRunMove("CANCELLED", "QUEUED")).toBe(false);
  });
  it("connection schema rejects unknown keys", () => {
    expect(connectionCreateSchema.safeParse({ code: "EMAIL-1", name: "x", providerKey: "SMTP", extra: 1 }).success).toBe(false);
  });
  it("retry backoff grows and is capped", () => {
    const mid = () => 0.5;
    expect(backoffMs(1, mid)).toBe(60_000);
    expect(backoffMs(3, mid)).toBe(240_000);
    expect(backoffMs(20, mid)).toBe(30 * 60_000);
  });
});

describe("secrets and tokens", () => {
  it("masks secrets to the last 4 characters at most", () => {
    expect(maskSecret("short")).toBe("••••");
    expect(maskSecret("abcdefghijkl1234")).toBe("••••1234");
    expect(hintsFor({ apiKey: "xkeysib-0123456789abcd", empty: "" })).toEqual({ apiKey: "••••abcd" });
  });
  it("encrypts secrets and never stores empty values", () => {
    expect(encryptSecrets({ a: "" })).toBeNull();
    const c = encryptSecrets({ apiKey: "secret-value-123" })!;
    expect(c).not.toContain("secret-value-123");
    expect(decryptSecrets(c)).toEqual({ apiKey: "secret-value-123" });
  });
  it("only accepts declared config and secret keys", () => {
    expect(() => pickSecrets("BREVO", { apiKey: "k", other: "x" })).toThrow(/Unknown credential/);
    expect(() => pickConfig("SMTP", { host: "h", evil: "x" })).toThrow(/Unknown setting/);
    expect(pickConfig("SMTP", { host: " smtp.x.com ", replyTo: "" })).toEqual({ host: "smtp.x.com" });
  });
  it("unsubscribe tokens round-trip and resist tampering", () => {
    const t = signUnsubscribeToken(DELIVERY);
    expect(verifyUnsubscribeToken(t)).toBe(DELIVERY);
    const [id, mac] = t.split(".");
    expect(verifyUnsubscribeToken(`${id}.${mac.slice(0, -1)}${mac.endsWith("A") ? "B" : "A"}`)).toBeNull();
    expect(verifyUnsubscribeToken(`${"0".repeat(32)}.${mac}`)).toBeNull();
    expect(verifyUnsubscribeToken("garbage")).toBeNull();
  });
  it("constant-time compare", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "ab")).toBe(false);
  });
});

describe("addresses", () => {
  it("normalises email", () => {
    expect(normalizeEmail(" Asha@Example.COM ")).toBe("asha@example.com");
    expect(normalizeEmail("not-an-email")).toBeNull();
  });
  it("needs a country code unless the number has +", () => {
    expect(normalizePhone("+91 98765-43210", undefined)).toBe("919876543210");
    expect(normalizePhone("098765 43210", "91")).toBe("919876543210");
    expect(normalizePhone("9876543210", undefined)).toBeNull();
    expect(normalizePhone("12", "91")).toBeNull();
  });
  it("one message per address in a run", () => {
    const rows = markDuplicateAddresses([
      { contactId: "a", name: null, destination: "x@y.com", ok: true, reason: null },
      { contactId: "b", name: null, destination: "x@y.com", ok: true, reason: null },
      { contactId: "c", name: null, destination: null, ok: false, reason: "NO_ADDRESS" },
    ]);
    expect(rows.map((r) => r.reason)).toEqual([null, "DUPLICATE_ADDRESS", "NO_ADDRESS"]);
  });
  it("adds the unsubscribe footer", () => {
    expect(withUnsubscribeFooter("Hi  \n", "https://u")).toMatch(/^Hi\n\n--\n[^\n]+\nhttps:\/\/u\n$/);
  });
});

describe("HTTP classification", () => {
  it("maps statuses", () => {
    const h = new Headers();
    expect(classifyHttp(401, h, "", "").kind).toBe("CONNECTION");
    expect(classifyHttp(429, new Headers({ "retry-after": "30" }), "", "")).toMatchObject({ kind: "THROTTLED", retryAfterMs: 30_000 });
    expect(classifyHttp(503, h, "", "").kind).toBe("RETRYABLE");
    expect(classifyHttp(500, h, "", "").kind).toBe("UNKNOWN");
    expect(classifyHttp(400, h, "bad_request", "nope")).toMatchObject({ kind: "PERMANENT", code: "bad_request" });
  });
  it("bounds Retry-After", () => {
    expect(retryAfterMs(new Headers({ "retry-after": "999999" }))).toBe(3_600_000);
    expect(retryAfterMs(new Headers())).toBe(60_000);
  });
  it("a timeout is UNKNOWN, a refused connection is RETRYABLE", async () => {
    const abort = (async () => {
      throw Object.assign(new Error("aborted"), { name: "AbortError" });
    }) as unknown as typeof fetch;
    const refused = (async () => {
      throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
    }) as unknown as typeof fetch;
    const a = await request(abort, "https://x", {});
    const r = await request(refused, "https://x", {});
    expect(a.ok === false && a.outcome.kind).toBe("UNKNOWN");
    expect(r.ok === false && r.outcome.kind).toBe("RETRYABLE");
  });
});

describe("SMTP adapter", () => {
  const smtpConn = conn({ host: "smtp.example.com", port: 587, security: "STARTTLS", fromEmail: "news@example.com", fromName: "Acme" }, { password: "pw" });
  it("classifies SMTP errors", () => {
    expect(classifySmtpError({ code: "EAUTH" }).kind).toBe("CONNECTION");
    expect(classifySmtpError({ code: "EENVELOPE", responseCode: 550 }).kind).toBe("PERMANENT");
    expect(classifySmtpError({ responseCode: 451 }).kind).toBe("RETRYABLE");
    expect(classifySmtpError({ code: "ECONNECTION" }).kind).toBe("RETRYABLE");
    expect(classifySmtpError({ code: "ETIMEDOUT" }).kind).toBe("UNKNOWN");
  });
  it("sends with our Message-ID and List-Unsubscribe headers", async () => {
    const sendMail = vi.fn(async () => ({ messageId: "x", accepted: ["asha@example.com"], rejected: [], response: "250 OK" }));
    const out = await smtpAdapter.send(smtpConn, msg(), { ...deps(fetch), smtpTransport: () => ({ sendMail, verify: async () => true }) });
    expect(out).toMatchObject({ kind: "ACCEPTED", providerMessageId: `<${DELIVERY}@example.com>` });
    const mail = (sendMail.mock.calls[0] as unknown as [Record<string, unknown>])[0] as { headers: Record<string, string>; messageId: string };
    expect(mail.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(mail.messageId).toBe(`<${DELIVERY}@example.com>`);
  });
  it("validates config", () => {
    expect(Object.keys(smtpAdapter.validateConfig({ host: "bad host!", port: 0, security: "X", fromEmail: "x" }, {}))).toEqual(expect.arrayContaining(["host", "port", "security", "fromEmail"]));
  });
});

describe("Brevo adapter", () => {
  const c = conn({ fromEmail: "news@example.com" }, { apiKey: "xkeysib-abc" });
  it("sends with the delivery id echoed and returns the message id", async () => {
    const f = fakeFetch(201, { messageId: "<201@relay>" });
    const out = await brevoAdapter.send(c, msg(), deps(f.fn));
    expect(out).toEqual({ kind: "ACCEPTED", providerMessageId: "<201@relay>", providerStatus: "201" });
    const body = JSON.parse(String(f.calls[0].init.body));
    expect(body.headers["X-Mailin-custom"]).toBe(DELIVERY);
    expect((f.calls[0].init.headers as Record<string, string>)["api-key"]).toBe("xkeysib-abc");
  });
  it("a 400 is permanent, 429 throttled", async () => {
    expect((await brevoAdapter.send(c, msg(), deps(fakeFetch(400, { code: "invalid_parameter", message: "bad" }).fn))).kind).toBe("PERMANENT");
    expect((await brevoAdapter.send(c, msg(), deps(fakeFetch(429, {}, { "retry-after": "5" }).fn))).kind).toBe("THROTTLED");
  });
  it("parses webhook events with correlation and stable keys", () => {
    const ev = brevoAdapter.parseWebhook!(hook(JSON.stringify({ event: "hard_bounce", "message-id": "<201@relay>", "X-Mailin-custom": DELIVERY, ts_event: 1730000000, reason: "mailbox unavailable" })), c);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ normalized: "BOUNCED", correlationId: DELIVERY, providerMessageId: "<201@relay>", errorCode: "HARD_BOUNCE" });
    const again = brevoAdapter.parseWebhook!(hook(JSON.stringify({ event: "hard_bounce", "message-id": "<201@relay>", "X-Mailin-custom": DELIVERY, ts_event: 1730000000 })), c);
    expect(again[0].eventKey).toBe(ev[0].eventKey);
    expect(brevoAdapter.parseWebhook!(hook(JSON.stringify({ event: "unsubscribed", "message-id": "m" })), c)[0].normalized).toBe("UNSUBSCRIBED");
    expect(brevoAdapter.parseWebhook!(hook("not json"), c)).toEqual([]);
  });
});

describe("MSG91 adapter", () => {
  const c = conn({ senderId: "ACMEIN", defaultCountryCode: "91" }, { authKey: "auth-123" });
  it("needs the DLT template id", () => {
    expect(msg91Adapter.validateMessage(msg({ subject: null }), c.config)).toEqual([expect.stringMatching(/flow \/ template id/)]);
  });
  it("sends a flow with positional variables", async () => {
    const f = fakeFetch(200, { type: "success", message: "req-1" });
    const out = await msg91Adapter.send(c, msg({ to: "919876543210", parameters: [{ key: "contact.first_name", value: "Asha" }], providerMetadata: { externalTemplateId: "tpl_1" } }), deps(f.fn));
    expect(out).toMatchObject({ kind: "ACCEPTED", providerMessageId: "req-1" });
    const body = JSON.parse(String(f.calls[0].init.body));
    expect(body.recipients[0]).toEqual({ mobiles: "919876543210", var1: "Asha" });
  });
  it("an auth error stops the connection, other errors are permanent", async () => {
    expect((await msg91Adapter.send(c, msg({ providerMetadata: { externalTemplateId: "t" } }), deps(fakeFetch(200, { type: "error", message: "Invalid authkey" }).fn))).kind).toBe("CONNECTION");
    expect((await msg91Adapter.send(c, msg({ providerMetadata: { externalTemplateId: "t" } }), deps(fakeFetch(400, { type: "error", message: "Template not approved" }).fn))).kind).toBe("PERMANENT");
  });
  it("parses delivery reports", () => {
    const ev = msg91Adapter.parseWebhook!(hook(JSON.stringify([{ requestId: "req-1", report: [{ number: "919876543210", status: "1", desc: "DELIVERED", date: "2026-11-05 10:00:00" }] }])), c);
    expect(ev[0]).toMatchObject({ providerMessageId: "req-1", correlationId: null });
  });
});

describe("WhatsApp Cloud adapter", () => {
  const c = conn({ phoneNumberId: "1234567890", apiVersion: "v21.0", defaultCountryCode: "91" }, { accessToken: "EAAB", appSecret: "app-secret", verifyToken: "verify-123" });
  it("sends an approved template with our callback data", async () => {
    const f = fakeFetch(200, { messages: [{ id: "wamid.1", message_status: "accepted" }] });
    const out = await whatsappCloudAdapter.send(c, msg({ to: "919876543210", parameters: [{ key: "contact.first_name", value: "Asha" }], providerMetadata: { externalTemplateName: "promo_1", language: "en_US" } }), deps(f.fn));
    expect(out).toMatchObject({ kind: "ACCEPTED", providerMessageId: "wamid.1" });
    const body = JSON.parse(String(f.calls[0].init.body));
    expect(body.biz_opaque_callback_data).toBe(DELIVERY);
    expect(body.template).toMatchObject({ name: "promo_1", language: { code: "en_US" } });
    expect(f.calls[0].url).toContain("/v21.0/1234567890/messages");
  });
  it("checks the callback signature", () => {
    const raw = JSON.stringify({ entry: [] });
    const good = `sha256=${createHmac("sha256", "app-secret").update(raw).digest("hex")}`;
    expect(whatsappCloudAdapter.verifyWebhook!(hook(raw, { "x-hub-signature-256": good }), c).ok).toBe(true);
    expect(whatsappCloudAdapter.verifyWebhook!(hook(raw, { "x-hub-signature-256": "sha256=00" }), c).ok).toBe(false);
    expect(whatsappCloudAdapter.verifyWebhook!(hook(raw), c).ok).toBe(false);
  });
  it("answers the subscription handshake only with the right token", () => {
    expect(whatsappCloudAdapter.handshake!(hook("", {}, "GET", "hub.mode=subscribe&hub.verify_token=verify-123&hub.challenge=abc123"), c)).toBe("abc123");
    expect(whatsappCloudAdapter.handshake!(hook("", {}, "GET", "hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=abc123"), c)).toBeNull();
  });
  it("parses statuses with correlation", () => {
    const raw = JSON.stringify({ entry: [{ changes: [{ value: { statuses: [{ id: "wamid.1", status: "delivered", timestamp: "1730000000", biz_opaque_callback_data: DELIVERY }, { id: "wamid.2", status: "failed", timestamp: "1730000001", errors: [{ code: 131026, title: "Message undeliverable" }] }] } }] }] });
    const ev = whatsappCloudAdapter.parseWebhook!(hook(raw), c);
    expect(ev.map((e) => e.normalized)).toEqual(["DELIVERED", "FAILED"]);
    expect(ev[0].correlationId).toBe(DELIVERY);
    expect(ev[1].errorCode).toBe("META_131026");
  });
  it("throttling and auth errors", async () => {
    const m = msg({ to: "919876543210", providerMetadata: { externalTemplateName: "p" } });
    expect((await whatsappCloudAdapter.send(c, m, deps(fakeFetch(400, { error: { code: 130429, message: "rate" } }).fn))).kind).toBe("THROTTLED");
    expect((await whatsappCloudAdapter.send(c, m, deps(fakeFetch(401, { error: { code: 190, message: "token" } }).fn))).kind).toBe("CONNECTION");
  });
});
