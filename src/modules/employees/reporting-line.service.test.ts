import { beforeEach, describe, expect, it, vi } from "vitest";

const tx = vi.hoisted(() => ({ employeeReportingLine: { update: vi.fn(), create: vi.fn() } }));
const db = vi.hoisted(() => ({
  employee: { findFirst: vi.fn() },
  employeeReportingLine: { findFirst: vi.fn(), findMany: vi.fn() },
  $transaction: vi.fn(async (fn: (t: unknown) => unknown) => fn(tx)),
}));
vi.mock("@/core/db/client", () => ({ prisma: db }));
vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
const scope = vi.hoisted(() => ({ loadManagerMap: vi.fn(), invalidateTeamScope: vi.fn() }));
vi.mock("@/core/hierarchy/team-scope", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/core/hierarchy/team-scope")>();
  return { ...actual, ...scope };
});

const { setReportingLine, setReportingLineSchema } = await import("./reporting-line.service");
const actor = { companyId: "co-1", userId: "u-1" };

beforeEach(() => {
  db.employee.findFirst.mockReset().mockImplementation(async ({ where }: { where: { id: string } }) => ({
    id: where.id,
    fullName: `Name ${where.id}`,
    isActive: true,
  }));
  db.employeeReportingLine.findFirst.mockReset().mockResolvedValue(null);
  db.$transaction.mockClear();
  tx.employeeReportingLine.update.mockReset();
  tx.employeeReportingLine.create.mockReset().mockResolvedValue({ id: "line-new" });
  scope.loadManagerMap.mockReset().mockResolvedValue(new Map());
  scope.invalidateTeamScope.mockReset();
});

describe("setReportingLine (P3)", () => {
  it("creates a line, closing the previous active one, and clears the team cache", async () => {
    db.employeeReportingLine.findFirst.mockResolvedValue({ id: "line-old", managerId: "m-old", endDate: null });
    await setReportingLine(actor, "e-1", { module: "PRODUCTION", managerId: "m-new" });
    expect(tx.employeeReportingLine.update).toHaveBeenCalledWith({
      where: { id: "line-old" },
      data: expect.objectContaining({ isActive: false }),
    });
    expect(tx.employeeReportingLine.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ employeeId: "e-1", managerId: "m-new", module: "PRODUCTION", companyId: "co-1" }),
    });
    expect(scope.invalidateTeamScope).toHaveBeenCalledWith("co-1");
  });

  it("refuses a change that would create a loop", async () => {
    scope.loadManagerMap.mockResolvedValue(new Map([["m-1", "e-1"]])); // m-1 already reports to e-1
    await expect(setReportingLine(actor, "e-1", { module: "CRM", managerId: "m-1" })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("refuses a manager from another company (not found)", async () => {
    db.employee.findFirst.mockImplementation(async ({ where }: { where: { id: string } }) =>
      where.id === "m-foreign" ? null : { id: where.id, fullName: "E", isActive: true }
    );
    await expect(setReportingLine(actor, "e-1", { module: "HRMS", managerId: "m-foreign" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("refuses an inactive manager", async () => {
    db.employee.findFirst.mockImplementation(async ({ where }: { where: { id: string } }) => ({
      id: where.id,
      fullName: "E",
      isActive: where.id !== "m-1",
    }));
    await expect(setReportingLine(actor, "e-1", { module: "HRMS", managerId: "m-1" })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("removing a line only closes it", async () => {
    db.employeeReportingLine.findFirst.mockResolvedValue({ id: "line-old", managerId: "m-old", endDate: null });
    await expect(setReportingLine(actor, "e-1", { module: "CRM", managerId: null })).resolves.toBeNull();
    expect(tx.employeeReportingLine.update).toHaveBeenCalled();
    expect(tx.employeeReportingLine.create).not.toHaveBeenCalled();
  });

  it("validates the end date is not before the start date", () => {
    expect(
      setReportingLineSchema.safeParse({ module: "CRM", managerId: null, startDate: "2026-05-02", endDate: "2026-05-01" }).success
    ).toBe(false);
  });
});
