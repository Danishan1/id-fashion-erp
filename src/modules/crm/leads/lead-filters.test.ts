import { describe, expect, it, vi } from "vitest";

vi.mock("@/core/rbac/PermissionService", () => ({ PermissionService: { can: vi.fn() } }));

const { buildLeadOrderBy, buildLeadWhere } = await import("./lead-filters");
const { leadFilterSchema } = await import("./lead.schema");

const ALL = { mode: "ALL" } as const;
const OWN = { mode: "OWN", userId: "u-1" } as const;
const f = (v: object) => leadFilterSchema.parse(v);
const parts = (w: { AND?: unknown }) => w.AND as Record<string, unknown>[];

describe("buildLeadWhere", () => {
  it("always scopes to the company and hides archived leads by default", () => {
    expect(parts(buildLeadWhere("co-1", f({}), ALL))).toEqual([{ companyId: "co-1" }, { archivedAt: null }]);
    expect(parts(buildLeadWhere("co-1", f({ archived: "only" }), ALL))).toContainEqual({ archivedAt: { not: null } });
    expect(parts(buildLeadWhere("co-1", f({ archived: "include" }), ALL))).toEqual([{ companyId: "co-1" }]);
  });

  it("applies own-record visibility for users without crm.view_all", () => {
    expect(parts(buildLeadWhere("co-1", f({}), OWN))[1]).toEqual({ OR: [{ ownerUserId: "u-1" }, { ownerUserId: null, createdByUserId: "u-1" }] });
  });

  it("searches the lower-cased search text and, for 4+ digits, phone keys", () => {
    expect(parts(buildLeadWhere("co-1", f({ search: "Acme" }), ALL))).toContainEqual({ OR: [{ searchText: { contains: "acme" } }] });
    expect(parts(buildLeadWhere("co-1", f({ search: "+91 98765 43210" }), ALL))).toContainEqual({
      OR: [{ searchText: { contains: "+91 98765 43210" } }, { phoneKeys: { has: "9876543210" } }],
    });
  });

  it("ORs owners with 'unassigned' and restricts tags to the pre-resolved ids", () => {
    const id = "6f1c2f1e-1f2a-4b1a-9d1a-2b3c4d5e6f70";
    const w = parts(buildLeadWhere("co-1", f({ ownerUserIds: [id], unassigned: true, tagIds: [id] }), ALL, ["lead-9"]));
    expect(w).toContainEqual({ OR: [{ ownerUserId: { in: [id] } }, { ownerUserId: null }] });
    expect(w).toContainEqual({ id: { in: ["lead-9"] } });
    expect(parts(buildLeadWhere("co-1", f({ tagIds: [id] }), ALL))).toContainEqual({ id: { in: [] } });
  });

  it("turns number ranges into gte/lte and date ranges into business-day (IST) bounds", () => {
    const w = parts(buildLeadWhere("co-1", f({ score: { min: 10 }, createdAt: { from: "2026-10-01", to: "2026-10-01" } }), ALL));
    expect(w).toContainEqual({ score: { gte: 10 } });
    const created = w.find((p) => "createdAt" in p) as { createdAt: { gte: Date; lte?: Date; lt?: Date } };
    expect(created.createdAt.gte.toISOString()).toBe("2026-09-30T18:30:00.000Z");
  });
});

describe("buildLeadOrderBy", () => {
  it("puts empty values last for nullable columns and adds an id tie-breaker", () => {
    expect(buildLeadOrderBy("nextFollowUpAt", "asc")).toEqual([{ nextFollowUpAt: { sort: "asc", nulls: "last" } }, { id: "asc" }]);
    expect(buildLeadOrderBy("score", "desc")).toEqual([{ score: "desc" }, { id: "desc" }]);
  });
});
