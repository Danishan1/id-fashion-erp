import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  customer: { count: vi.fn() },
  supplier: { count: vi.fn() },
  employee: { count: vi.fn(), findMany: vi.fn() },
  warehouse: { count: vi.fn() },
  user: { count: vi.fn(), findUnique: vi.fn() },
  company: { findMany: vi.fn() },
  attendanceRecord: { count: vi.fn() },
  jobOrderAssignment: { findMany: vi.fn() },
  leaveRequest: { count: vi.fn() },
}));

vi.mock("@/core/db/client", () => ({ prisma: mockPrisma }));
const managerMaps = vi.hoisted(() => ({}) as Record<string, Map<string, string>>);
vi.mock("@/core/hierarchy/team-scope", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/core/hierarchy/team-scope")>();
  return { ...actual, loadManagerMap: vi.fn(async (_c: string, module: string) => managerMaps[module] ?? new Map()) };
});

const { getCompanyCounts, getTeamDashboard, getDashboardViewForUser } = await import("./dashboard.service");

beforeEach(() => {
  for (const key of Object.keys(managerMaps)) delete managerMaps[key];
  Object.values(mockPrisma).forEach((model) => Object.values(model).forEach((fn) => fn.mockReset()));
  mockPrisma.customer.count.mockResolvedValue(1);
  mockPrisma.supplier.count.mockResolvedValue(2);
  mockPrisma.employee.count.mockResolvedValue(3);
  mockPrisma.warehouse.count.mockResolvedValue(4);
  mockPrisma.user.count.mockResolvedValue(5);
});

describe("getCompanyCounts", () => {
  it("returns the five company-scoped counts", async () => {
    await expect(getCompanyCounts("co-1")).resolves.toEqual({ customers: 1, suppliers: 2, employees: 3, warehouses: 4, users: 5 });
    expect(mockPrisma.customer.count).toHaveBeenCalledWith({ where: { companyId: "co-1", isActive: true } });
  });
});

describe("getTeamDashboard (P3: whole subtree across module reporting lines)", () => {
  it("returns all-zero stats with nobody below, never querying attendance/job-orders/leave", async () => {
    managerMaps.PRODUCTION = new Map();
    const result = await getTeamDashboard("co-1", "emp-supervisor");
    expect(result).toEqual({ teamSize: 0, presentToday: 0, activeJobOrders: 0, pendingLeaveRequests: 0 });
    expect(mockPrisma.attendanceRecord.count).not.toHaveBeenCalled();
  });

  it("includes indirect reports and people below in any module, active employees only", async () => {
    // emp-1 reports to the supervisor in Production; emp-2 reports to emp-1 (indirect);
    // emp-3 reports to the supervisor only in HRMS.
    managerMaps.PRODUCTION = new Map([["emp-1", "emp-supervisor"], ["emp-2", "emp-1"]]);
    managerMaps.HRMS = new Map([["emp-3", "emp-supervisor"]]);
    mockPrisma.employee.findMany.mockImplementation(async ({ where }: { where: { id: { in: string[] } } }) =>
      where.id.in.map((id) => ({ id }))
    );
    mockPrisma.attendanceRecord.count.mockResolvedValue(2);
    mockPrisma.jobOrderAssignment.findMany.mockResolvedValue([{ jobOrderId: "jo-1" }, { jobOrderId: "jo-2" }]);
    mockPrisma.leaveRequest.count.mockResolvedValue(1);

    const result = await getTeamDashboard("co-1", "emp-supervisor");

    expect(result).toEqual({ teamSize: 3, presentToday: 2, activeJobOrders: 2, pendingLeaveRequests: 1 });
    const attendanceWhere = mockPrisma.attendanceRecord.count.mock.calls[0][0].where;
    expect([...attendanceWhere.employeeId.in].sort()).toEqual(["emp-1", "emp-2", "emp-3"]);
  });
});

describe("getDashboardViewForUser", () => {
  it("returns the team view for a user with anyone below them", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ employeeId: "emp-supervisor", employee: { fullName: "Priya Sharma" } });
    managerMaps.CRM = new Map([["emp-1", "emp-supervisor"]]);
    mockPrisma.employee.findMany.mockResolvedValue([{ id: "emp-1" }]);
    mockPrisma.attendanceRecord.count.mockResolvedValue(1);
    mockPrisma.jobOrderAssignment.findMany.mockResolvedValue([]);
    mockPrisma.leaveRequest.count.mockResolvedValue(0);

    const result = await getDashboardViewForUser({ userId: "user-1", companyId: "co-1" });

    expect(result.kind).toBe("team");
    if (result.kind === "team") expect(result.supervisorName).toBe("Priya Sharma");
  });

  it("falls back to the ordinary company view for an individual contributor with nobody below", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ employeeId: "emp-ic", employee: { fullName: "An IC" } });

    const result = await getDashboardViewForUser({ userId: "user-1", companyId: "co-1" });

    expect(result.kind).toBe("company");
    expect(mockPrisma.attendanceRecord.count).not.toHaveBeenCalled();
  });

  it("falls back to the ordinary company view for a user with no linked Employee at all", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ employeeId: null, employee: null });
    const result = await getDashboardViewForUser({ userId: "user-1", companyId: "co-1" });
    expect(result.kind).toBe("company");
  });
});
