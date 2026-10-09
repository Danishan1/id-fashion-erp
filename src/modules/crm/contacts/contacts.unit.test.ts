import { describe, expect, it, vi } from "vitest";

vi.mock("@/core/db/client", () => ({ prisma: {} }));
vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/core/rbac/PermissionService", () => ({ PermissionService: { can: vi.fn(async () => true) } }));

const { channelValueKey, contactDerivedFields, contactFullName } = await import("./contact-keys");
const { contactDuplicateKeys, evaluateContactCandidates, assertContactDuplicatesAllowed } = await import("./contact-duplicates");
const { canContact, contactabilitySummary, mergeConsents } = await import("./contactability");
const { contactFilterToParams, parseContactFilterParams, mergeContactsSchema, createContactSchema } = await import("./contact.schema");
const { buildContactOrderBy, buildContactWhere } = await import("./contact-filters");
const { leftoverChannels, mergeCustomFieldValues, resolveFieldChoices } = await import("./contact-merge.service");
const { DEFAULT_CONTACT_DUPLICATE_RULES } = await import("./contact-registry");

const A = "6f1c2f1e-1f2a-4b1a-9d1a-2b3c4d5e6f70";
const B = "7f1c2f1e-1f2a-4b1a-9d1a-2b3c4d5e6f71";
const CO = "8f1c2f1e-1f2a-4b1a-9d1a-2b3c4d5e6f72";

describe("contact keys", () => {
  it("builds the full name from first, middle and last name", () => {
    expect(contactFullName({ firstName: " Asha ", middleName: "K", lastName: "Rao " })).toBe("Asha K Rao");
    expect(contactFullName({ firstName: "Asha" })).toBe("Asha");
  });

  it("derives match keys from core fields and extra channels, and searchable text", () => {
    const d = contactDerivedFields(
      { firstName: "Asha", lastName: "Rao", email: "Asha@X.com", alternateEmail: null, phone: "044 2345 6789", mobile: "+91 98765 43210", whatsapp: "9876543210", designation: "Buyer" },
      [
        { channelType: "EMAIL", value: "asha.personal@y.com" },
        { channelType: "MOBILE", value: "91234 56789" },
        { channelType: "LINKEDIN", value: "https://linkedin.com/in/asha" },
      ],
      "Rao Exports"
    );
    expect(d.fullName).toBe("Asha Rao");
    expect(d.nameKey).toBe("asha rao");
    expect(d.emailKeys).toEqual(["asha@x.com", "asha.personal@y.com"]);
    expect(d.phoneKeys).toEqual(["4423456789", "9876543210", "9123456789"]);
    expect(d.searchText).toContain("rao exports");
    expect(d.searchText).toContain("linkedin.com/in/asha");
  });

  it("normalises channel values per kind", () => {
    expect(channelValueKey("EMAIL", " A@B.co ")).toBe("a@b.co");
    expect(channelValueKey("WHATSAPP", "+91 98765-43210")).toBe("9876543210");
    expect(channelValueKey("WEBSITE", "HTTPS://Acme.com ")).toBe("https://acme.com");
  });
});

const candidate = (over: Partial<Parameters<typeof evaluateContactCandidates>[0][number]> = {}) => ({
  id: B,
  fullName: "Asha Rao",
  nameKey: "asha rao",
  email: "asha@x.com",
  phone: null,
  mobile: "9876543210",
  whatsapp: null,
  emailKeys: ["asha@x.com"],
  phoneKeys: ["9876543210", "4423456789"],
  crmCompanyId: CO,
  ownerUserId: null,
  createdByUserId: "u",
  archivedAt: null,
  crmCompany: { name: "Rao Exports" },
  owner: null,
  ...over,
});

describe("contact duplicate rules", () => {
  const keys = (over: Partial<Parameters<typeof contactDuplicateKeys>[0]> = {}) =>
    contactDuplicateKeys({ emailKeys: [], phone: null, mobile: null, whatsapp: null, nameKey: "asha rao", crmCompanyId: null, ...over });

  it("matches per field: a shared office phone is ignored by default, the same mobile warns", () => {
    const rules = DEFAULT_CONTACT_DUPLICATE_RULES;
    expect(evaluateContactCandidates([candidate()], keys({ nameKey: "someone else", phone: "044-2345-6789" }), rules).matches).toEqual([]);
    const r = evaluateContactCandidates([candidate()], keys({ nameKey: "someone else", mobile: "+91 98765 43210" }), rules);
    expect(r.matches[0]).toMatchObject({ rules: ["MOBILE"], action: "WARN" });
    expect(r.needsConfirmation).toBe(true);
  });

  it("supports name + company and name + email, and the strictest action wins", () => {
    const rules = [
      { rule: "EMAIL", action: "FLAG" },
      { rule: "PHONE", action: "OFF" },
      { rule: "MOBILE", action: "OFF" },
      { rule: "WHATSAPP", action: "OFF" },
      { rule: "NAME_AND_COMPANY", action: "BLOCK" },
      { rule: "NAME_AND_EMAIL", action: "WARN" },
    ] as const;
    const sameCompany = evaluateContactCandidates([candidate()], keys({ crmCompanyId: CO }), [...rules]);
    expect(sameCompany).toMatchObject({ blocking: true });
    const sameEmail = evaluateContactCandidates([candidate()], keys({ emailKeys: ["asha@x.com"] }), [...rules]);
    expect(sameEmail.matches[0]).toMatchObject({ rules: ["EMAIL", "NAME_AND_EMAIL"], action: "WARN" });
    const otherName = evaluateContactCandidates([candidate()], keys({ nameKey: "other", emailKeys: ["asha@x.com"] }), [...rules]);
    expect(otherName).toMatchObject({ blocking: false, needsConfirmation: false, flaggedIds: [B] });
  });

  it("enforces BLOCK always, WARN until confirmed, and lets FLAG through", () => {
    const base = { matches: [{ fullName: "Asha" }] as never, flaggedIds: [] };
    expect(() => assertContactDuplicatesAllowed({ ...base, blocking: true, needsConfirmation: false }, true)).toThrow(expect.objectContaining({ code: "CRM_DUPLICATE_RECORD" }));
    expect(() => assertContactDuplicatesAllowed({ ...base, blocking: false, needsConfirmation: true }, false)).toThrow(expect.objectContaining({ code: "CRM_POSSIBLE_DUPLICATE" }));
    expect(() => assertContactDuplicatesAllowed({ ...base, blocking: false, needsConfirmation: true }, true)).not.toThrow();
    expect(() => assertContactDuplicatesAllowed({ ...base, blocking: false, needsConfirmation: false, flaggedIds: [B] }, false)).not.toThrow();
  });
});

describe("contactability", () => {
  it("lets a contact-wide restriction override every channel", () => {
    const rows = [
      { channel: "ALL", status: "DO_NOT_CONTACT" as const, reason: "Legal request" },
      { channel: "EMAIL", status: "ALLOWED" as const },
    ];
    expect(canContact(rows, "EMAIL")).toEqual({ allowed: false, status: "DO_NOT_CONTACT", decidedBy: "ALL", reason: "Legal request" });
  });

  it("decides per channel and defaults to allowed", () => {
    const rows = [{ channel: "WHATSAPP", status: "UNSUBSCRIBED" as const, reason: "Replied STOP" }];
    expect(canContact(rows, "WHATSAPP")).toMatchObject({ allowed: false, decidedBy: "WHATSAPP" });
    expect(canContact(rows, "EMAIL")).toEqual({ allowed: true, status: "ALLOWED", decidedBy: null, reason: null });
    const summary = contactabilitySummary(rows);
    expect(summary.map((s) => [s.channel, s.allowed])).toEqual([
      ["ALL", true],
      ["EMAIL", true],
      ["PHONE", true],
      ["SMS", true],
      ["WHATSAPP", false],
    ]);
  });

  it("keeps the stricter status per channel when merging", () => {
    const survivor = [{ channel: "EMAIL", status: "BOUNCED" as const }];
    const merged = [
      { channel: "EMAIL", status: "UNSUBSCRIBED" as const },
      { channel: "PHONE", status: "DO_NOT_CONTACT" as const },
      { channel: "SMS", status: "ALLOWED" as const },
    ];
    expect(mergeConsents(survivor, merged)).toEqual([
      { channel: "EMAIL", keep: "merged" },
      { channel: "PHONE", keep: "merged" },
      { channel: "SMS", keep: "merged" },
    ]);
    expect(mergeConsents([{ channel: "EMAIL", status: "DO_NOT_CONTACT" as const }], [{ channel: "EMAIL", status: "ALLOWED" as const }])).toEqual([]);
  });
});

describe("contact filters", () => {
  it("round-trips the flat query string, compatible with lead filter conventions", () => {
    const sp = new URLSearchParams("search=asha&ownerUserIds=" + A + "&dndChannels=EMAIL,ALL&hasEmail=yes&erpCustomer=linked&lastActivityAtFrom=2026-10-01&unassigned=true&duplicateFlagged=true&archived=include&junk=1");
    const f = parseContactFilterParams(sp);
    expect(f).toMatchObject({ search: "asha", ownerUserIds: [A], dndChannels: ["EMAIL", "ALL"], hasEmail: "yes", erpCustomer: "linked", unassigned: true, duplicateFlagged: true, archived: "include", lastActivityAt: { from: "2026-10-01" } });
    const { search: _search, ...rest } = f;
    void _search;
    expect(parseContactFilterParams(new URLSearchParams(contactFilterToParams(rest)))).toEqual({ ...rest });
  });

  it("always scopes to the company, hides merged contacts and applies OWN visibility", () => {
    const where = buildContactWhere("co-1", parseContactFilterParams(new URLSearchParams("")), { mode: "OWN", userId: "u1" });
    expect(where.AND).toEqual(
      expect.arrayContaining([{ companyId: "co-1" }, { mergedIntoId: null }, { archivedAt: null }, { OR: [{ ownerUserId: "u1" }, { ownerUserId: null, createdByUserId: "u1" }] }])
    );
  });

  it("filters DND by the channel or a contact-wide restriction, and searches phone digits", () => {
    const where = buildContactWhere("co-1", parseContactFilterParams(new URLSearchParams("dndChannels=WHATSAPP&search=98765 43210")), { mode: "ALL" });
    expect(where.AND).toEqual(
      expect.arrayContaining([
        { consents: { some: { channel: { in: ["WHATSAPP", "ALL"] }, status: { not: "ALLOWED" } } } },
        { OR: [{ searchText: { contains: "98765 43210" } }, { phoneKeys: { has: "9876543210" } }] },
      ])
    );
  });

  it("sorts with stable tie-breaks and nulls last for last activity", () => {
    expect(buildContactOrderBy("lastActivityAt", "desc")).toEqual([{ lastActivityAt: { sort: "desc", nulls: "last" } }, { id: "desc" }]);
    expect(buildContactOrderBy("companyName", "asc")[0]).toEqual({ crmCompany: { name: "asc" } });
  });
});

describe("contact schemas", () => {
  it("validates create input", () => {
    expect(createContactSchema.safeParse({ firstName: "" }).success).toBe(false);
    expect(createContactSchema.safeParse({ firstName: "Asha", email: "nope" }).success).toBe(false);
    expect(createContactSchema.parse({ firstName: "Asha", addresses: [{ line1: "1 Main St" }] }).addresses?.[0].addressType).toBe("OFFICE");
  });

  it("rejects merging a contact with itself", () => {
    expect(mergeContactsSchema.safeParse({ survivorId: A, mergedId: A, survivorVersion: 1, mergedVersion: 1 }).success).toBe(false);
    expect(mergeContactsSchema.parse({ survivorId: A, mergedId: B, survivorVersion: 1, mergedVersion: 2, fieldChoices: { email: "merged" } }).fieldChoices).toEqual({ email: "merged" });
  });
});

describe("merge rules", () => {
  const contact = (over: Record<string, unknown>) =>
    ({
      firstName: "Asha",
      middleName: null,
      lastName: "Rao",
      designation: null,
      department: null,
      relationshipRole: null,
      email: null,
      alternateEmail: null,
      phone: null,
      mobile: null,
      whatsapp: null,
      crmCompanyId: null,
      sourceId: null,
      ownerUserId: null,
      ...over,
    }) as never;

  it("keeps the survivor's values, fills its empty fields from the merged contact, and honours explicit choices", () => {
    const s = contact({ email: "a@x.com", designation: null });
    const m = contact({ email: "a@y.com", designation: "Buyer" });
    expect(resolveFieldChoices(s, m, {})).toMatchObject({ email: "survivor", designation: "merged", firstName: "survivor" });
    expect(resolveFieldChoices(s, m, { email: "merged" }).email).toBe("merged");
  });

  it("keeps emails and numbers that lose their field as extra channels", () => {
    const s = contact({ email: "a@x.com", mobile: "9876543210" });
    const m = contact({ email: "a@y.com", mobile: "+91 98765 43210", whatsapp: "9123456789" });
    const final = { ...(s as object), whatsapp: "9123456789" } as never;
    expect(leftoverChannels(s, m, final)).toEqual([{ channelType: "EMAIL", value: "a@y.com" }]);
    const final2 = { ...(s as object), email: "a@y.com" } as never;
    expect(leftoverChannels(s, m, final2)).toEqual([
      { channelType: "EMAIL", value: "a@x.com" },
      { channelType: "WHATSAPP", value: "9123456789" },
    ]);
  });

  it("merges custom field values with the same default rule", () => {
    expect(mergeCustomFieldValues({ a: 1, b: null }, { a: 2, b: 3, c: 4 }, {})).toEqual({ a: 1, b: 3, c: 4 });
    expect(mergeCustomFieldValues({ a: 1 }, { a: 2 }, { a: "merged" })).toEqual({ a: 2 });
  });
});
