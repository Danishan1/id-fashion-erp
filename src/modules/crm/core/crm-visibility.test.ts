import { beforeEach, describe, expect, it, vi } from "vitest";

const { canMock } = vi.hoisted(() => ({ canMock: vi.fn() }));
vi.mock("@/core/rbac/PermissionService", () => ({ PermissionService: { can: canMock } }));

const { crmOwnerWhere, getCrmRecordScope, isWithinCrmScope } = await import("./crm-visibility");
const actor = { companyId: "co-1", userId: "u-1", branchId: null };

beforeEach(() => canMock.mockReset());

describe("CRM record visibility", () => {
  it("gives ALL to holders of crm.view_all and OWN to everyone else", async () => {
    canMock.mockResolvedValueOnce(true);
    expect(await getCrmRecordScope(actor)).toEqual({ mode: "ALL" });
    canMock.mockResolvedValueOnce(false);
    expect(await getCrmRecordScope(actor)).toEqual({ mode: "OWN", userId: "u-1" });
    expect(canMock).toHaveBeenCalledWith("u-1", "crm", "view_all");
  });

  it("OWN scope = owned by me, or unowned and created by me", () => {
    expect(crmOwnerWhere({ mode: "ALL" })).toEqual({});
    expect(crmOwnerWhere({ mode: "OWN", userId: "u-1" })).toEqual({
      OR: [{ ownerUserId: "u-1" }, { ownerUserId: null, createdByUserId: "u-1" }],
    });
  });

  it("checks a loaded record against the scope", () => {
    const own = { mode: "OWN" as const, userId: "u-1" };
    expect(isWithinCrmScope(own, { ownerUserId: "u-1", createdByUserId: "u-2" })).toBe(true);
    expect(isWithinCrmScope(own, { ownerUserId: null, createdByUserId: "u-1" })).toBe(true);
    expect(isWithinCrmScope(own, { ownerUserId: "u-2", createdByUserId: "u-1" })).toBe(false);
    expect(isWithinCrmScope({ mode: "ALL" }, { ownerUserId: "u-9", createdByUserId: "u-9" })).toBe(true);
  });
});
