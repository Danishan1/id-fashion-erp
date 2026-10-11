import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProviderChannel } from "./CommunicationProvider";
import { channelProvidersFor, getChannelProvider } from "./provider-registry";
import { attachmentKindOf, checkOutboundUrl, genericWebhookProvider as generic, primaryIdentity, signGenericPayload } from "./providers/generic-webhook.provider";

const channel = (over: Partial<ProviderChannel> = {}): ProviderChannel => ({ id: "ch-1", companyId: "co-1", channelType: "WHATSAPP", provider: "generic", address: null, config: {}, secret: "whsec_test", ...over });
const now = new Date("2026-10-10T10:00:00Z");
const ts = Math.floor(now.getTime() / 1000);
const req = (body: unknown, opts: { ts?: number; secret?: string; raw?: string } = {}) => {
  const rawBody = opts.raw ?? JSON.stringify(body);
  const t = opts.ts ?? ts;
  return { headers: new Headers({ "x-crm-timestamp": String(t), "x-crm-signature": signGenericPayload(opts.secret ?? "whsec_test", t, rawBody) }), rawBody, now };
};

describe("provider registry", () => {
  it("resolves providers by key and lists them per channel type", () => {
    expect(getChannelProvider("generic")).toBe(generic);
    expect(getChannelProvider("whatsapp-cloud")).toBeNull();
    expect(getChannelProvider("__proto__")).toBeNull();
    expect(channelProvidersFor("INSTAGRAM").map((p) => p.key)).toEqual(["generic"]);
  });
});

describe("generic webhook provider — inbound", () => {
  it("verifies HMAC signatures with a replay window", () => {
    expect(generic.verifyWebhook(channel(), req({ a: 1 }))).toEqual({ ok: true });
    expect(generic.verifyWebhook(channel(), req({ a: 1 }, { secret: "other" }))).toMatchObject({ ok: false, reason: "Invalid signature." });
    expect(generic.verifyWebhook(channel(), req({ a: 1 }, { ts: ts - 301 }))).toMatchObject({ ok: false });
    expect(generic.verifyWebhook(channel(), { headers: new Headers(), rawBody: "{}", now })).toMatchObject({ ok: false });
    // Body tampering after signing.
    const r = req({ text: "hi" });
    expect(generic.verifyWebhook(channel(), { ...r, rawBody: JSON.stringify({ text: "hello" }) })).toMatchObject({ ok: false });
  });

  it("normalises messages to the provider-neutral shape (no raw payload kept)", () => {
    const events = generic.normalizeInbound(channel(), req({ type: "message", id: "wamid.1", from: { phone: "+91 98100 12345", name: "Rahul", email: "r@x.com" }, text: " Can we meet? ", timestamp: "2026-10-10T09:59:00Z", vendorJunk: { token: "SECRET" } }));
    expect(events).toHaveLength(1);
    const ev = events[0];
    if (ev.type !== "message") throw new Error("expected a message");
    expect(ev.message).toEqual({
      providerMessageId: "wamid.1",
      threadRef: null,
      from: { kind: "PHONE", value: "+91 98100 12345", displayName: "Rahul" },
      alternateIdentities: [{ kind: "EMAIL", value: "r@x.com", displayName: "Rahul" }],
      to: null,
      occurredAt: new Date("2026-10-10T09:59:00Z"),
      messageType: "TEXT",
      subject: null,
      body: "Can we meet?",
      attachments: [],
      metadata: {},
    });
    expect(JSON.stringify(ev)).not.toContain("SECRET");
  });

  it("picks the identity the channel type is keyed on", () => {
    const ids = [
      { kind: "EMAIL" as const, value: "a@b.c" },
      { kind: "PHONE" as const, value: "+1 555 0100" },
      { kind: "PROVIDER_ID" as const, value: "psid-9" },
      { kind: "SESSION" as const, value: "s-1" },
    ];
    expect(primaryIdentity("EMAIL", ids)?.kind).toBe("EMAIL");
    expect(primaryIdentity("SMS", ids)?.kind).toBe("PHONE");
    expect(primaryIdentity("INSTAGRAM", ids)?.kind).toBe("PROVIDER_ID");
    expect(primaryIdentity("WEB_CHAT", ids)?.kind).toBe("SESSION");
    expect(primaryIdentity("WHATSAPP", [ids[0]])).toBeNull();
  });

  it("handles batches, status receipts, attachments, location and future timestamps", () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64");
    const events = generic.normalizeInbound(
      channel({ channelType: "EMAIL" }),
      req({
        events: [
          { type: "status", messageId: "out-1", status: "delivered" },
          { type: "message", id: "e-1", threadId: "<root@x>", from: { email: "a@b.c" }, subject: "Quote", attachments: [{ fileName: "a.png", mimeType: "IMAGE/PNG", contentBase64: png }, { fileName: "b.pdf", mimeType: "application/pdf", mediaId: "m-1" }], inReplyTo: "<prev@x>", timestamp: "2030-01-01T00:00:00Z" },
          { type: "message", id: "e-2", from: { email: "a@b.c" }, location: { latitude: 19.07, longitude: 72.87, name: "Office" } },
        ],
      })
    );
    expect(events[0]).toEqual({ type: "status", status: { providerMessageId: "out-1", status: "DELIVERED", occurredAt: now, errorCode: null, errorMessage: null } });
    const m1 = events[1].type === "message" ? events[1].message : null;
    expect(m1).toMatchObject({ threadRef: "<root@x>", subject: "Quote", messageType: "IMAGE", occurredAt: now, metadata: { inReplyTo: "<prev@x>" } });
    expect(m1?.attachments.map((a) => [a.kind, a.mimeType, Boolean(a.content), a.providerMediaRef])).toEqual([
      ["IMAGE", "image/png", true, null],
      ["DOCUMENT", "application/pdf", false, "m-1"],
    ]);
    const m2 = events[2].type === "message" ? events[2].message : null;
    expect(m2).toMatchObject({ messageType: "LOCATION", metadata: { location: { latitude: 19.07, longitude: 72.87, name: "Office" } } });
  });

  it("rejects payloads it can't normalise with a clear reason", () => {
    const bad = (body: unknown, raw?: string) => () => generic.normalizeInbound(channel(), req(body, { raw }));
    expect(bad(null, "not json")).toThrow(/JSON/);
    expect(bad([1, 2])).toThrow(/object/);
    expect(bad({ events: [] })).toThrow(/No events/);
    expect(bad({ events: Array.from({ length: 51 }, () => ({})) })).toThrow(/At most 50/);
    expect(bad({ type: "message", id: "x", from: { email: "a@b.c" }, text: "hi" })).toThrow(/phone/);
    expect(bad({ type: "message", id: "x", from: { phone: "+1 555" } })).toThrow(/no text/);
    expect(bad({ type: "message", id: "x", from: { phone: "+1 555 0100" }, attachments: [{ fileName: "a", mimeType: "image/png" }] })).toThrow(/contentBase64 or mediaId/);
    expect(bad({ type: "unknown" })).toThrow(/Event 1/);
  });
});

describe("generic webhook provider — config, capabilities and sending", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("validates settings and derives capabilities from them (receive-only without an outbound URL)", () => {
    expect(generic.validateConfig("SMS", {})).toEqual({ outboundUrl: null, allowAttachments: true, maxAttachmentMb: 5 });
    expect(() => generic.validateConfig("SMS", { outboundUrl: "ftp://x" })).toThrow(/https/);
    expect(() => generic.validateConfig("SMS", { outboundUrl: "nope" })).toThrow(/full URL/);
    expect(() => generic.validateConfig("SMS", { extra: true })).toThrow();
    expect(checkOutboundUrl("http://localhost:4000/x", false)).toBeNull();
    expect(checkOutboundUrl("http://relay.example.com/x", true)).toMatch(/https/);
    const receiveOnly = generic.capabilities({ channelType: "SMS", config: {} });
    expect(receiveOnly).toMatchObject({ canReceive: true, canSend: false, supportsAttachments: false });
    expect(receiveOnly.sendUnavailableReason).toMatch(/outbound URL/);
    const sms = generic.capabilities({ channelType: "SMS", config: { outboundUrl: "https://r.example/s" } });
    expect(sms).toMatchObject({ canSend: true, supportsSubject: false, maxTextLength: 1600, attachmentKinds: ["IMAGE", "DOCUMENT"] });
    expect(generic.capabilities({ channelType: "EMAIL", config: { outboundUrl: "https://r.example/s", allowAttachments: false } })).toMatchObject({ supportsSubject: true, supportsAttachments: false, maxAttachments: 0 });
    expect(attachmentKindOf("application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBe("DOCUMENT");
    expect(attachmentKindOf("video/mp4")).toBe("VIDEO");
  });

  it("checks recipients against the channel's identity kind", () => {
    expect(generic.validateRecipient(channel(), { kind: "PHONE", value: "+91 1" })).toEqual({ ok: true });
    expect(generic.validateRecipient(channel(), { kind: "EMAIL", value: "a@b.c" })).toMatchObject({ ok: false });
  });

  const out = { idempotencyKey: "msg-1", conversation: { id: "c-1", threadRef: null }, to: { kind: "PHONE" as const, value: "+91 98100 12345" }, subject: null, body: "Hello", attachments: [], replyToProviderMessageId: "in-1", metadata: {} };
  const configured = channel({ config: { outboundUrl: "https://relay.example.com/send" } });

  it("posts a signed, idempotent request and normalises the answer", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ messageId: "wamid.9", status: "delivered" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await generic.sendMessage(configured, out)).toEqual({ ok: true, providerMessageId: "wamid.9", status: "DELIVERED" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toBe("https://relay.example.com/send");
    expect(init.redirect).toBe("error");
    expect(init.headers["X-CRM-Idempotency-Key"]).toBe("msg-1");
    expect(init.headers["X-CRM-Signature"]).toBe(signGenericPayload("whsec_test", init.headers["X-CRM-Timestamp"], String(init.body)));
    expect(JSON.parse(String(init.body))).toMatchObject({ id: "msg-1", text: "Hello", inReplyTo: "in-1", to: { kind: "PHONE" } });
  });

  it("turns provider failures into safe, classified results — never the provider's response text", async () => {
    const respond = (r: Response | Error) => vi.stubGlobal("fetch", vi.fn(async () => (r instanceof Error ? Promise.reject(r) : r)));
    respond(new Response("apiKey=sk_live_LEAK", { status: 401 }));
    const r401 = await generic.sendMessage(configured, out);
    expect(r401).toEqual({ ok: false, errorCode: "PROVIDER_HTTP_401", errorMessage: "The provider rejected the message (HTTP 401).", retryable: false });
    respond(new Response("", { status: 503 }));
    expect(await generic.sendMessage(configured, out)).toMatchObject({ ok: false, retryable: true });
    respond(Object.assign(new Error("t"), { name: "TimeoutError" }));
    expect(await generic.sendMessage(configured, out)).toMatchObject({ ok: false, errorCode: "PROVIDER_TIMEOUT", retryable: true });
    respond(new TypeError("fetch failed"));
    expect(await generic.sendMessage(configured, out)).toMatchObject({ ok: false, errorCode: "PROVIDER_UNREACHABLE" });
    respond(new Response("not json", { status: 200 }));
    expect(await generic.sendMessage(configured, out)).toMatchObject({ ok: false, errorCode: "PROVIDER_BAD_RESPONSE", retryable: false });
    expect(await generic.sendMessage(channel(), out)).toMatchObject({ ok: false, errorCode: "CHANNEL_NOT_SENDABLE" });
  });
});
