import { beforeEach, describe, expect, it, vi } from "vitest";

const { canMock, teamMock } = vi.hoisted(() => ({ canMock: vi.fn(), teamMock: vi.fn() }));
vi.mock("@/core/rbac/PermissionService", () => ({ PermissionService: { can: canMock } }));
vi.mock("@/core/hierarchy/team-scope", () => ({ getTeamScope: teamMock }));

const { getHrmsEmployeeScope, assertHrmsEmployeeInScope, hrmsEmployeeWhere } = await import("./hrms-scope");

beforeEach(() => {
  canMock.mockReset().mockResolvedValue(false);
  teamMock.mockReset().mockResolvedValue({ employeeId: "me", teamEmployeeIds: ["a", "b"], teamUserIds: [] });
});

describe("HRMS scope (P3)", () => {
  it("view_all sees everyone", async () => {
    canMock.mockResolvedValue(true);
    await expect(getHrmsEmployeeScope("u1", "hrms_leave")).resolves.toBeNull();
    expect(canMock).toHaveBeenCalledWith("u1", "hrms_leave", "view_all");
    expect(teamMock).not.toHaveBeenCalled();
  });

  it("without view_all: self plus the HRMS team", async () => {
    await expect(getHrmsEmployeeScope("u1", "hrms_attendance")).resolves.toEqual(["me", "a", "b"]);
    expect(teamMock).toHaveBeenCalledWith("u1", "HRMS");
  });

  it("a user with no linked employee sees nobody", async () => {
    teamMock.mockResolvedValue({ employeeId: null, teamEmployeeIds: [], teamUserIds: [] });
    await expect(getHrmsEmployeeScope("u1", "hrms_leave")).resolves.toEqual([]);
    expect(hrmsEmployeeWhere([])).toEqual({ employeeId: { in: [] } });
  });

  it("refuses an employee outside the team as not found", async () => {
    await expect(assertHrmsEmployeeInScope("u1", "hrms_leave", "z", { label: "Leave request", id: "lr" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(assertHrmsEmployeeInScope("u1", "hrms_leave", "b", { label: "Leave request", id: "lr" })).resolves.toBeUndefined();
  });
});
