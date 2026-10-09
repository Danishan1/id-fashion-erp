import { describe, expect, it } from "vitest";
import { crmEventInputSchema, parseCrmEventFilters } from "./crm-event.schema";

const ID = "6f1c2f1e-1f2a-4b1a-9d1a-2b3c4d5e6f70";

describe("crmEventInputSchema", () => {
  it("accepts a registered event", () => {
    expect(crmEventInputSchema.parse({ entityType: "LEAD", entityId: ID, eventType: "lead.created" }).eventType).toBe("lead.created");
  });

  it("rejects an unregistered event type, a bad entity type and a non-uuid id", () => {
    expect(() => crmEventInputSchema.parse({ entityType: "LEAD", entityId: ID, eventType: "lead.exploded" })).toThrow();
    expect(() => crmEventInputSchema.parse({ entityType: "TASK", entityId: ID, eventType: "lead.created" })).toThrow();
    expect(() => crmEventInputSchema.parse({ entityType: "LEAD", entityId: "123", eventType: "lead.created" })).toThrow();
  });
});

describe("parseCrmEventFilters", () => {
  const parse = (qs: string) => parseCrmEventFilters(new URLSearchParams(qs));

  it("ignores blank params and returns only real filters", () => {
    expect(parse("entityType=&eventType=lead.created&from=")).toEqual({
      entityType: undefined,
      entityId: undefined,
      eventType: "lead.created",
      actorUserId: undefined,
      from: undefined,
      to: undefined,
    });
  });

  it("requires entityType when entityId is given", () => {
    expect(() => parse(`entityId=${ID}`)).toThrow(/entityType is required/);
    expect(parse(`entityType=LEAD&entityId=${ID}`).entityId).toBe(ID);
  });

  it("validates date format and order", () => {
    expect(() => parse("from=01-10-2026")).toThrow(/YYYY-MM-DD/);
    expect(() => parse("from=2026-10-05&to=2026-10-01")).toThrow(/on or before/);
    expect(parse("from=2026-10-01&to=2026-10-01").to).toBe("2026-10-01");
  });

  it("rejects unknown event types in filters", () => {
    expect(() => parse("eventType=nope")).toThrow();
  });
});
