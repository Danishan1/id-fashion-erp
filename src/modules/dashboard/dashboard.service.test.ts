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

const { getCompanyCounts, getTeamDashboard, getDashboardViewForUser } = await import("./dashboard.service");

beforeEach(() => {
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

describe("getTeamDashboard", () => {
  it("returns all-zero stats with no direct reports, never querying attendance/job-orders/leave", async () => {
    mockPrisma.employee.findMany.mockResolvedValue([]);
    const result = await getTeamDashboard("co-1", "emp-supervisor");
    expect(result).toEqual({ teamSize: 0, presentToday: 0, activeJobOrders: 0, pendingLeaveRequests: 0 });
    expect(mockPrisma.attendanceRecord.count).not.toHaveBeenCalled();
  });

  it("scopes every stat to the direct-report employee ids only", async () => {
    mockPrisma.employee.findMany.mockResolvedValue([{ id: "emp-1" }, { id: "emp-2" }]);
    mockPrisma.attendanceRecord.count.mockResolvedValue(2);
    mockPrisma.jobOrderAssignment.findMany.mockResolvedValue([{ jobOrderId: "jo-1" }, { jobOrderId: "jo-2" }]);
    mockPrisma.leaveRequest.count.mockResolvedValue(1);

    const result = await getTeamDashboard("co-1", "emp-supervisor");

    expect(result).toEqual({ teamSize: 2, presentToday: 2, activeJobOrders: 2, pendingLeaveRequests: 1 });
    expect(mockPrisma.employee.findMany).toHaveBeenCalledWith({
      where: { companyId: "co-1", reportsToId: "emp-supervisor", isActive: true },
      select: { id: true },
    });
    const attendanceWhere = mockPrisma.attendanceRecord.count.mock.calls[0][0].where;
    expect(attendanceWhere.employeeId).toEqual({ in: ["emp-1", "emp-2"] });
  });
});

describe("getDashboardViewForUser", () => {
  it("returns the team view for a user whose Employee has at least one direct report", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ employeeId: "emp-supervisor", employee: { fullName: "Priya Sharma" } });
    mockPrisma.employee.count.mockResolvedValue(3); // directReportCount check
    mockPrisma.employee.findMany.mockResolvedValue([{ id: "emp-1" }]);
    mockPrisma.attendanceRecord.count.mockResolvedValue(1);
    mockPrisma.jobOrderAssignment.findMany.mockResolvedValue([]);
    mockPrisma.leaveRequest.count.mockResolvedValue(0);

    const result = await getDashboardViewForUser({ userId: "user-1", companyId: "co-1" });

    expect(result.kind).toBe("team");
    if (result.kind === "team") expect(result.supervisorName).toBe("Priya Sharma");
  });

  it("falls back to the ordinary company view for an individual contributor with zero direct reports", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ employeeId: "emp-ic", employee: { fullName: "An IC" } });
    mockPrisma.employee.count.mockResolvedValue(0); // directReportCount check — no reports

    const result = await getDashboardViewForUser({ userId: "user-1", companyId: "co-1" });

    expect(result.kind).toBe("company");
    expect(mockPrisma.employee.findMany).not.toHaveBeenCalled(); // getTeamDashboard never even invoked
  });

  it("falls back to the ordinary company view for a user with no linked Employee at all", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ employeeId: null, employee: null });
    const result = await getDashboardViewForUser({ userId: "user-1", companyId: "co-1" });
    expect(result.kind).toBe("company");
  });
});
