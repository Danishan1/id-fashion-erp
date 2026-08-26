import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/core/rbac/PermissionService", () => ({ PermissionService: { assert: vi.fn() } }));
vi.mock("@/core/notifications/NotificationService", () => ({ createNotification: vi.fn() }));
vi.mock("@/core/db/client", () => ({
  prisma: {
    leaveType: { findFirst: vi.fn() },
    employee: { findFirst: vi.fn() },
    user: { findFirst: vi.fn() },
  },
}));
vi.mock("./leave.repository", () => ({
  LeaveTypeRepository: {
    findMany: vi.fn(),
    findAnyById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  LeaveRequestRepository: {
    create: vi.fn(),
    update: vi.fn(),
    findAnyById: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    findApprovedInYear: vi.fn(),
  },
}));

const { prisma } = await import("@/core/db/client");
const { PermissionService } = await import("@/core/rbac/PermissionService");
const { createNotification } = await import("@/core/notifications/NotificationService");
const { LeaveRequestRepository } = await import("./leave.repository");
const { getLeaveBalance, approveLeaveRequest, rejectLeaveRequest, createLeaveRequest } = await import("./leave.service");

const actor = { companyId: "co-1", userId: "user-1", branchId: "br-1" };

beforeEach(() => {
  vi.mocked(prisma.leaveType.findFirst).mockReset();
  vi.mocked(prisma.employee.findFirst).mockReset();
  vi.mocked(prisma.user.findFirst).mockReset();
  vi.mocked(LeaveRequestRepository.findApprovedInYear).mockReset().mockResolvedValue([]);
  vi.mocked(LeaveRequestRepository.findAnyById).mockReset();
  vi.mocked(LeaveRequestRepository.update).mockReset();
  vi.mocked(LeaveRequestRepository.create).mockReset();
  vi.mocked(PermissionService.assert).mockReset().mockResolvedValue(undefined);
  vi.mocked(createNotification).mockReset();
});

describe("getLeaveBalance", () => {
  it("sums inclusive day-spans of every APPROVED request in the year, clipped to that year", async () => {
    vi.mocked(prisma.leaveType.findFirst).mockResolvedValue({ id: "lt-1", annualDays: "12" } as never);
    vi.mocked(LeaveRequestRepository.findApprovedInYear).mockResolvedValue([
      { startDate: new Date("2026-03-01"), endDate: new Date("2026-03-03") }, // 3 days
      { startDate: new Date("2026-06-10"), endDate: new Date("2026-06-10") }, // 1 day
    ] as never);

    const balance = await getLeaveBalance("co-1", "emp-1", "lt-1", 2026);

    expect(balance).toEqual({ annualDays: 12, usedDays: 4, remainingDays: 8 });
  });

  it("clips a request that spans across the year boundary to only the days inside the requested year", async () => {
    vi.mocked(prisma.leaveType.findFirst).mockResolvedValue({ id: "lt-1", annualDays: "12" } as never);
    vi.mocked(LeaveRequestRepository.findApprovedInYear).mockResolvedValue([
      { startDate: new Date("2025-12-30"), endDate: new Date("2026-01-02") }, // only Jan 1-2 count for 2026
    ] as never);

    const balance = await getLeaveBalance("co-1", "emp-1", "lt-1", 2026);

    expect(balance.usedDays).toBe(2);
  });
});

describe("createLeaveRequest", () => {
  it("notifies the employee's reporting manager when the manager has a login account", async () => {
    vi.mocked(prisma.employee.findFirst).mockResolvedValue({ id: "emp-1", fullName: "Asha Rao", reportsToId: "emp-mgr" } as never);
    vi.mocked(prisma.leaveType.findFirst).mockResolvedValue({ id: "lt-1" } as never);
    vi.mocked(prisma.user.findFirst).mockResolvedValue({ id: "user-mgr" } as never);
    vi.mocked(LeaveRequestRepository.create).mockResolvedValue({
      id: "req-1",
      employeeId: "emp-1",
      startDate: new Date("2026-09-01"),
      endDate: new Date("2026-09-02"),
    } as never);

    await createLeaveRequest(actor, { employeeId: "emp-1", leaveTypeId: "lt-1", startDate: "2026-09-01", endDate: "2026-09-02" } as never);

    expect(prisma.user.findFirst).toHaveBeenCalledWith({ where: { companyId: "co-1", employeeId: "emp-mgr" }, select: { id: true } });
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-mgr", relatedModule: "LEAVE_REQUEST", relatedRecordId: "req-1" })
    );
  });

  it("skips the notification when the employee has no reporting manager set", async () => {
    vi.mocked(prisma.employee.findFirst).mockResolvedValue({ id: "emp-1", fullName: "Asha Rao", reportsToId: null } as never);
    vi.mocked(prisma.leaveType.findFirst).mockResolvedValue({ id: "lt-1" } as never);
    vi.mocked(LeaveRequestRepository.create).mockResolvedValue({
      id: "req-1",
      employeeId: "emp-1",
      startDate: new Date("2026-09-01"),
      endDate: new Date("2026-09-02"),
    } as never);

    await createLeaveRequest(actor, { employeeId: "emp-1", leaveTypeId: "lt-1", startDate: "2026-09-01", endDate: "2026-09-02" } as never);

    expect(prisma.user.findFirst).not.toHaveBeenCalled();
    expect(createNotification).not.toHaveBeenCalled();
  });

  it("skips the notification when the reporting manager has no login account", async () => {
    vi.mocked(prisma.employee.findFirst).mockResolvedValue({ id: "emp-1", fullName: "Asha Rao", reportsToId: "emp-mgr" } as never);
    vi.mocked(prisma.leaveType.findFirst).mockResolvedValue({ id: "lt-1" } as never);
    vi.mocked(prisma.user.findFirst).mockResolvedValue(null as never);
    vi.mocked(LeaveRequestRepository.create).mockResolvedValue({
      id: "req-1",
      employeeId: "emp-1",
      startDate: new Date("2026-09-01"),
      endDate: new Date("2026-09-02"),
    } as never);

    await createLeaveRequest(actor, { employeeId: "emp-1", leaveTypeId: "lt-1", startDate: "2026-09-01", endDate: "2026-09-02" } as never);

    expect(createNotification).not.toHaveBeenCalled();
  });
});

describe("approveLeaveRequest", () => {
  it("blocks approval once it would exceed the employee's remaining balance", async () => {
    vi.mocked(LeaveRequestRepository.findAnyById).mockResolvedValue({
      id: "req-1",
      status: "PENDING",
      employeeId: "emp-1",
      leaveTypeId: "lt-1",
      startDate: new Date("2026-08-01"),
      endDate: new Date("2026-08-10"), // 10 days requested
    } as never);
    vi.mocked(prisma.leaveType.findFirst).mockResolvedValue({ id: "lt-1", annualDays: "12" } as never);
    vi.mocked(LeaveRequestRepository.findApprovedInYear).mockResolvedValue([
      { startDate: new Date("2026-01-01"), endDate: new Date("2026-01-05") }, // 5 already used, 7 remain
    ] as never);

    await expect(approveLeaveRequest(actor, "req-1")).rejects.toMatchObject({ code: "LEAVE_BALANCE_EXCEEDED" });
    expect(LeaveRequestRepository.update).not.toHaveBeenCalled();
  });

  it("allows approval when the request fits within the remaining balance", async () => {
    vi.mocked(LeaveRequestRepository.findAnyById).mockResolvedValue({
      id: "req-1",
      status: "PENDING",
      employeeId: "emp-1",
      leaveTypeId: "lt-1",
      startDate: new Date("2026-08-01"),
      endDate: new Date("2026-08-03"), // 3 days
    } as never);
    vi.mocked(prisma.leaveType.findFirst).mockResolvedValue({ id: "lt-1", annualDays: "12" } as never);
    vi.mocked(LeaveRequestRepository.findApprovedInYear).mockResolvedValue([]);
    vi.mocked(LeaveRequestRepository.update).mockResolvedValue({ id: "req-1", status: "APPROVED" } as never);

    await approveLeaveRequest(actor, "req-1");

    expect(LeaveRequestRepository.update).toHaveBeenCalledWith("req-1", expect.objectContaining({ status: "APPROVED" }));
  });

  // Regression test for the P1 fix: the approve route's own assert has no
  // resourceContext, so without this call the self-approval guard was
  // unreachable — a MANAGEMENT-role user (who holds both create and approve
  // on hrms_leave) could approve their own leave request. Mirrors
  // approveCampaign()'s already-correct pattern.
  it("asserts the self-approval guard with the request's real creator, and propagates a denial", async () => {
    vi.mocked(LeaveRequestRepository.findAnyById).mockResolvedValue({
      id: "req-1",
      status: "PENDING",
      employeeId: "emp-1",
      leaveTypeId: "lt-1",
      startDate: new Date("2026-08-01"),
      endDate: new Date("2026-08-03"),
      createdByUserId: "user-1",
    } as never);
    vi.mocked(prisma.leaveType.findFirst).mockResolvedValue({ id: "lt-1", annualDays: "12" } as never);
    vi.mocked(PermissionService.assert).mockRejectedValue(Object.assign(new Error("denied"), { code: "PERMISSION_DENIED" }));

    await expect(approveLeaveRequest(actor, "req-1")).rejects.toMatchObject({ code: "PERMISSION_DENIED" });

    expect(PermissionService.assert).toHaveBeenCalledWith(actor.userId, "hrms_leave", "approve", { createdBy: "user-1" });
    expect(LeaveRequestRepository.update).not.toHaveBeenCalled();
  });

  it("never blocks approval when the leave type has no annualDays configured (0 = unlimited/untracked)", async () => {
    vi.mocked(LeaveRequestRepository.findAnyById).mockResolvedValue({
      id: "req-1",
      status: "PENDING",
      employeeId: "emp-1",
      leaveTypeId: "lt-1",
      startDate: new Date("2026-08-01"),
      endDate: new Date("2026-08-30"), // 30 days, would exceed any real quota
    } as never);
    vi.mocked(prisma.leaveType.findFirst).mockResolvedValue({ id: "lt-1", annualDays: "0" } as never);
    vi.mocked(LeaveRequestRepository.findApprovedInYear).mockResolvedValue([]);
    vi.mocked(LeaveRequestRepository.update).mockResolvedValue({ id: "req-1", status: "APPROVED" } as never);

    await approveLeaveRequest(actor, "req-1");

    expect(LeaveRequestRepository.update).toHaveBeenCalledWith("req-1", expect.objectContaining({ status: "APPROVED" }));
  });

  it("rejects re-approving a request that's no longer PENDING", async () => {
    vi.mocked(LeaveRequestRepository.findAnyById).mockResolvedValue({ id: "req-1", status: "APPROVED" } as never);

    await expect(approveLeaveRequest(actor, "req-1")).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  });

  it("notifies the requesting employee's own login account once approved", async () => {
    vi.mocked(LeaveRequestRepository.findAnyById).mockResolvedValue({
      id: "req-1",
      status: "PENDING",
      employeeId: "emp-1",
      leaveTypeId: "lt-1",
      startDate: new Date("2026-08-01"),
      endDate: new Date("2026-08-03"),
    } as never);
    vi.mocked(prisma.leaveType.findFirst).mockResolvedValue({ id: "lt-1", annualDays: "12" } as never);
    vi.mocked(LeaveRequestRepository.findApprovedInYear).mockResolvedValue([]);
    vi.mocked(LeaveRequestRepository.update).mockResolvedValue({ id: "req-1", status: "APPROVED", employeeId: "emp-1" } as never);
    vi.mocked(prisma.user.findFirst).mockResolvedValue({ id: "user-emp-1" } as never);

    await approveLeaveRequest(actor, "req-1");

    expect(prisma.user.findFirst).toHaveBeenCalledWith({ where: { companyId: "co-1", employeeId: "emp-1" }, select: { id: true } });
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-emp-1", title: "Leave request approved", relatedModule: "LEAVE_REQUEST", relatedRecordId: "req-1" })
    );
  });
});

describe("rejectLeaveRequest", () => {
  it("stores the rejection reason distinct from the employee's own stated reason", async () => {
    vi.mocked(LeaveRequestRepository.findAnyById).mockResolvedValue({ id: "req-1", status: "PENDING" } as never);
    vi.mocked(LeaveRequestRepository.update).mockResolvedValue({ id: "req-1", status: "REJECTED" } as never);

    await rejectLeaveRequest(actor, "req-1", { reason: "Team is understaffed that week" });

    expect(LeaveRequestRepository.update).toHaveBeenCalledWith(
      "req-1",
      expect.objectContaining({ status: "REJECTED", rejectionReason: "Team is understaffed that week" })
    );
  });

  it("notifies the requesting employee's own login account with the rejection reason", async () => {
    vi.mocked(LeaveRequestRepository.findAnyById).mockResolvedValue({
      id: "req-1",
      status: "PENDING",
      startDate: new Date("2026-08-01"),
      endDate: new Date("2026-08-03"),
    } as never);
    vi.mocked(LeaveRequestRepository.update).mockResolvedValue({ id: "req-1", status: "REJECTED", employeeId: "emp-1" } as never);
    vi.mocked(prisma.user.findFirst).mockResolvedValue({ id: "user-emp-1" } as never);

    await rejectLeaveRequest(actor, "req-1", { reason: "Team is understaffed that week" });

    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-emp-1",
        title: "Leave request rejected",
        body: expect.stringContaining("Team is understaffed that week"),
        relatedModule: "LEAVE_REQUEST",
        relatedRecordId: "req-1",
      })
    );
  });
});
