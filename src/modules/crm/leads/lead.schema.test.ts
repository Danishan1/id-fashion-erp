import { describe, expect, it } from "vitest";
import { bulkLeadSchema, BULK_LEAD_LIMIT, convertLeadSchema, createLeadSchema, leadFilterToParams, parseLeadFilterParams, updateLeadSchema } from "./lead.schema";

const A = "6f1c2f1e-1f2a-4b1a-9d1a-2b3c4d5e6f70";
const B = "7f1c2f1e-1f2a-4b1a-9d1a-2b3c4d5e6f71";

describe("lead create/update schemas", () => {
  it("requires a first name and validates email and phone", () => {
    expect(createLeadSchema.safeParse({ firstName: " " }).success).toBe(false);
    const bad = createLeadSchema.safeParse({ firstName: "A", email: "nope", phone: "abc" });
    expect(bad.success).toBe(false);
    expect(bad.error?.issues.map((i) => i.path[0])).toEqual(expect.arrayContaining(["email", "phone"]));
    expect(createLeadSchema.parse({ firstName: "A", email: "", phone: "+91 (98) 765-43210" }).phone).toBe("+91 (98) 765-43210");
  });

  it("bounds score and normalises the currency code", () => {
    expect(createLeadSchema.safeParse({ firstName: "A", score: 101 }).success).toBe(false);
    expect(createLeadSchema.parse({ firstName: "A", currencyCode: "inr" }).currencyCode).toBe("INR");
  });

  it("makes update partial but requires the version and rejects unknown fields", () => {
    expect(updateLeadSchema.parse({ version: 3, city: "Noida" })).toEqual({ version: 3, city: "Noida" });
    expect(updateLeadSchema.safeParse({ city: "Noida" }).success).toBe(false);
    expect(updateLeadSchema.safeParse({ version: 1, companyId: A }).success).toBe(false);
  });
});

describe("lead filter params", () => {
  it("parses flat query params into a filter", () => {
    const f = parseLeadFilterParams(
      new URLSearchParams(`search= acme &statusIds=${A},${B}&temperatures=HOT&unassigned=true&scoreMin=10&scoreMax=50&createdAtFrom=2026-10-01&archived=only`)
    );
    expect(f).toMatchObject({ search: "acme", statusIds: [A, B], temperatures: ["HOT"], unassigned: true, score: { min: 10, max: 50 }, createdAt: { from: "2026-10-01" }, archived: "only" });
  });

  it("defaults to excluding archived leads and rejects bad ranges", () => {
    expect(parseLeadFilterParams(new URLSearchParams("")).archived).toBe("exclude");
    expect(() => parseLeadFilterParams(new URLSearchParams("scoreMin=60&scoreMax=10"))).toThrow();
    expect(() => parseLeadFilterParams(new URLSearchParams("createdAtFrom=2026-10-05&createdAtTo=2026-10-01"))).toThrow();
    expect(() => parseLeadFilterParams(new URLSearchParams("statusIds=not-a-uuid"))).toThrow();
  });

  it("round-trips through leadFilterToParams (saved views → URL)", () => {
    const filter = parseLeadFilterParams(new URLSearchParams(`ownerUserIds=${A}&tagIds=${B}&estimatedValueMin=1000&nextFollowUpAtTo=2026-12-31&location=Tiruppur&archived=include`));
    const back = parseLeadFilterParams(new URLSearchParams(leadFilterToParams(filter)));
    expect(back).toEqual(filter);
    expect(leadFilterToParams({ archived: "exclude" })).toEqual({});
  });
});

describe("bulk and conversion schemas", () => {
  it("caps bulk selections", () => {
    const ids = Array.from({ length: BULK_LEAD_LIMIT + 1 }, () => A);
    expect(bulkLeadSchema.safeParse({ action: "archive", ids }).success).toBe(false);
    expect(bulkLeadSchema.safeParse({ action: "removeTags", ids: [A], tagIds: [] }).success).toBe(false);
    expect(bulkLeadSchema.parse({ action: "addTags", ids: [A], tagNames: ["vip"] })).toMatchObject({ tagIds: [], tagNames: ["vip"] });
  });

  it("needs at least a contact or a company to convert into", () => {
    expect(convertLeadSchema.safeParse({ company: { mode: "none" }, contact: { mode: "none" }, opportunity: { create: false } }).success).toBe(false);
    expect(convertLeadSchema.safeParse({ company: { mode: "none" }, contact: { mode: "create" }, opportunity: { create: false } }).success).toBe(true);
    expect(convertLeadSchema.safeParse({ company: { mode: "create", name: "" }, contact: { mode: "none" }, opportunity: { create: false } }).success).toBe(false);
    expect(convertLeadSchema.safeParse({ company: { mode: "link", id: A }, contact: { mode: "none" }, opportunity: { create: true, name: "" } }).success).toBe(false);
  });
});
