import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/logging/logger", () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

const { logger } = await import("@/core/logging/logger");
const { clearCrmEventSubscribers, dispatchCrmEvents, subscribeCrmEvent } = await import("./crm-event-bus");

const event = (eventType: string) => ({ id: `ev-${eventType}`, eventType }) as never;

afterEach(() => {
  clearCrmEventSubscribers();
  vi.mocked(logger.error).mockReset();
});

describe("CRM event bus", () => {
  it("delivers to type-specific and wildcard subscribers", async () => {
    const onCreated = vi.fn();
    const onAll = vi.fn();
    subscribeCrmEvent("lead.created", onCreated);
    subscribeCrmEvent("*", onAll);

    await dispatchCrmEvents([event("lead.created"), event("lead.updated")]);

    expect(onCreated).toHaveBeenCalledTimes(1);
    expect(onAll).toHaveBeenCalledTimes(2);
  });

  it("logs and swallows a failing subscriber so other subscribers still run", async () => {
    const after = vi.fn();
    subscribeCrmEvent("lead.created", () => {
      throw new Error("boom");
    });
    subscribeCrmEvent("lead.created", after);

    await expect(dispatchCrmEvents([event("lead.created")])).resolves.toBeUndefined();
    expect(after).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith("CRM event subscriber failed", expect.objectContaining({ error: "boom" }));
  });

  it("stops delivering after unsubscribe", async () => {
    const handler = vi.fn();
    const unsubscribe = subscribeCrmEvent("lead.created", handler);
    unsubscribe();
    await dispatchCrmEvents([event("lead.created")]);
    expect(handler).not.toHaveBeenCalled();
  });
});
