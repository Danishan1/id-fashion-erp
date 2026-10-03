import { describe, expect, it, vi } from "vitest";

vi.mock("@/core/db/client", () => ({ prisma: {} }));
vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/core/rbac/PermissionService", () => ({ PermissionService: { can: vi.fn(async () => true) } }));

const { companyDerivedFields, companyMatchKey, normaliseWebsite, websiteKey } = await import("./company-keys");
const { assertCompanyDuplicatesAllowed, evaluateCompanyCandidates } = await import("./company-duplicates");
const { conflictingCustomFields, conflictingFields, resolveCompanyChoices } = await import("./company-merge.service");
const { buildCompanyOrderBy, buildCompanyWhere } = await import("./company-filters");
const { bulkCompanySchema, companyFilterToParams, createCompanySchema, mergeCompaniesSchema, parseCompanyFilterParams, updateCompanySchema, COMPANY_MERGE_FIELDS } = await import("./company.schema");
const { DEFAULT_COMPANY_DUPLICATE_RULES, DEFAULT_COMPANY_STATUSES, COMPANY_FUTURE_SECTIONS } = await import("./company-registry");

const A = "6f1c2f1e-1f2a-4b1a-9d1a-2b3c4d5e6f70";
const B = "7f1c2f1e-1f2a-4b1a-9d1a-2b3c4d5e6f71";
const CU = "8f1c2f1e-1f2a-4b1a-9d1a-2b3c4d5e6f72";

describe("company keys", () => {
  it("normalises names for matching: case, punctuation, '&', 'The' and legal suffixes", () => {
    expect(companyMatchKey("The ABC Exports Pvt. Ltd.")).toBe("abc exports");
    expect(companyMatchKey("abc  exports private limited")).toBe("abc exports");
    expect(companyMatchKey("ABC-Exports LLP")).toBe("abc exports");
    expect(companyMatchKey("Smith & Sons Co")).toBe("smith and sons");
    expect(companyMatchKey("Müller & Söhne GmbH")).toBe("müller and söhne");
    expect(companyMatchKey(null)).toBe("");
    // A name that is only a suffix keeps something to compare.
    expect(companyMatchKey("Limited Editions")).toBe("limited editions");
  });

  it("reduces websites to their domain and normalises links", () => {
    expect(websiteKey("https://www.ABC.com/about?x=1")).toBe("abc.com");
    expect(websiteKey("abc.com")).toBe("abc.com");
    expect(websiteKey("  ")).toBeNull();
    expect(normaliseWebsite("abc.com")).toBe("https://abc.com");
    expect(normaliseWebsite("http://Shop.ABC.in/")).toBe("http://shop.abc.in");
    expect(normaliseWebsite("")).toBeNull();
    expect(() => normaliseWebsite("not a site")).toThrow();
  });

  it("derives match keys and search text, including the linked ERP customer's code", () => {
    const d = companyDerivedFields(
      { name: "ABC Exports Pvt Ltd", legalName: "ABC Exports Private Limited", website: "https://abc.com", email: "Info@ABC.com", phone: "044 2345 6789", mobile: "+91 98765 43210", city: "Tiruppur" },
      { code: "CUS-0001", name: "ABC Exports" }
    );
    expect(d.nameMatchKey).toBe("abc exports");
    expect(d.legalMatchKey).toBe("abc exports");
    expect(d.websiteKey).toBe("abc.com");
    expect(d.emailKeys).toEqual(["info@abc.com"]);
    expect(d.phoneKeys).toEqual(["4423456789", "9876543210"]);
    expect(d.searchText).toContain("cus-0001");
    expect(d.searchText).toContain("tiruppur");
  });
});

const candidate = (over: Partial<Parameters<typeof evaluateCompanyCandidates>[0][number]> = {}) => ({
  id: B,
  name: "ABC Exports",
  legalName: null,
  nameMatchKey: "abc exports",
  legalMatchKey: null,
  website: "https://abc.com",
  websiteKey: "abc.com",
  email: "info@abc.com",
  phone: "9876543210",
  mobile: null,
  city: "Tiruppur",
  emailKeys: ["info@abc.com"],
  phoneKeys: ["9876543210"],
  customerId: null,
  ownerUserId: null,
  createdByUserId: "u1",
  archivedAt: null,
  owner: null,
  customer: null,
  ...over,
});
const keys = (over: Partial<Parameters<typeof evaluateCompanyCandidates>[1]> = {}) => ({
  nameMatchKey: "abc exports",
  legalMatchKey: null,
  websiteKey: null,
  emailKeys: [],
  phoneKeys: [],
  customerId: null,
  ...over,
});

describe("company duplicate rules", () => {
  it("warns by default on every signal and never blocks out of the box", () => {
    expect(DEFAULT_COMPANY_DUPLICATE_RULES.every((r) => r.action === "WARN")).toBe(true);
    const r = evaluateCompanyCandidates([candidate()], keys({ websiteKey: "abc.com", emailKeys: ["info@abc.com"], phoneKeys: ["9876543210"] }), DEFAULT_COMPANY_DUPLICATE_RULES);
    expect(r.matches).toHaveLength(1);
    expect(r.matches[0].rules).toEqual(["NAME", "WEBSITE", "EMAIL", "PHONE"]);
    expect(r.matches[0].action).toBe("WARN");
    expect(r).toMatchObject({ blocking: false, needsConfirmation: true, flaggedIds: [] });
  });

  it("matches legal names against names in both directions", () => {
    const r = evaluateCompanyCandidates([candidate({ nameMatchKey: "abc", legalMatchKey: "abc exports" })], keys({ nameMatchKey: "abc exports" }), DEFAULT_COMPANY_DUPLICATE_RULES);
    expect(r.matches[0].rules).toEqual(["LEGAL_NAME"]);
    const r2 = evaluateCompanyCandidates([candidate({ nameMatchKey: "abc exports" })], keys({ nameMatchKey: "abc", legalMatchKey: "abc exports" }), DEFAULT_COMPANY_DUPLICATE_RULES);
    expect(r2.matches[0].rules).toEqual(["LEGAL_NAME"]);
  });

  it("applies the strictest configured action and ignores rules that are off", () => {
    const rules = [
      { rule: "NAME" as const, action: "FLAG" as const },
      { rule: "WEBSITE" as const, action: "BLOCK" as const },
      { rule: "EMAIL" as const, action: "OFF" as const },
    ];
    expect(evaluateCompanyCandidates([candidate()], keys(), rules)).toMatchObject({ blocking: false, needsConfirmation: false, flaggedIds: [B] });
    expect(evaluateCompanyCandidates([candidate()], keys({ websiteKey: "abc.com" }), rules).matches[0].action).toBe("BLOCK");
    expect(evaluateCompanyCandidates([candidate({ nameMatchKey: "x" })], keys({ nameMatchKey: "y", emailKeys: ["info@abc.com"] }), rules).matches).toHaveLength(0);
  });

  it("always blocks a second company for the same ERP customer, whatever the rules say", () => {
    const off = DEFAULT_COMPANY_DUPLICATE_RULES.map((r) => ({ ...r, action: "OFF" as const }));
    const r = evaluateCompanyCandidates([candidate({ customerId: CU, nameMatchKey: "other" })], keys({ customerId: CU }), off);
    expect(r.matches[0]).toMatchObject({ rules: ["ERP_CUSTOMER"], action: "BLOCK" });
    expect(() => assertCompanyDuplicatesAllowed(r, true)).toThrow(/already linked/);
  });

  it("refuses warnings until confirmed and keeps the conversion error code", () => {
    const r = evaluateCompanyCandidates([candidate()], keys(), DEFAULT_COMPANY_DUPLICATE_RULES);
    expect(() => assertCompanyDuplicatesAllowed(r, false)).toThrow(expect.objectContaining({ code: "CRM_POSSIBLE_DUPLICATE" }));
    expect(() => assertCompanyDuplicatesAllowed(r, false, "CRM_DUPLICATE_RECORD")).toThrow(expect.objectContaining({ code: "CRM_DUPLICATE_RECORD" }));
    expect(() => assertCompanyDuplicatesAllowed(r, true)).not.toThrow();
  });
});

const company = () =>
  Object.fromEntries(COMPANY_MERGE_FIELDS.map((f) => [f, null])) as Record<(typeof COMPANY_MERGE_FIELDS)[number], string | null> & Record<string, unknown>;

describe("company merge helpers", () => {
  it("only treats two different non-empty values as a conflict (case-insensitive)", () => {
    const s = { ...company(), name: "ABC Exports", website: "https://abc.com", city: "Tiruppur", email: null };
    const m = { ...company(), name: "abc exports", website: "https://abc.in", city: null, email: "info@abc.com" };
    expect(conflictingFields(s, m)).toEqual(["website"]);
  });

  it("fills blanks from the merged company and requires a choice for each conflict", () => {
    const s = { ...company(), name: "ABC", website: "https://abc.com", city: null };
    const m = { ...company(), name: "ABC", website: "https://abc.in", city: "Tiruppur" };
    const first = resolveCompanyChoices(s, m, {});
    expect(first.missing).toEqual(["website"]);
    expect(first.resolved.city).toBe("merged");
    expect(first.resolved.name).toBe("survivor");
    const chosen = resolveCompanyChoices(s, m, { website: "merged" });
    expect(chosen.missing).toEqual([]);
    expect(chosen.resolved.website).toBe("merged");
  });

  it("lists custom fields that differ on both sides", () => {
    expect(conflictingCustomFields({ tier: "A", region: "South" }, { tier: "B", region: "", moq: 500 })).toEqual(["tier"]);
  });

  it("validates the merge request", () => {
    expect(mergeCompaniesSchema.safeParse({ survivorId: A, mergedId: A, survivorVersion: 1, mergedVersion: 1 }).success).toBe(false);
    expect(mergeCompaniesSchema.safeParse({ survivorId: A, mergedId: B, survivorVersion: 1, mergedVersion: 2, fieldChoices: { website: "merged" } }).success).toBe(true);
    expect(mergeCompaniesSchema.safeParse({ survivorId: A, mergedId: B, survivorVersion: 1, mergedVersion: 2, fieldChoices: { customerId: "merged" } }).success).toBe(false);
  });
});

describe("company filters", () => {
  it("round-trips the flat query format", () => {
    const sp = new URLSearchParams({ search: "abc", statusIds: `${A},${B}`, erpCustomer: "linked", fromLead: "yes", city: "Tiruppur", createdAtFrom: "2026-10-01", duplicateFlagged: "true", archived: "include" });
    const f = parseCompanyFilterParams(sp);
    expect(f).toMatchObject({ search: "abc", statusIds: [A, B], erpCustomer: "linked", fromLead: "yes", city: "Tiruppur", createdAt: { from: "2026-10-01" }, duplicateFlagged: true, archived: "include" });
    // The search box is kept outside the filter params (as for leads and contacts).
    expect(parseCompanyFilterParams(new URLSearchParams({ ...companyFilterToParams(f), search: "abc" }))).toEqual(f);
  });

  it("rejects invalid filters", () => {
    expect(() => parseCompanyFilterParams(new URLSearchParams({ statusIds: "nope" }))).toThrow();
    expect(() => parseCompanyFilterParams(new URLSearchParams({ createdAtFrom: "2026-10-05", createdAtTo: "2026-10-01" }))).toThrow();
  });

  it("always scopes to the company, hides merged companies and applies visibility", () => {
    const where = buildCompanyWhere("co-1", parseCompanyFilterParams(new URLSearchParams()), { mode: "OWN", userId: "u1" });
    const and = (where.AND as object[]).map((x) => JSON.stringify(x));
    expect(and[0]).toBe(JSON.stringify({ companyId: "co-1" }));
    expect(and).toContain(JSON.stringify({ mergedIntoId: null }));
    expect(and).toContain(JSON.stringify({ archivedAt: null }));
    expect(and.some((x) => x.includes("u1"))).toBe(true);
  });

  it("searches text, ERP customer code, id and phone digits", () => {
    const phone = JSON.stringify(buildCompanyWhere("co-1", parseCompanyFilterParams(new URLSearchParams({ search: "98765 43210" })), { mode: "ALL" }));
    expect(phone).toContain('"phoneKeys":{"has":"9876543210"}');
    const code = JSON.stringify(buildCompanyWhere("co-1", parseCompanyFilterParams(new URLSearchParams({ search: "CUS-0001" })), { mode: "ALL" }));
    expect(code).toContain('"code":{"equals":"cus-0001"');
    expect(code).not.toContain("phoneKeys");
    expect(JSON.stringify(buildCompanyWhere("co-1", parseCompanyFilterParams(new URLSearchParams({ search: A })), { mode: "ALL" }))).toContain(`"id":"${A}"`);
  });

  it("matches location filters on the company or any of its addresses, and tag filters by matched ids", () => {
    const w = JSON.stringify(buildCompanyWhere("co-1", parseCompanyFilterParams(new URLSearchParams({ city: "Tiruppur", tagIds: A })), { mode: "ALL" }, [B]));
    expect(w).toContain('"addresses":{"some":{"city"');
    expect(w).toContain(`"id":{"in":["${B}"]}`);
  });

  it("sorts nullable columns with empties last and breaks ties by id", () => {
    expect(buildCompanyOrderBy("lastActivityAt", "desc")).toEqual([{ lastActivityAt: { sort: "desc", nulls: "last" } }, { id: "desc" }]);
    expect(buildCompanyOrderBy("name", "asc")).toEqual([{ name: "asc" }, { id: "asc" }]);
  });
});

describe("company schemas and registry", () => {
  it("requires a name and validates contact details", () => {
    expect(createCompanySchema.safeParse({ name: " " }).success).toBe(false);
    expect(createCompanySchema.safeParse({ name: "ABC", email: "nope" }).success).toBe(false);
    expect(createCompanySchema.safeParse({ name: "ABC", phone: "abc" }).success).toBe(false);
    expect(createCompanySchema.safeParse({ name: "ABC", customerId: CU, tagNames: ["Key account"], addresses: [{ addressType: "OFFICE", line1: "1 Main Rd" }] }).success).toBe(true);
  });

  it("rejects unknown fields on update so the ERP link can't be changed through edit", () => {
    expect(updateCompanySchema.safeParse({ version: 1, name: "X" }).success).toBe(true);
    expect(updateCompanySchema.safeParse({ version: 1, customerId: CU }).success).toBe(false);
    expect(updateCompanySchema.safeParse({ name: "X" }).success).toBe(false);
  });

  it("validates bulk actions", () => {
    expect(bulkCompanySchema.safeParse({ action: "status", ids: [A], statusId: B }).success).toBe(true);
    expect(bulkCompanySchema.safeParse({ action: "delete", ids: [A] }).success).toBe(false);
    expect(bulkCompanySchema.safeParse({ action: "archive", ids: [] }).success).toBe(false);
  });

  it("ships one default status and honest placeholders for missing modules", () => {
    expect(DEFAULT_COMPANY_STATUSES.filter((s) => s.isDefault)).toHaveLength(1);
    expect(DEFAULT_COMPANY_STATUSES.map((s) => s.key)).toContain("customer");
    expect(COMPANY_FUTURE_SECTIONS.map((s) => s.key)).toEqual(expect.arrayContaining(["activities", "tickets"]));
  });
});
