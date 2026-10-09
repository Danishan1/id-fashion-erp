import { describe, expect, it, vi } from "vitest";

vi.mock("@/core/db/client", () => ({ prisma: {} }));
vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/core/rbac/PermissionService", () => ({ PermissionService: { can: vi.fn(async () => true) } }));
vi.mock("@/core/numbering/DocumentNumberingService", () => ({ generateDocumentNumber: vi.fn() }));

const { bulkOpportunitySchema, changeStageSchema, createOpportunitySchema, opportunityFilterToParams, parseOpportunityFilterParams, updateOpportunitySchema, changeOpportunityStatusSchema, linkErpDocumentSchema } = await import("./opportunity.schema");
const { buildOpportunityOrderBy, buildOpportunityWhere, closeDueRange } = await import("./opportunity-filters");
const { canTransition, isClosedStatus, OPPORTUNITY_STATUS_TRANSITIONS, STATUS_EVENT, DEFAULT_PIPELINE, ERP_DOC_TYPE_KEYS } = await import("./opportunity-registry");
const { nextProbability, opportunitySearchText } = await import("./crm-opportunities.service");
const { CRM_EVENT_TYPES } = await import("../core/crm-event-types");

const A = "6f1c2f1e-1f2a-4b1a-9d1a-2b3c4d5e6f70";
const B = "7f1c2f1e-1f2a-4b1a-9d1a-2b3c4d5e6f71";
const NOW = new Date("2026-10-15T06:00:00.000Z"); // 11:30 IST on 15 Oct

describe("opportunity schema", () => {
  it("accepts probability 0 and 100 and rejects anything outside 0–100 or fractional", () => {
    expect(createOpportunitySchema.parse({ name: "Deal", probability: 0 }).probability).toBe(0);
    expect(createOpportunitySchema.parse({ name: "Deal", probability: "100" }).probability).toBe(100);
    expect(createOpportunitySchema.parse({ name: "Deal", probability: "" }).probability).toBeNull();
    for (const bad of [-1, 101, "150", 12.5, "abc"]) expect(createOpportunitySchema.safeParse({ name: "Deal", probability: bad }).success).toBe(false);
    expect(changeStageSchema.safeParse({ stageId: A, probability: 101 }).success).toBe(false);
  });

  it("validates the estimated value and currency", () => {
    expect(createOpportunitySchema.parse({ name: "Deal", amount: "125000.50" }).amount).toBe(125000.5);
    expect(createOpportunitySchema.parse({ name: "Deal", amount: "" }).amount).toBeNull();
    expect(createOpportunitySchema.safeParse({ name: "Deal", amount: -5 }).success).toBe(false);
    expect(createOpportunitySchema.safeParse({ name: "Deal", amount: "1,000" }).success).toBe(false);
    expect(createOpportunitySchema.safeParse({ name: "Deal", currencyCode: "RUPEES" }).success).toBe(false);
    expect(createOpportunitySchema.parse({ name: "Deal", currencyCode: "inr" }).currencyCode).toBe("INR");
    expect(createOpportunitySchema.safeParse({ name: " " }).success).toBe(false);
  });

  it("never lets status or the lead link change through edit", () => {
    expect(updateOpportunitySchema.safeParse({ version: 1, name: "X" }).success).toBe(true);
    expect(updateOpportunitySchema.safeParse({ version: 1, status: "WON" }).success).toBe(false);
    expect(updateOpportunitySchema.safeParse({ version: 1, leadId: A }).success).toBe(false);
    expect(updateOpportunitySchema.safeParse({ name: "X" }).success).toBe(false);
  });

  it("validates status, ERP link and bulk inputs", () => {
    expect(changeOpportunityStatusSchema.safeParse({ status: "WON", reason: "Price" }).success).toBe(true);
    expect(changeOpportunityStatusSchema.safeParse({ status: "CLOSED" }).success).toBe(false);
    expect(linkErpDocumentSchema.safeParse({ docType: "SALES_ORDER", docId: A }).success).toBe(true);
    expect(linkErpDocumentSchema.safeParse({ docType: "QUOTATION", docId: A }).success).toBe(false);
    expect(bulkOpportunitySchema.safeParse({ action: "stage", ids: [A], stageId: B }).success).toBe(true);
    expect(bulkOpportunitySchema.safeParse({ action: "delete", ids: [A] }).success).toBe(false);
    // Phase 08 bulk field update: only safe fields, at least one of them.
    expect(bulkOpportunitySchema.safeParse({ action: "update", ids: [A], fields: { expectedCloseDate: "2026-12-31" } }).success).toBe(true);
    expect(bulkOpportunitySchema.safeParse({ action: "update", ids: [A], fields: { sourceId: null, customFields: { fabric: "linen" } } }).success).toBe(true);
    expect(bulkOpportunitySchema.safeParse({ action: "update", ids: [A], fields: {} }).success).toBe(false);
    for (const unsafe of [{ amount: "5" }, { ownerUserId: B }, { stageId: B }, { status: "WON" }, { name: "x" }])
      expect(bulkOpportunitySchema.safeParse({ action: "update", ids: [A], fields: unsafe }).success).toBe(false);
  });
});

describe("opportunity filters", () => {
  it("round-trips the flat query format including number ranges", () => {
    const sp = new URLSearchParams({ stageIds: `${A},${B}`, statuses: "OPEN,WON", amountMin: "1000", amountMax: "50000", probabilityMin: "25", expectedCloseDateFrom: "2026-10-01", closeDue: "next_30_days", fromLead: "yes", archived: "include" });
    const f = parseOpportunityFilterParams(sp);
    expect(f).toMatchObject({ stageIds: [A, B], statuses: ["OPEN", "WON"], amount: { min: 1000, max: 50000 }, probability: { min: 25 }, expectedCloseDate: { from: "2026-10-01" }, closeDue: "next_30_days", fromLead: "yes", archived: "include" });
    expect(parseOpportunityFilterParams(new URLSearchParams(opportunityFilterToParams(f)))).toEqual(f);
  });

  it("rejects invalid filters", () => {
    expect(() => parseOpportunityFilterParams(new URLSearchParams({ statuses: "MAYBE" }))).toThrow();
    expect(() => parseOpportunityFilterParams(new URLSearchParams({ probabilityMax: "150" }))).toThrow();
    expect(() => parseOpportunityFilterParams(new URLSearchParams({ amountMin: "10", amountMax: "5" }))).toThrow();
    expect(() => parseOpportunityFilterParams(new URLSearchParams({ amountMin: "lots" }))).toThrow();
  });

  it("always scopes to the tenant and applies visibility and archive state", () => {
    const where = buildOpportunityWhere("co-1", parseOpportunityFilterParams(new URLSearchParams()), { mode: "OWN", userId: "u1" });
    const and = (where.AND as object[]).map((x) => JSON.stringify(x));
    expect(and[0]).toBe(JSON.stringify({ companyId: "co-1" }));
    expect(and).toContain(JSON.stringify({ archivedAt: null }));
    expect(and.some((x) => x.includes("u1"))).toBe(true);
  });

  it("searches the opportunity, its company and contact (incl. phone digits) server-side", () => {
    const w = JSON.stringify(buildOpportunityWhere("co-1", parseOpportunityFilterParams(new URLSearchParams({ search: "98765 43210" })), { mode: "ALL" }));
    expect(JSON.stringify(buildOpportunityWhere("co-1", parseOpportunityFilterParams(new URLSearchParams({ search: "Ravi" })), { mode: "ALL" }))).toContain('"owner":{"fullName":{"contains":"ravi","mode":"insensitive"}}');
    expect(w).toContain('"searchText":{"contains":"98765 43210"}');
    expect(w).toContain('"crmCompany":{"searchText"');
    expect(w).toContain('"crmContact":{"phoneKeys":{"has":"9876543210"}}');
    expect(JSON.stringify(buildOpportunityWhere("co-1", parseOpportunityFilterParams(new URLSearchParams({ search: A })), { mode: "ALL" }))).toContain(`"id":"${A}"`);
  });

  it("works out 'closing' shortcuts in the business time zone and only for open deals", () => {
    expect(closeDueRange("overdue", NOW)).toEqual({ to: "2026-10-14" });
    expect(closeDueRange("next_7_days", NOW)).toEqual({ from: "2026-10-15", to: "2026-10-22" });
    expect(closeDueRange("this_month", NOW)).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    // 23:00 UTC on 15 Oct is already 16 Oct in India
    expect(closeDueRange("overdue", new Date("2026-10-15T23:00:00.000Z"))).toEqual({ to: "2026-10-15" });
    const w = JSON.stringify(buildOpportunityWhere("co-1", parseOpportunityFilterParams(new URLSearchParams({ closeDue: "overdue" })), { mode: "ALL" }, undefined, NOW));
    expect(w).toContain('{"status":"OPEN"}');
    expect(w).toContain('"expectedCloseDate":{"lte":"2026-10-14T00:00:00.000Z"}');
  });

  it("filters value and probability ranges and matches tags by ids", () => {
    const w = JSON.stringify(buildOpportunityWhere("co-1", parseOpportunityFilterParams(new URLSearchParams({ amountMin: "1000", probabilityMax: "50", tagIds: A })), { mode: "ALL" }, [B]));
    expect(w).toContain('"amount":{"gte":1000}');
    expect(w).toContain('"probability":{"lte":50}');
    expect(w).toContain(`"id":{"in":["${B}"]}`);
  });

  it("sorts by stage order or nullable columns with empties last", () => {
    expect(buildOpportunityOrderBy("stage", "asc")).toEqual([{ stage: { sortOrder: "asc" } }, { id: "asc" }]);
    expect(buildOpportunityOrderBy("expectedCloseDate", "asc")).toEqual([{ expectedCloseDate: { sort: "asc", nulls: "last" } }, { id: "asc" }]);
    expect(buildOpportunityOrderBy("name", "desc")).toEqual([{ name: "desc" }, { id: "desc" }]);
    expect(buildOpportunityOrderBy("owner", "asc")).toEqual([{ owner: { fullName: "asc" } }, { id: "asc" }]);
  });
});

describe("status and stage rules", () => {
  it("lets open deals close any way and closed deals only reopen", () => {
    expect(canTransition("OPEN", "WON")).toBe(true);
    expect(canTransition("OPEN", "ABANDONED")).toBe(true);
    expect(canTransition("WON", "OPEN")).toBe(true);
    expect(canTransition("WON", "LOST")).toBe(false);
    expect(canTransition("LOST", "ABANDONED")).toBe(false);
    expect(isClosedStatus("OPEN")).toBe(false);
    expect(isClosedStatus("ABANDONED")).toBe(true);
    for (const s of Object.keys(OPPORTUNITY_STATUS_TRANSITIONS)) expect(CRM_EVENT_TYPES).toHaveProperty(STATUS_EVENT[s as keyof typeof STATUS_EVENT]);
  });

  it("applies the stage's default probability unless the user set their own", () => {
    expect(nextProbability(10, 10, 25)).toBe(25); // followed the old stage default
    expect(nextProbability(null, 10, 25)).toBe(25);
    expect(nextProbability(40, 10, 25)).toBe(40); // manual value kept
    expect(nextProbability(40, 10, 25, 60)).toBe(60); // explicit wins
    expect(nextProbability(40, 10, 25, null)).toBeNull();
    expect(nextProbability(10, 10, null)).toBe(10);
  });

  it("ships a default pipeline whose stage probabilities rise from 0 to 100", () => {
    const p = DEFAULT_PIPELINE.stages.map((s) => s.probability);
    expect(p).toEqual([...p].sort((a, b) => a - b));
    expect(p.every((v) => v >= 0 && v <= 100)).toBe(true);
    expect(ERP_DOC_TYPE_KEYS).not.toContain("QUOTATION");
  });

  it("builds search text from number, name and linked ERP document numbers", () => {
    expect(opportunitySearchText({ opportunityNumber: "OPP-2026-00001", name: " AW26 Knitwear " }, ["SO-0042"])).toBe("opp-2026-00001 aw26 knitwear so-0042");
  });
});
