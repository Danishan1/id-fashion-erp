import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";

// Keep the queue/worker side out of a pure unit run.
vi.mock("@/modules/sales-marketing/attribution/attribution-jobs.worker", () => ({ scheduleAttributionRun: vi.fn() }));
vi.mock("@/modules/bulk-actions/bulk-jobs.service", () => ({ retryBulkJob: vi.fn() }));

const { classifyError, getWorkflowImpl } = await import("./sm-workflow-engine");
const { validateConfig } = await import("./sm-workflows.service");
const { earliest, istDate, nextCheck } = await import("./sm-workflow-steps");
const R = await import("./sm-workflow-registry");

/** Phase 15 — pure units of the S&M workflow layer (no database). */

describe("status machine", () => {
  it("terminal states go nowhere; waits never jump to failed directly", () => {
    expect(R.SM_WF_TRANSITIONS.COMPLETED).toEqual([]);
    expect(R.SM_WF_TRANSITIONS.CANCELLED).toEqual([]);
    expect(R.canSmWfTransition("WAITING_EVENT", "FAILED")).toBe(false);
    expect(R.canSmWfTransition("WAITING_APPROVAL", "RUNNING")).toBe(true);
    expect(R.canSmWfTransition("COMPLETED", "RUNNING")).toBe(false);
    expect(R.canSmWfTransition("RETRY_PENDING", "COMPLETED")).toBe(false);
  });

  it("every operator action's from-states can legally reach its target", () => {
    const target = { retry: "RUNNING", resolve: "COMPLETED", cancel: "CANCELLED" } as const;
    for (const [k, a] of Object.entries(R.SM_WF_OPERATOR_ACTIONS)) {
      for (const from of a.from) expect(R.canSmWfTransition(from, target[k as keyof typeof target]), `${k} from ${from}`).toBe(true);
    }
  });

  it("runnable statuses are live and never terminal or waiting for a person", () => {
    for (const s of R.SM_WF_RUNNABLE) {
      expect(R.SM_WF_STATUSES[s].live).toBe(true);
      expect(["NEEDS_ATTENTION", "FAILED", "COMPLETED", "CANCELLED"]).not.toContain(s);
    }
  });
});

describe("error classification", () => {
  it("business errors fail now; lock/connection problems retry", () => {
    expect(classifyError(new BusinessRuleError("VALIDATION_ERROR", "bad"))).toMatchObject({ transient: false, code: "VALIDATION_ERROR" });
    expect(classifyError(new BusinessRuleError("PERMISSION_DENIED", "no"))).toMatchObject({ transient: false });
    expect(classifyError(new Prisma.PrismaClientKnownRequestError("deadlock", { code: "P2034", clientVersion: "x" }))).toMatchObject({ transient: true, code: "DB_P2034" });
    expect(classifyError(new Prisma.PrismaClientKnownRequestError("unique", { code: "P2002", clientVersion: "x" }))).toMatchObject({ transient: false });
    expect(classifyError(new Error("socket hang up"))).toMatchObject({ transient: true, code: "UNEXPECTED" });
  });

  it("never leaks raw messages from unknown or database errors", () => {
    expect(classifyError(new Error("password=hunter2")).message).not.toContain("hunter2");
    expect(classifyError(new Prisma.PrismaClientKnownRequestError("relation secret_table", { code: "P2010", clientVersion: "x" })).message).not.toContain("secret_table");
  });
});

describe("registry ↔ implementations", () => {
  it("each workflow type has an implementation with exactly the registered steps", () => {
    for (const key of R.SM_WORKFLOW_KEYS) {
      const impl = getWorkflowImpl(key);
      expect(impl, key).toBeTruthy();
      expect(Object.keys(impl!.steps).sort(), key).toEqual(R.SM_WORKFLOWS[key].steps.map((s) => s.key).sort());
    }
  });

  it("each type triggers on known events and has defaults that validate", () => {
    for (const key of R.SM_WORKFLOW_KEYS) {
      const def = R.SM_WORKFLOWS[key];
      expect(def.triggers.length).toBeGreaterThan(0);
      for (const t of def.triggers) expect(R.SM_WF_EVENT_TYPES[t as keyof typeof R.SM_WF_EVENT_TYPES], t).toBeTruthy();
      expect(R.SM_WF_ENTITY_TYPES).toContain(def.entityType);
      expect(validateConfig(key, { settings: {}, conditions: { entry: undefined } }).valid, key).toBe(true);
      for (const f of def.settingFields) expect(Object.keys(R.SM_WF_SETTINGS_SCHEMAS[key].parse({})), `${key}.${f.key}`).toContain(f.key);
    }
  });
});

describe("settings and conditions validation", () => {
  it("rejects out-of-range settings and too many users", () => {
    const r = validateConfig("quotation_follow_up", { settings: { quoteDueDays: 0 }, conditions: { entry: undefined } });
    expect(r.valid).toBe(false);
    expect(r.errors[0].path).toBe("settings.quoteDueDays");
    const many = Array.from({ length: R.SM_WF_LIMITS.maxUsersPerList + 1 }, () => crypto.randomUUID());
    expect(validateConfig("budget_exception", { settings: { reviewerUserIds: many }, conditions: { entry: undefined } }).valid).toBe(false);
  });

  it("only allow-listed fields and operators pass", () => {
    const leaf = (field: string, operator: string, value?: unknown) => ({ kind: "condition", field, operator, value });
    const g = (...conditions: unknown[]) => ({ entry: { kind: "group", logic: "AND", conditions } });
    expect(validateConfig("quotation_follow_up", { settings: {}, conditions: g(leaf("enquiry.priority", "eq", "HIGH")) }).valid).toBe(true);
    expect(validateConfig("quotation_follow_up", { settings: {}, conditions: g(leaf("enquiry.internal_notes", "eq", "x")) }).valid).toBe(false);
    expect(validateConfig("quotation_follow_up", { settings: {}, conditions: g(leaf("enquiry.hasCustomer", "contains", "x")) }).valid).toBe(false);
    expect(validateConfig("quotation_follow_up", { settings: {}, conditions: { entry: { kind: "group", logic: "XOR", conditions: [] } } }).valid).toBe(false);
  });
});

describe("event contract", () => {
  const ok = {
    schemaVersion: 1,
    source: "quotation",
    sourceKey: "e1",
    type: "quotation.accepted",
    companyId: crypto.randomUUID(),
    entityType: "QUOTATION",
    entityId: crypto.randomUUID(),
    occurredAt: new Date(),
    actorUserId: null,
    data: { status: "ACCEPTED" },
    keys: [],
  };
  it("accepts a v1 event and rejects anything else", () => {
    expect(R.smWfEventSchema.safeParse(ok).success).toBe(true);
    expect(R.smWfEventSchema.safeParse({ ...ok, schemaVersion: 2 }).success).toBe(false);
    expect(R.smWfEventSchema.safeParse({ ...ok, type: "quotation.deleted" }).success).toBe(false);
    expect(R.smWfEventSchema.safeParse({ ...ok, companyId: "x" }).success).toBe(false);
    expect(R.smWfEventSchema.safeParse({ ...ok, data: { nested: { a: 1 } } }).success).toBe(false);
    expect(R.smWfEventSchema.safeParse({ ...ok, extra: 1 }).success).toBe(false);
  });
});

describe("date helpers", () => {
  const now = new Date("2026-11-05T20:00:00Z"); // 01:30 on 6 Nov in India
  it("business date is Indian", () => {
    expect(istDate(now)).toBe("2026-11-06");
    expect(istDate(now, 2)).toBe("2026-11-08");
  });
  it("next check is the earliest future date, capped", () => {
    const soon = new Date(now.getTime() + 60_000);
    expect(nextCheck(now, 3_600_000, soon, null, new Date(now.getTime() - 1)).getTime()).toBe(soon.getTime());
    expect(nextCheck(now, 3_600_000).getTime()).toBe(now.getTime() + 3_600_000);
    expect(earliest(now, null, undefined)).toBeNull();
  });
});
