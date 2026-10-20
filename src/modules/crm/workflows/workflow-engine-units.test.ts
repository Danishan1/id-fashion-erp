import { describe, expect, it } from "vitest";
import { evaluateGroup, validateConditionGroup, type ConditionGroup } from "./workflow-conditions";
import { availableFields, emptyDefinition, validateDefinitionStructure, workflowDefinitionSchema, type WorkflowDefinition } from "./workflow-definition";
import { computeResumeAt } from "./workflow-waits";
import { assertWebhookUrlShape, isBlockedAddress, signWebhookBody, WebhookBlockedError } from "./workflow-webhook";
import { payloadMatches, triggerDef, triggersForEvent, TRIGGERING_EVENT_TYPES } from "./workflow-triggers";
import { WORKFLOW_ACTIONS } from "./workflow-action-catalog";
import { createHmac } from "node:crypto";

/** Phase 18 — pure units of the workflow engine (no database). */

const leaf = (field: string, operator: string, value?: unknown) => ({ kind: "condition" as const, field, operator: operator as never, value: value as never });
const group = (logic: "AND" | "OR", conditions: ConditionGroup["conditions"], negate = false): ConditionGroup => ({ kind: "group", logic, negate, conditions });

describe("conditions", () => {
  const snap = { "record.full_name": "Asha Rao", "record.score": 42, "record.tags": ["t1", "t2"], "record.next_follow_up_at": "2026-10-10T00:00:00Z", "record.is_converted": false, "record.email": null };
  const now = new Date("2026-10-13T00:00:00Z");

  it("evaluates AND / OR / NOT and nesting", () => {
    expect(evaluateGroup(group("AND", [leaf("record.full_name", "contains", "asha"), leaf("record.score", "gte", 40)]), snap)).toBe(true);
    expect(evaluateGroup(group("AND", [leaf("record.full_name", "contains", "asha"), leaf("record.score", "gt", 50)]), snap)).toBe(false);
    expect(evaluateGroup(group("OR", [leaf("record.score", "gt", 50), leaf("record.tags", "has_tag", "t2")]), snap)).toBe(true);
    expect(evaluateGroup(group("AND", [leaf("record.score", "gt", 50)], true), snap)).toBe(true);
    expect(evaluateGroup(group("AND", [group("OR", [leaf("record.is_converted", "is_true"), leaf("record.email", "is_empty")]), leaf("record.score", "between", [40, 45])]), snap)).toBe(true);
  });

  it("empty group matches; unknown fields are empty, never errors", () => {
    expect(evaluateGroup(group("AND", []), snap)).toBe(true);
    expect(evaluateGroup(group("AND", [leaf("record.nope", "is_empty")]), snap)).toBe(true);
  });

  it("date operators use the given clock", () => {
    expect(evaluateGroup(group("AND", [leaf("record.next_follow_up_at", "within_last_days", 7)]), snap, now)).toBe(true);
    expect(evaluateGroup(group("AND", [leaf("record.next_follow_up_at", "more_than_days_ago", 7)]), snap, now)).toBe(false);
  });

  it("validation whitelists fields and operators", () => {
    const fields = availableFields(emptyDefinition("lead.created"));
    expect(validateConditionGroup(group("AND", [leaf("record.full_name", "contains", "x")]), fields)).toEqual([]);
    expect(validateConditionGroup(group("AND", [leaf("record.secret_column", "eq", "x")]), fields).length).toBe(1);
    expect(validateConditionGroup(group("AND", [leaf("record.full_name", "gt", 3)]), fields).length).toBe(1);
  });

  it("schema rejects anything that isn't a whitelisted shape (no expressions)", () => {
    const bad = { kind: "condition", field: "record.full_name", operator: "eq", value: "x", expr: "process.exit()" };
    expect(workflowDefinitionSchema.safeParse({ ...emptyDefinition(), trigger: { type: "lead.created", conditions: group("AND", [bad as never]) } }).success).toBe(false);
  });
});

describe("definition validation", () => {
  const base = (nodes: WorkflowDefinition["nodes"], entry: string | null = nodes[0]?.id ?? null): WorkflowDefinition => ({ ...emptyDefinition("lead.created"), nodes, entryNodeId: entry });

  it("accepts a valid chain", () => {
    const d = base([
      { id: "a", type: "CONDITION", condition: group("AND", [leaf("record.score", "gt", 10)]), onTrue: "b", onFalse: null },
      { id: "b", type: "ACTION", action: "task.create", params: { subject: "Call {{lead.full_name}}" }, next: "c", onError: "STOP" },
      { id: "c", type: "WAIT", wait: { mode: "DURATION", amount: 2, unit: "DAYS" }, next: "d" },
      { id: "d", type: "EXIT", reason: "done" },
    ]);
    expect(validateDefinitionStructure(d).filter((i) => !/required/i.test(i.message))).toEqual([]);
  });

  it("finds cycles, dangling references, unreachable nodes and unknown actions", () => {
    const d = base([
      { id: "a", type: "ACTION", action: "note.add", params: { content: "x" }, next: "b", onError: "STOP" },
      { id: "b", type: "ACTION", action: "note.add", params: { content: "y" }, next: "a", onError: "STOP" },
      { id: "c", type: "ACTION", action: "does.not.exist", params: {}, next: "zzz", onError: "STOP" },
    ]);
    const messages = validateDefinitionStructure(d).map((i) => i.message).join(" | ");
    expect(messages).toMatch(/loop|cycle/i);
    expect(messages).toMatch(/zzz|doesn't exist|unknown step/i);
    expect(messages).toMatch(/reach/i);
    expect(messages).toMatch(/does\.not\.exist|unknown action/i);
  });

  it("rejects actions that don't fit the record type", () => {
    const d = base([{ id: "a", type: "ACTION", action: "opportunity.move_stage", params: {}, next: null, onError: "STOP" }]);
    expect(validateDefinitionStructure(d).some((i) => i.nodeId === "a")).toBe(true);
  });
});

describe("waits", () => {
  const now = new Date("2026-10-13T10:00:00Z"); // Tue 15:30 IST

  it("duration", () => {
    expect(computeResumeAt({ mode: "DURATION", amount: 3, unit: "HOURS" }, now, "Asia/Kolkata").toISOString()).toBe("2026-10-13T13:00:00.000Z");
  });

  it("until a time of day, in the workflow's time zone", () => {
    // 09:00 IST already passed today → tomorrow 09:00 IST = 03:30Z
    expect(computeResumeAt({ mode: "UNTIL_TIME", time: "09:00" }, now, "Asia/Kolkata").toISOString()).toBe("2026-10-14T03:30:00.000Z");
    // later today
    expect(computeResumeAt({ mode: "UNTIL_TIME", time: "18:00" }, now, "Asia/Kolkata").toISOString()).toBe("2026-10-13T12:30:00.000Z");
    // weekdays only: Saturday request skips to Monday
    const sat = new Date("2026-10-17T06:00:00Z");
    expect(computeResumeAt({ mode: "UNTIL_TIME", time: "09:00", days: ["MON"] }, sat, "Asia/Kolkata").toISOString()).toBe("2026-10-19T03:30:00.000Z");
  });

  it("is DST-safe (New York, 2026-11-01 fall back)", () => {
    const before = new Date("2026-10-31T20:00:00Z");
    expect(computeResumeAt({ mode: "UNTIL_TIME", time: "09:00" }, before, "America/New_York").toISOString()).toBe("2026-11-01T14:00:00.000Z");
  });

  it("until a record date with offset; missing date continues now", () => {
    expect(computeResumeAt({ mode: "UNTIL_FIELD", field: "record.next_follow_up_at", offsetMinutes: -60 }, now, "UTC", "2026-10-20T12:00:00Z").toISOString()).toBe("2026-10-20T11:00:00.000Z");
    expect(computeResumeAt({ mode: "UNTIL_FIELD", field: "x", offsetMinutes: 0 }, now, "UTC", null).getTime()).toBe(now.getTime());
  });
});

describe("webhook safety", () => {
  it.each(["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"])("blocks %s", (ip) => {
    expect(isBlockedAddress(ip)).toBe(true);
  });
  it.each(["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"])("allows %s", (ip) => expect(isBlockedAddress(ip)).toBe(false));

  it("rejects non-https, credentials, odd ports and internal names", () => {
    for (const u of ["http://example.com/x", "https://user:pw@example.com", "https://example.com:22/", "https://localhost/x", "https://db.internal/x", "ftp://example.com"]) {
      expect(() => assertWebhookUrlShape(u)).toThrow(WebhookBlockedError);
    }
    expect(assertWebhookUrlShape("https://hooks.example.com/abc").hostname).toBe("hooks.example.com");
  });

  it("signs t.body with HMAC-SHA256", () => {
    const sig = signWebhookBody("s3cret", '{"a":1}', 1700000000);
    expect(sig).toBe(`t=1700000000,v1=${createHmac("sha256", "s3cret").update('1700000000.{"a":1}').digest("hex")}`);
  });
});

describe("triggers & action catalog", () => {
  it("maps events to triggers and filters by payload", () => {
    expect(triggersForEvent("lead.created").sort()).toEqual(["lead.captured", "lead.created", "lead.imported"]);
    expect(payloadMatches(triggerDef("lead.imported"), { channel: "CSV" })).toBe(true);
    expect(payloadMatches(triggerDef("lead.imported"), { channel: "MANUAL" })).toBe(false);
    expect(TRIGGERING_EVENT_TYPES).not.toContain("workflow.published");
  });

  it("messages and webhooks are never retried automatically", () => {
    expect(WORKFLOW_ACTIONS["message.send"].retryable).toBe(false);
    expect(WORKFLOW_ACTIONS["webhook.post"].retryable).toBe(false);
    expect(WORKFLOW_ACTIONS["webhook.post"].permission.module).toBe("crm_settings");
  });
});
