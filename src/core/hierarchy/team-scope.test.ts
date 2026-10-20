import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  employee: { findMany: vi.fn() },
  employeeReportingLine: { findMany: vi.fn() },
  user: { findUnique: vi.fn(), findMany: vi.fn() },
}));
vi.mock("@/core/db/client", () => ({ prisma: db }));

const { descendantsOf, wouldCreateLoop, loadManagerMap, getTeamScope, invalidateTeamScope } = await import("./team-scope");

beforeEach(() => {
  invalidateTeamScope();
  for (const model of Object.values(db)) for (const fn of Object.values(model)) fn.mockReset();
  db.employee.findMany.mockResolvedValue([]);
  db.employeeReportingLine.findMany.mockResolvedValue([]);
});

describe("descendantsOf", () => {
  it("returns direct reports and every level below", () => {
    const managers = new Map([
      ["a", "boss"],
      ["b", "a"],
      ["c", "b"],
      ["x", "other"],
    ]);
    expect(descendantsOf(managers, "boss").sort()).toEqual(["a", "b", "c"]);
    expect(descendantsOf(managers, "b")).toEqual(["c"]);
  });

  it("does not hang on an existing loop", () => {
    const managers = new Map([
      ["a", "b"],
      ["b", "a"],
    ]);
    expect(descendantsOf(managers, "a")).toEqual(["b"]);
  });
});

describe("wouldCreateLoop", () => {
  const managers = new Map([
    ["b", "a"],
    ["c", "b"],
  ]);
  it("refuses self and making someone report to their own descendant", () => {
    expect(wouldCreateLoop(managers, "a", "a")).toBe(true);
    expect(wouldCreateLoop(managers, "a", "c")).toBe(true);
  });
  it("allows an ordinary change", () => {
    expect(wouldCreateLoop(managers, "c", "a")).toBe(false);
    expect(wouldCreateLoop(managers, "d", "c")).toBe(false);
  });
});

describe("loadManagerMap", () => {
  it("uses the module line when there is one, otherwise reportsToId", async () => {
    db.employee.findMany.mockResolvedValue([
      { id: "e1", reportsToId: "m1" },
      { id: "e2", reportsToId: "m1" },
      { id: "e3", reportsToId: null },
    ]);
    db.employeeReportingLine.findMany.mockResolvedValue([
      { employeeId: "e2", managerId: "m2" },
      { employeeId: "e3", managerId: "m2" },
    ]);
    const map = await loadManagerMap("co-1", "CRM");
    expect(map.get("e1")).toBe("m1");
    expect(map.get("e2")).toBe("m2");
    expect(map.get("e3")).toBe("m2");
    expect(db.employeeReportingLine.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ companyId: "co-1", module: "CRM", isActive: true }) })
    );
  });

  it("caches per company and module until invalidated", async () => {
    await loadManagerMap("co-1", "HRMS");
    await loadManagerMap("co-1", "HRMS");
    expect(db.employee.findMany).toHaveBeenCalledTimes(1);
    invalidateTeamScope("co-1");
    await loadManagerMap("co-1", "HRMS");
    expect(db.employee.findMany).toHaveBeenCalledTimes(2);
  });
});

describe("getTeamScope", () => {
  it("returns nobody for a user with no linked employee", async () => {
    db.user.findUnique.mockResolvedValue({ companyId: "co-1", employeeId: null });
    await expect(getTeamScope("u1", "PRODUCTION")).resolves.toEqual({ employeeId: null, teamEmployeeIds: [], teamUserIds: [] });
  });

  it("returns the subtree and their login ids", async () => {
    db.user.findUnique.mockResolvedValue({ companyId: "co-1", employeeId: "boss" });
    db.employee.findMany.mockResolvedValue([
      { id: "a", reportsToId: "boss" },
      { id: "b", reportsToId: "a" },
    ]);
    db.user.findMany.mockResolvedValue([{ id: "u-b" }]);
    const scope = await getTeamScope("u-boss", "PRODUCTION");
    expect(scope.teamEmployeeIds.sort()).toEqual(["a", "b"]);
    expect(scope.teamUserIds).toEqual(["u-b"]);
  });
});
