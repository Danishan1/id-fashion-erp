import { beforeEach, describe, expect, it, vi } from "vitest";

const { canMock } = vi.hoisted(() => ({ canMock: vi.fn() }));
vi.mock("@/core/rbac/PermissionService", () => ({ PermissionService: { can: canMock } }));
const { teamMock } = vi.hoisted(() => ({ teamMock: vi.fn() }));
vi.mock("@/core/hierarchy/team-scope", () => ({ getTeamScope: teamMock }));

const { crmOwnerWhere, getCrmRecordScope, isWithinCrmScope } = await import("./crm-visibility");
const actor = { companyId: "co-1", userId: "u-1", branchId: null };

beforeEach(() => {
  canMock.mockReset();
  teamMock.mockReset().mockResolvedValue({ employeeId: null, teamEmployeeIds: [], teamUserIds: [] });
});

describe("CRM record visibility", () => {
  it("gives ALL to holders of crm.view_all and OWN to everyone else", async () => {
    canMock.mockResolvedValueOnce(true);
    expect(await getCrmRecordScope(actor)).toEqual({ mode: "ALL" });
    canMock.mockResolvedValueOnce(false);
    expect(await getCrmRecordScope(actor)).toEqual({ mode: "OWN", userId: "u-1", teamUserIds: [] });
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

describe("P3 -- CRM team scope", () => {
  it("adds the CRM team's users to an OWN scope", async () => {
    canMock.mockResolvedValue(false);
    teamMock.mockResolvedValue({ employeeId: "e-1", teamEmployeeIds: ["e-2", "e-3"], teamUserIds: ["u-2", "u-3"] });
    expect(await getCrmRecordScope(actor)).toEqual({ mode: "OWN", userId: "u-1", teamUserIds: ["u-2", "u-3"] });
    expect(teamMock).toHaveBeenCalledWith("u-1", "CRM");
  });

  it("a manager sees records owned or (unowned) created by anyone in the team", () => {
    const scope = { mode: "OWN" as const, userId: "u-1", teamUserIds: ["u-2"] };
    expect(crmOwnerWhere(scope)).toEqual({
      OR: [{ ownerUserId: { in: ["u-1", "u-2"] } }, { ownerUserId: null, createdByUserId: { in: ["u-1", "u-2"] } }],
    });
    expect(isWithinCrmScope(scope, { ownerUserId: "u-2", createdByUserId: "u-9" })).toBe(true);
    expect(isWithinCrmScope(scope, { ownerUserId: null, createdByUserId: "u-2" })).toBe(true);
    expect(isWithinCrmScope(scope, { ownerUserId: "u-9", createdByUserId: "u-2" })).toBe(false);
  });

  it("view_all never looks up a team", async () => {
    canMock.mockResolvedValue(true);
    await getCrmRecordScope(actor);
    expect(teamMock).not.toHaveBeenCalled();
  });
});
