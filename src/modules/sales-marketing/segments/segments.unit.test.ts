import { describe, expect, it, vi } from "vitest";

vi.mock("@/core/rbac/PermissionService", () => ({ PermissionService: { can: vi.fn(async () => true), assert: vi.fn(async () => undefined) } }));
vi.mock("@/core/db/client", () => ({ prisma: {} }));

import { describeCondition, validateCondition, validateCriteria, SEGMENT_FIELDS, OPERATORS_BY_TYPE, operatorsFor } from "./segment-registry";
import { availabilityWhere, baseWhere, classifyBatch, consentCheck, consentRestrictedWhere, criteriaWhere, dynamicWheres, hasAddressWhere, type CompiledDefinition, type SegmentAccess } from "./segment-query";
import { definitionHash } from "./segment-common";

const ALL_ACCESS: SegmentAccess = { companyId: "c1", userId: "u1", source: "CONTACT", crmScope: { mode: "ALL" } };
const noDb = {} as never;
const crit = (field: string, operator: string, value?: unknown, match: "ALL" | "ANY" = "ALL") => ({ match: "ALL", groups: [{ match, conditions: [{ field, operator, ...(value === undefined ? {} : { value }) }] }] });

describe("criteria validation (allow-list)", () => {
  it("accepts a valid condition and normalises text", () => {
    expect(validateCondition("CONTACT", { field: "email", operator: "contains", value: "  gmail " })).toEqual({ ok: true, value: "gmail" });
  });
  it("rejects fields that aren't allow-listed, including injection-looking names", () => {
    for (const field of ["passwordHash", "email; DROP TABLE users", "crmCompany.customer.creditLimit", "__proto__"]) {
      expect(validateCondition("CONTACT", { field, operator: "equals", value: "x" }).ok).toBe(false);
    }
  });
  it("rejects operators that don't belong to the field type", () => {
    expect(validateCondition("CONTACT", { field: "createdAt", operator: "contains", value: "x" }).ok).toBe(false);
    expect(validateCondition("LEAD", { field: "score", operator: "starts_with", value: "1" }).ok).toBe(false);
    expect(validateCondition("CONTACT", { field: "email", operator: "raw_sql", value: "1=1" }).ok).toBe(false);
  });
  it("type-checks values", () => {
    expect(validateCondition("LEAD", { field: "score", operator: "gt", value: "50" }).ok).toBe(false);
    expect(validateCondition("LEAD", { field: "score", operator: "between", value: [10, 5] }).ok).toBe(false);
    expect(validateCondition("CONTACT", { field: "createdAt", operator: "before", value: "2026-13-45" }).ok).toBe(false);
    expect(validateCondition("CONTACT", { field: "createdAt", operator: "in_last_days", value: 0 }).ok).toBe(false);
    expect(validateCondition("LEAD", { field: "temperature", operator: "in", value: ["HOT", "BOILING"] }).ok).toBe(false);
    expect(validateCondition("LEAD", { field: "statusId", operator: "in", value: ["not-a-uuid"] }).ok).toBe(false);
    expect(validateCondition("CONTACT", { field: "email", operator: "is_empty" })).toEqual({ ok: true, value: undefined });
  });
  it("collects every issue and flags contradictions in an ALL group", () => {
    const r = validateCriteria("COMPANY", { match: "ALL", groups: [{ match: "ALL", conditions: [{ field: "country", operator: "equals", value: "India" }, { field: "country", operator: "equals", value: "Germany" }, { field: "nope", operator: "equals", value: "x" }] }] });
    expect(r.issues.map((i) => i.condition).sort()).toEqual([1, 2]);
  });
  it("limits groups and rejects unknown keys", () => {
    expect(validateCriteria("CONTACT", { match: "ALL", groups: Array.from({ length: 11 }, () => ({ match: "ALL", conditions: [{ field: "email", operator: "is_empty" }] })) }).issues.length).toBeGreaterThan(0);
    expect(validateCriteria("CONTACT", { match: "ALL", groups: [], sql: "x" }).issues.length).toBeGreaterThan(0);
  });
  it("every field has at least one operator and every lookup field names a lookup", () => {
    for (const fields of Object.values(SEGMENT_FIELDS)) for (const f of fields) {
      expect(operatorsFor(f).length).toBeGreaterThan(0);
      for (const op of operatorsFor(f)) if (!f.operators) expect(OPERATORS_BY_TYPE[f.type]).toContain(op);
      if (f.type === "lookup" || f.type === "tags") expect(f.lookup).toBeTruthy();
    }
  });
  it("describes conditions in words", () => {
    expect(describeCondition("LEAD", { field: "temperature", operator: "in", value: ["HOT"] })).toBe("Temperature is any of Hot");
    expect(describeCondition("CONTACT", { field: "lastActivityAt", operator: "not_in_last_days", value: 30 })).toBe("Last activity not in the last 30 days");
  });
});

describe("query builder", () => {
  it("always scopes to the company, availability and CRM visibility", () => {
    expect(availabilityWhere("CONTACT", "c1")).toEqual({ companyId: "c1", archivedAt: null, mergedIntoId: null });
    expect(availabilityWhere("CUSTOMER", "c1")).toEqual({ companyId: "c1", deletedAt: null, isActive: true });
    const own = baseWhere({ ...ALL_ACCESS, crmScope: { mode: "OWN", userId: "u1" } });
    expect(JSON.stringify(own)).toContain('"ownerUserId":"u1"');
  });
  it("matches text case-insensitively and passes values as parameters", async () => {
    const w = await criteriaWhere(noDb, ALL_ACCESS, crit("email", "equals", "A@B.com' OR '1'='1"));
    expect(w).toEqual({ AND: [{ AND: [{ email: { equals: "A@B.com' OR '1'='1", mode: "insensitive" } }] }] });
  });
  it("negative operators include empty values; relations nest with `is`", async () => {
    const w = await criteriaWhere(noDb, ALL_ACCESS, crit("company.country", "not_equals", "India"));
    const s = JSON.stringify(w);
    expect(s).toContain('"NOT":{"crmCompany":{"is":{"country":{"equals":"India","mode":"insensitive"}}}}');
    expect(s).toContain('{"crmCompany":{"is":null}}');
    expect(s).toContain('{"crmCompany":{"is":{"country":null}}}');
  });
  it("uses business-day boundaries (Asia/Kolkata) for dates", async () => {
    const w = await criteriaWhere(noDb, ALL_ACCESS, crit("createdAt", "on", "2026-11-01"));
    const leaf = (w as { AND: { AND: { createdAt: { gte: Date; lte: Date } }[] }[] }).AND[0].AND[0].createdAt;
    expect(leaf.gte.toISOString()).toBe("2026-10-31T18:30:00.000Z");
    expect(leaf.lte.toISOString()).toBe("2026-11-01T18:29:59.999Z");
  });
  it("combines groups with ANY / ALL and treats zero groups as everyone", async () => {
    expect(await criteriaWhere(noDb, ALL_ACCESS, { match: "ALL", groups: [] })).toEqual({});
    const w = await criteriaWhere(noDb, { ...ALL_ACCESS, source: "LEAD" }, { match: "ANY", groups: [{ match: "ANY", conditions: [{ field: "converted", operator: "is_true" }, { field: "score", operator: "gte", value: 80 }] }] });
    expect(w).toEqual({ OR: [{ OR: [{ convertedAt: { not: null } }, { score: { gte: 80 } }] }] });
  });
  it("refuses an invalid stored definition instead of running it", async () => {
    await expect(criteriaWhere(noDb, ALL_ACCESS, crit("passwordHash", "equals", "x"))).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
  it("builds customer last-order rules on booked orders only", async () => {
    const w = await criteriaWhere(noDb, { ...ALL_ACCESS, source: "CUSTOMER", crmScope: null }, crit("lastOrderDate", "is_empty"));
    expect(JSON.stringify(w)).toContain('"salesOrders":{"none"');
  });
  it("eligibility: address columns per channel, consent only for contacts", () => {
    expect(JSON.stringify(hasAddressWhere("CUSTOMER", "EMAIL"))).toContain("email");
    expect(consentRestrictedWhere("CONTACT", "EMAIL")).toEqual({ consents: { some: { channel: { in: ["EMAIL", "ALL"] }, status: { not: "ALLOWED" } } } });
    expect(consentRestrictedWhere("LEAD", "EMAIL")).toBeNull();
    expect(consentCheck("CONTACT", "EMAIL")).toBe("VERIFIED");
    expect(consentCheck("CUSTOMER", "EMAIL")).toBe("NOT_AVAILABLE");
    expect(consentCheck("CONTACT", null)).toBe("NOT_CHECKED");
  });
  it("dynamic wheres: members = matched minus excluded minus ineligible", () => {
    const def: CompiledDefinition = { access: ALL_ACCESS, segmentType: "DYNAMIC", criteria: { x: 1 }, exclusion: { y: 1 }, manualExclusionIds: ["r1"], channel: "EMAIL" };
    const w = dynamicWheres(def);
    expect(JSON.stringify(w.members)).toContain('"NOT":{"OR":[{"id":{"in":["r1"]}},{"y":1}]}');
    expect(w.ineligible).not.toBeNull();
  });
  it("definition hash ignores key order", () => {
    expect(definitionHash({ criteria: { a: 1, b: 2 }, exclusionCriteria: null, eligibilityChannel: null })).toBe(definitionHash({ eligibilityChannel: null, exclusionCriteria: null, criteria: { b: 2, a: 1 } }));
  });
});

describe("classification (one outcome per record)", () => {
  const rows = (ids: string[]) => ids.map((id) => ({ id }));
  function fakeDb(sets: { available: string[]; visible: string[]; excluded: string[]; withAddress: string[]; restricted: string[] }) {
    const findMany = vi.fn(async ({ where }: { where: { AND?: unknown[] } }) => {
      const s = JSON.stringify(where);
      if (s.includes("consents")) return rows(sets.restricted);
      if (s.includes('"email":{"not":null}')) return rows(sets.withAddress);
      if (s.includes("EXCLUSION")) return rows(sets.excluded);
      if (s.includes("ownerUserId")) return rows(sets.visible);
      return rows(sets.available);
    });
    return { crmContact: { findMany } } as never;
  }
  it("assigns unavailable, not-accessible, manual, rule, address and consent in order", async () => {
    const db = fakeDb({ available: ["b", "c", "d", "e", "f", "g"], visible: ["c", "d", "e", "f", "g"], excluded: ["e"], withAddress: ["f", "g"], restricted: ["g"] });
    const def: CompiledDefinition = { access: { ...ALL_ACCESS, crmScope: { mode: "OWN", userId: "u1" } }, segmentType: "STATIC", criteria: {}, exclusion: { marker: "EXCLUSION" }, manualExclusionIds: ["d"], channel: "EMAIL" };
    const out = await classifyBatch(db, def, ["a", "b", "c", "d", "e", "f", "g"], "STATIC");
    expect(out.map((o) => [o.recordId, o.outcome, o.reason])).toEqual([
      ["a", "EXCLUDED", "SOURCE_UNAVAILABLE"],
      ["b", "EXCLUDED", "NOT_ACCESSIBLE"],
      ["c", "INELIGIBLE", "NO_ADDRESS"],
      ["d", "EXCLUDED", "MANUAL_EXCLUSION"],
      ["e", "EXCLUDED", "EXCLUSION_RULE"],
      ["f", "INCLUDED", null],
      ["g", "INELIGIBLE", "CONSENT_RESTRICTED"],
    ]);
  });
});
