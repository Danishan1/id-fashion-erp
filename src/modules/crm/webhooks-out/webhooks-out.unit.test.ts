import { describe, expect, it, vi } from "vitest";

vi.mock("@/core/db/client", () => ({ prisma: {} }));

const { CRM_EVENT_TYPES } = await import("../core/crm-event-types");
const ev = await import("./webhook-events");
const { describeFailure } = await import("./webhook-delivery");
const { createSubscriptionSchema, updateSubscriptionSchema } = await import("./crm-webhook-subscriptions.service");
const { WebhookBlockedError, WebhookCallError } = await import("../workflows/workflow-webhook");

describe("webhook event catalogue", () => {
  it("is the CRM event registry (minus draft bookkeeping) — nothing invented", () => {
    const registry = Object.keys(CRM_EVENT_TYPES);
    expect(ev.WEBHOOK_EVENTS.length).toBe(registry.length - 2);
    for (const e of ev.WEBHOOK_EVENTS) expect(registry).toContain(e.type);
    expect(ev.isWebhookEventType("workflow.draft_saved")).toBe(false);
    expect(ev.isWebhookEventType("lead.created")).toBe(true);
    expect(ev.isWebhookEventType("lead.exploded")).toBe(false);
    expect(new Set(ev.WEBHOOK_EVENTS.map((e) => e.group)).size).toBeGreaterThan(3);
  });

  it("envelopes identify the event and record; samples are synthetic and marked as tests", () => {
    const env = ev.buildEnvelope({ id: "e1", eventType: "lead.created", occurredAt: new Date("2026-10-14T00:00:00Z"), entityType: "LEAD", entityId: "l1", summary: "s", payload: ["not", "an", "object"], actorUserId: null });
    expect(env).toEqual({ id: "e1", type: "lead.created", occurredAt: "2026-10-14T00:00:00.000Z", test: false, data: { entity: { type: "LEAD", id: "l1" }, summary: "s", payload: {}, actor: { userId: null } } });
    const s = ev.sampleEnvelope("lead.status_changed");
    expect(s.test).toBe(true);
    expect(s.id).toMatch(/^00000000-0000-4000-8000-/);
    expect(s.data.payload).toHaveProperty("fromStatusId");
    expect(ev.sampleEnvelope("nope").type).toBe(ev.WEBHOOK_EVENTS[0].type);
  });

  it("retry schedule matches what the UI and docs promise", () => {
    expect(ev.WEBHOOK_RETRY_DELAYS_MS).toEqual([60_000, 300_000, 1_800_000, 7_200_000, 21_600_000]);
    expect(ev.WEBHOOK_MAX_ATTEMPTS).toBe(6);
    expect(ev.RECEIVER_EXAMPLE_NODE).toContain("timingSafeEqual");
    expect(ev.RECEIVER_EXAMPLE_NODE).not.toMatch(/whsec_[A-Za-z0-9]/);
  });
});

describe("delivery failure classification", () => {
  it("retries transient failures only, and never surfaces receiver bodies or internal addresses", () => {
    expect(describeFailure(new WebhookCallError("The webhook answered 503.", 503, false))).toMatchObject({ code: "HTTP_503", retryable: true });
    expect(describeFailure(new WebhookCallError("x", 429, false))).toMatchObject({ retryable: true });
    expect(describeFailure(new WebhookCallError("x", 408, false))).toMatchObject({ retryable: true });
    expect(describeFailure(new WebhookCallError("x", 404, false))).toMatchObject({ code: "HTTP_404", retryable: false });
    expect(describeFailure(new WebhookCallError("x", 301, false))).toMatchObject({ code: "REDIRECT_REFUSED", retryable: false });
    expect(describeFailure(new WebhookBlockedError("10.0.0.1 is private"))).toMatchObject({ code: "DESTINATION_BLOCKED", retryable: false });
    const net = describeFailure(new WebhookCallError("Couldn't call the webhook: connect ECONNREFUSED 10.1.2.3:443", null, true));
    expect(net).toMatchObject({ code: "UNREACHABLE", retryable: true, message: "Connection refused by the endpoint." });
    expect(net.message).not.toContain("10.1.2.3");
    expect(describeFailure(new WebhookCallError("The webhook didn't answer within 10 s.", null, true)).message).toMatch(/10 seconds/);
    expect(describeFailure(new Error("db exploded at /srv/app.ts:12"))).toEqual({ code: "UNEXPECTED", message: "Unexpected error while sending.", status: null, retryable: true });
  });
});

describe("subscription schemas", () => {
  it("have no way to set a secret, and validate events", () => {
    expect(createSubscriptionSchema.safeParse({ name: "a", url: "https://x.example", eventTypes: ["lead.created"], secret: "s" }).success).toBe(false);
    expect(updateSubscriptionSchema.safeParse({ version: 1, secret: "s" }).success).toBe(false);
    expect(updateSubscriptionSchema.safeParse({ version: 1, secretEncrypted: "s" }).success).toBe(false);
    expect(createSubscriptionSchema.safeParse({ name: "a", url: "https://x.example", eventTypes: [] }).success).toBe(false);
    const ok = createSubscriptionSchema.parse({ name: " a ", url: "https://x.example", eventTypes: ["lead.created", "lead.created"] });
    expect(ok.eventTypes).toEqual(["lead.created"]);
  });
});
