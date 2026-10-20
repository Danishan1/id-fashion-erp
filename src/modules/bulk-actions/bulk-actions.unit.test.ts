import { describe, expect, it, vi, beforeEach } from "vitest";
import { z } from "zod";

const denied = new Set<string>();
vi.mock("@/core/rbac/PermissionService", () => ({
  PermissionService: {
    can: vi.fn(async (userId: string, module: string, action: string) => !denied.has(`${userId}:${module}.${action}`)),
    assert: vi.fn(async () => undefined),
  },
}));

import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { createBulkJobSchema, bulkSelectionSchema, parseBulkJobFilters } from "./bulk-job.schema";
import { __resetBulkRegistryForTests, getAvailableActions, getHandler, registerAction, registerEntity } from "./bulk-registry";
import { BulkItemError, buildSafeCsv, sanitizeSpreadsheetCell, toSafeItemError } from "./bulk-safety";
import type { BulkEntityDefinition } from "./bulk-types";

const entity = (entityType: string): BulkEntityDefinition => ({
  entityType,
  label: entityType,
  pluralLabel: `${entityType}s`,
  viewPermission: { module: "crm", action: "view" },
  adminPermission: { module: "crm_settings", action: "edit" },
  parseFilterQuery: () => ({}),
  resolveFilterIds: async () => ({ ids: [], total: 0 }),
  visibleIds: async () => new Set(),
  recordLabels: async () => new Map(),
  recordHref: (id) => `/x/${id}`,
  listHref: "/x",
});

describe("spreadsheet formula-injection protection", () => {
  it.each([
    ["=1+1", "'=1+1"],
    ["+91 98765", "'+91 98765"],
    ["-5", "'-5"],
    ["@SUM(A1)", "'@SUM(A1)"],
    ["\tcmd", "'\tcmd"],
    ["\r=x", "'\r=x"],
    ["Rahul", "Rahul"],
    ["a=b", "a=b"],
  ])("%j → %j", (input, out) => {
    expect(sanitizeSpreadsheetCell(input)).toBe(out);
  });

  it("keeps numbers, dates and nulls as values; booleans and arrays as text", () => {
    const d = new Date("2026-10-13T00:00:00Z");
    expect(sanitizeSpreadsheetCell(-5)).toBe(-5);
    expect(sanitizeSpreadsheetCell(d)).toBe(d);
    expect(sanitizeSpreadsheetCell(null)).toBeNull();
    expect(sanitizeSpreadsheetCell(undefined)).toBeNull();
    expect(sanitizeSpreadsheetCell(true)).toBe("Yes");
    expect(sanitizeSpreadsheetCell(["=a", "b"])).toBe("'=a, b");
  });

  it("CSV quotes commas, quotes and line breaks (CRLF rows, UTF-8 BOM)", () => {
    const csv = buildSafeCsv(["Name", "Note"], [[sanitizeSpreadsheetCell('=HYPERLINK("x")'), "a,b\r\nc"]]).toString("utf8");
    expect(csv).toBe('﻿Name,Note\r\n"\'=HYPERLINK(""x"")","a,b\r\nc"\r\n');
  });
});

describe("user-safe item errors", () => {
  it("passes business messages through and hides unexpected ones", () => {
    expect(toSafeItemError(new BusinessRuleError("INVALID_STATE_TRANSITION", "Reopen it first."))).toEqual({ code: "INVALID_STATE_TRANSITION", message: "Reopen it first.", unexpected: false });
    expect(toSafeItemError(new BulkItemError("Gone.", "NOT_FOUND"))).toMatchObject({ code: "NOT_FOUND", message: "Gone." });
    const zod = z.object({ a: z.number() }).safeParse({ a: "x" });
    expect(toSafeItemError(zod.error)).toMatchObject({ code: "VALIDATION_ERROR", unexpected: false });
    const raw = toSafeItemError(new Error('relation "crm_leads" does not exist at Pool.query (/srv/node_modules/pg)'));
    expect(raw.code).toBe("UNEXPECTED");
    expect(raw.unexpected).toBe(true);
    expect(raw.message).not.toMatch(/crm_leads|node_modules/);
    // A reused workflow action error with an UNEXPECTED code also wraps raw text → generic.
    const wf = Object.assign(new Error("ECONNRESET 10.0.0.5:5432"), { name: "WorkflowActionError", code: "UNEXPECTED" });
    expect(toSafeItemError(wf).message).not.toContain("10.0.0.5");
    const wf2 = Object.assign(new Error("The contact has no SMS conversation yet."), { name: "WorkflowActionError", code: "NO_CONVERSATION" });
    expect(toSafeItemError(wf2)).toMatchObject({ code: "NO_CONVERSATION", message: "The contact has no SMS conversation yet." });
  });
});

describe("request schemas", () => {
  it("accepts the three selection modes and nothing else", () => {
    const id = "6b0f5a8e-2b4c-4d7e-9f10-1a2b3c4d5e6f";
    expect(bulkSelectionSchema.parse({ mode: "IDS", ids: [id] })).toEqual({ mode: "IDS", ids: [id] });
    expect(bulkSelectionSchema.parse({ mode: "PAGE", ids: [id] }).mode).toBe("PAGE");
    expect(bulkSelectionSchema.parse({ mode: "FILTER", filterQuery: "search=x" }).mode).toBe("FILTER");
    expect(() => bulkSelectionSchema.parse({ mode: "ALL" })).toThrow();
    expect(() => bulkSelectionSchema.parse({ mode: "IDS", ids: ["not-a-uuid"] })).toThrow();
    expect(() => bulkSelectionSchema.parse({ mode: "IDS", ids: [] })).toThrow();
    expect(() => bulkSelectionSchema.parse({ mode: "FILTER", filterQuery: "x", where: { id: 1 } })).toThrow();
    expect(() => bulkSelectionSchema.parse({ mode: "PAGE", ids: Array(501).fill(id) })).toThrow();
  });

  it("rejects unknown top-level keys (no table / service names can be smuggled in)", () => {
    expect(() => createBulkJobSchema.parse({ entityType: "LEAD", actionKey: "lead.assign", selection: { mode: "FILTER", filterQuery: "" }, params: {}, table: "crm_leads" })).toThrow();
  });

  it("parses list filters", () => {
    expect(parseBulkJobFilters(new URLSearchParams("statuses=RUNNING,FAILED&mine=true&entityType=LEAD"))).toEqual({ statuses: ["RUNNING", "FAILED"], mine: true, entityType: "LEAD" });
    expect(() => parseBulkJobFilters(new URLSearchParams("statuses=DROP TABLE"))).toThrow();
  });
});

describe("registry", () => {
  beforeEach(() => {
    __resetBulkRegistryForTests();
    denied.clear();
    registerEntity(entity("THING"));
    registerEntity(entity("OTHER"));
  });

  const base = { kind: "update" as const, label: "Do", description: "d", paramsSchema: z.object({}).strict(), confirmation: "none" as const, retrySafe: true, cancellable: true, maxItems: 10 };

  it("validates registrations", () => {
    expect(() => registerEntity(entity("THING"))).toThrow(/already/);
    expect(() => registerEntity(entity("bad name"))).toThrow(/Invalid/);
    expect(() => registerAction({ ...base, key: "Thing.Do", entityType: "THING", permissions: [], executeItem: async () => ({ status: "SUCCEEDED" }) })).toThrow(/Invalid/);
    expect(() => registerAction({ ...base, key: "thing.do", entityType: "NOPE", permissions: [], executeItem: async () => ({ status: "SUCCEEDED" }) })).toThrow(/not registered/);
    expect(() => registerAction({ ...base, key: "thing.do", entityType: "THING", permissions: [] })).toThrow(/executeItem/);
    registerAction({ ...base, key: "thing.do", entityType: "THING", permissions: [], executeItem: async () => ({ status: "SUCCEEDED" }) });
    expect(() => registerAction({ ...base, key: "thing.do", entityType: "THING", permissions: [], executeItem: async () => ({ status: "SUCCEEDED" }) })).toThrow(/already/);
  });

  it("getHandler only returns an action for its own entity", () => {
    registerAction({ ...base, key: "thing.do", entityType: "THING", permissions: [], executeItem: async () => ({ status: "SUCCEEDED" }) });
    expect(getHandler("THING", "thing.do")?.key).toBe("thing.do");
    expect(getHandler("OTHER", "thing.do")).toBeNull();
    expect(getHandler("THING", "thing.nope")).toBeNull();
  });

  it("capabilities: availability by permission, static reasons, fields only for available actions, nothing without view", async () => {
    registerAction({ ...base, key: "thing.edit", entityType: "THING", permissions: [{ module: "crm", action: "edit" }], fields: async () => [{ key: "x", label: "X", type: "text" }], executeItem: async () => ({ status: "SUCCEEDED" }) });
    registerAction({ ...base, key: "thing.later", entityType: "THING", permissions: [], unavailableReason: "Not built yet." });
    registerAction({ ...base, key: "thing.cfg", entityType: "THING", permissions: [], availability: async () => ({ available: false, reason: "Configure it first." }), executeItem: async () => ({ status: "SUCCEEDED" }) });
    const actor = { companyId: "c", userId: "u", branchId: null };
    let caps = await getAvailableActions(actor, "THING");
    expect(caps.map((c) => [c.key, c.available, c.unavailableReason])).toEqual([
      ["thing.edit", true, null],
      ["thing.later", false, "Not built yet."],
      ["thing.cfg", false, "Configure it first."],
    ]);
    expect(caps[0].fields).toHaveLength(1);
    denied.add("u:crm.edit");
    caps = await getAvailableActions(actor, "THING");
    expect(caps[0].available).toBe(false);
    expect(caps[0].unavailableReason).toMatch(/crm\.edit/);
    expect(caps[0].fields).toEqual([]);
    denied.add("u:crm.view");
    expect(await getAvailableActions(actor, "THING")).toEqual([]);
    expect(await getAvailableActions(actor, "UNKNOWN")).toEqual([]);
  });
});
