import { beforeEach, describe, expect, it, vi } from "vitest";

const hrmsScope = vi.hoisted(() => ({ getHrmsEmployeeScope: vi.fn(), assertHrmsEmployeeInScope: vi.fn() }));
vi.mock("./hrms-scope", () => ({
  ...hrmsScope,
  hrmsEmployeeWhere: (scope: string[] | null) => (scope === null ? {} : { employeeId: { in: scope } }),
}));

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/core/rbac/PermissionService", () => ({ PermissionService: { assert: vi.fn() } }));
vi.mock("@/core/notifications/NotificationService", () => ({ createNotification: vi.fn().mockResolvedValue({}) }));
vi.mock("./attendance-events", () => ({ onAttendanceDayChanged: vi.fn() }));
vi.mock("./leave-balance.service", () => ({
  deductLeaveDay: vi.fn(),
  refundLeaveDay: vi.fn(),
}));

vi.mock("@/core/db/client", () => {
  const p = {
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(p)),
    employee: { findFirst: vi.fn(), findUniqueOrThrow: vi.fn() },
    user: { findFirst: vi.fn(), findUnique: vi.fn() },
    attendanceSettings: { findUnique: vi.fn() },
    holidayMaster: { findMany: vi.fn() },
    attendanceRecord: { findUnique: vi.fn(), upsert: vi.fn(), create: vi.fn(), update: vi.fn() },
    attendanceSession: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    attendanceCorrectionRequest: { updateMany: vi.fn(), update: vi.fn() },
    outdoorRejection: { findFirst: vi.fn() },
    leaveType: { findFirst: vi.fn() },
    leaveRequest: { create: vi.fn() },
    leaveDay: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn() },
  };
  return { prisma: p };
});

vi.mock("./attendance-correction.repository", () => ({
  AttendanceCorrectionRepository: {
    create: vi.fn(),
    update: vi.fn(),
    findAnyById: vi.fn(),
    findById: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
  },
}));

const { prisma } = await import("@/core/db/client");
const { PermissionService } = await import("@/core/rbac/PermissionService");
const { createNotification } = await import("@/core/notifications/NotificationService");
const { onAttendanceDayChanged } = await import("./attendance-events");
const { AttendanceCorrectionRepository } = await import("./attendance-correction.repository");
const {
  createAttendanceCorrectionRequest,
  approveAttendanceCorrectionRequest,
  rejectAttendanceCorrectionRequest,
} = await import("./attendance-correction.service");

const actor = { companyId: "co-1", userId: "user-1", branchId: "br-1" };

beforeEach(() => {
  hrmsScope.getHrmsEmployeeScope.mockReset().mockResolvedValue(null);
  hrmsScope.assertHrmsEmployeeInScope.mockReset().mockResolvedValue(undefined);
  vi.mocked(PermissionService.assert).mockReset().mockResolvedValue(undefined);
  vi.mocked(createNotification).mockReset().mockResolvedValue({} as never);
  vi.mocked(onAttendanceDayChanged).mockReset();

  vi.mocked(prisma.$transaction).mockImplementation(async (fn: unknown) => (fn as (tx: unknown) => Promise<unknown>)(prisma));
  vi.mocked(prisma.employee.findFirst).mockReset();
  vi.mocked(prisma.employee.findUniqueOrThrow).mockReset();
  vi.mocked(prisma.user.findFirst).mockReset();
  vi.mocked(prisma.user.findUnique).mockReset();
  vi.mocked(prisma.attendanceSettings.findUnique).mockReset().mockResolvedValue({ defaultWeekends: ["SUNDAY"], maxSessionHours: 18 } as never);
  vi.mocked(prisma.holidayMaster.findMany).mockReset().mockResolvedValue([]);
  vi.mocked(prisma.attendanceRecord.findUnique).mockReset().mockResolvedValue(null);
  vi.mocked(prisma.attendanceRecord.upsert).mockReset().mockResolvedValue({ id: "rec-1", companyId: "co-1", employeeId: "emp-1" } as never);
  vi.mocked(prisma.attendanceRecord.create).mockReset().mockResolvedValue({ id: "rec-new" } as never);
  vi.mocked(prisma.attendanceRecord.update).mockReset();
  vi.mocked(prisma.attendanceSession.findFirst).mockReset().mockResolvedValue(null);
  vi.mocked(prisma.attendanceSession.findMany).mockReset().mockResolvedValue([]);
  vi.mocked(prisma.attendanceSession.create).mockReset().mockResolvedValue({ id: "sess-new" } as never);
  vi.mocked(prisma.attendanceSession.update).mockReset();
  vi.mocked(prisma.attendanceCorrectionRequest.updateMany).mockReset().mockResolvedValue({ count: 1 });
  vi.mocked(prisma.attendanceCorrectionRequest.update).mockReset();
  vi.mocked(prisma.outdoorRejection.findFirst).mockReset().mockResolvedValue(null);
  vi.mocked(prisma.leaveDay.findFirst).mockReset().mockResolvedValue(null);
  vi.mocked(prisma.leaveDay.findMany).mockReset().mockResolvedValue([]);

  vi.mocked(AttendanceCorrectionRepository.create).mockReset();
  vi.mocked(AttendanceCorrectionRepository.update).mockReset();
  vi.mocked(AttendanceCorrectionRepository.findAnyById).mockReset();
  vi.mocked(AttendanceCorrectionRepository.findById).mockReset();
});

describe("createAttendanceCorrectionRequest", () => {
  it("links the existing AttendanceRecord for that date, if one exists", async () => {
    vi.mocked(prisma.employee.findFirst).mockResolvedValue({ id: "emp-1", fullName: "Asha Rao", reportsToId: null, attendanceProfile: null } as never);
    vi.mocked(prisma.attendanceRecord.findUnique).mockResolvedValue({ id: "rec-1" } as never);
    vi.mocked(AttendanceCorrectionRepository.create).mockResolvedValue({ id: "req-1", employeeId: "emp-1" } as never);

    await createAttendanceCorrectionRequest(actor, {
      employeeId: "emp-1",
      type: "MISSED_PUNCH",
      attendanceDate: "2026-09-01",
      checkIn: "09:00",
      checkOut: "18:00",
      reason: "Forgot to punch in on time due to a system outage",
    });

    expect(AttendanceCorrectionRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ attendanceRecordId: "rec-1", employeeId: "emp-1", type: "MISSED_PUNCH" })
    );
  });

  it("leaves attendanceRecordId null when no record exists yet for that date", async () => {
    vi.mocked(prisma.employee.findFirst).mockResolvedValue({ id: "emp-1", fullName: "Asha Rao", reportsToId: null, attendanceProfile: null } as never);
    vi.mocked(prisma.attendanceRecord.findUnique).mockResolvedValue(null);
    vi.mocked(AttendanceCorrectionRepository.create).mockResolvedValue({ id: "req-1", employeeId: "emp-1" } as never);

    await createAttendanceCorrectionRequest(actor, {
      employeeId: "emp-1",
      type: "MISSED_PUNCH",
      attendanceDate: "2026-09-01",
      checkIn: "09:00",
      checkOut: "18:00",
      reason: "Forgot to punch in entirely that day",
    });

    expect(AttendanceCorrectionRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ attendanceRecordId: null, employeeId: "emp-1", type: "MISSED_PUNCH" })
    );
  });

  it("notifies the employee's reporting manager when the manager has a login account", async () => {
    vi.mocked(prisma.employee.findFirst).mockResolvedValue({ id: "emp-1", fullName: "Asha Rao", reportsToId: "emp-mgr", attendanceProfile: null } as never);
    vi.mocked(prisma.user.findFirst).mockResolvedValue({ id: "user-mgr" } as never);
    vi.mocked(AttendanceCorrectionRepository.create).mockResolvedValue({ id: "req-1", employeeId: "emp-1" } as never);

    await createAttendanceCorrectionRequest(actor, {
      employeeId: "emp-1",
      type: "MISSED_PUNCH",
      attendanceDate: "2026-09-01",
      checkIn: "09:00",
      checkOut: "18:00",
      reason: "Punch-in device was offline",
    });

    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-mgr", relatedModule: "ATTENDANCE_CORRECTION", relatedRecordId: "req-1" })
    );
  });

  it("skips the notification when the employee has no reporting manager set", async () => {
    vi.mocked(prisma.employee.findFirst).mockResolvedValue({ id: "emp-1", fullName: "Asha Rao", reportsToId: null, attendanceProfile: null } as never);
    vi.mocked(AttendanceCorrectionRepository.create).mockResolvedValue({ id: "req-1", employeeId: "emp-1" } as never);

    await createAttendanceCorrectionRequest(actor, {
      employeeId: "emp-1",
      type: "MISSED_PUNCH",
      attendanceDate: "2026-09-01",
      checkIn: "09:00",
      checkOut: "18:00",
      reason: "Punch-in device was offline",
    });

    expect(prisma.user.findFirst).not.toHaveBeenCalled();
    expect(createNotification).not.toHaveBeenCalled();
  });
});

describe("approveAttendanceCorrectionRequest", () => {
  it("approves MISSED_PUNCH and creates a fresh session and syncs the day record", async () => {
    vi.mocked(AttendanceCorrectionRepository.findAnyById).mockResolvedValue({
      id: "req-1",
      type: "MISSED_PUNCH",
      status: "PENDING",
      employeeId: "emp-1",
      attendanceDate: new Date("2026-09-01"),
      requestedPunchIn: new Date("2026-09-01T03:30:00.000Z"),
      requestedPunchOut: new Date("2026-09-01T12:30:00.000Z"),
      createdByUserId: "user-2",
      reason: "Device offline",
    } as never);
    vi.mocked(AttendanceCorrectionRepository.findById).mockResolvedValue({ id: "req-1", status: "APPROVED" } as never);

    const result = await approveAttendanceCorrectionRequest(actor, "req-1");

    expect(prisma.attendanceCorrectionRequest.updateMany).toHaveBeenCalledWith({
      where: { id: "req-1", status: "PENDING" },
      data: expect.objectContaining({ status: "APPROVED", approvedByUserId: "user-1" }),
    });
    expect(prisma.attendanceSession.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          employeeId: "emp-1",
          source: "REGULARIZATION",
          status: "PRESENT",
        }),
      })
    );
    expect(onAttendanceDayChanged).toHaveBeenCalledWith("co-1", "emp-1", "2026-09-01");
    expect(result).toEqual({ id: "req-1", status: "APPROVED" });
  });

  it("returns existing record if already APPROVED (idempotent repeat)", async () => {
    vi.mocked(AttendanceCorrectionRepository.findAnyById).mockResolvedValue({
      id: "req-1",
      status: "APPROVED",
    } as never);
    vi.mocked(AttendanceCorrectionRepository.findById).mockResolvedValue({
      id: "req-1",
      status: "APPROVED",
    } as never);

    const result = await approveAttendanceCorrectionRequest(actor, "req-1");

    expect(result).toEqual({ id: "req-1", status: "APPROVED" });
    expect(prisma.attendanceCorrectionRequest.updateMany).not.toHaveBeenCalled();
  });

  it("asserts the self-approval guard with the request's real creator, and propagates a denial", async () => {
    vi.mocked(AttendanceCorrectionRepository.findAnyById).mockResolvedValue({
      id: "req-1",
      status: "PENDING",
      employeeId: "emp-1",
      createdByUserId: "user-1",
    } as never);
    vi.mocked(PermissionService.assert).mockRejectedValue(Object.assign(new Error("denied"), { code: "PERMISSION_DENIED" }));

    await expect(approveAttendanceCorrectionRequest(actor, "req-1")).rejects.toMatchObject({ code: "PERMISSION_DENIED" });

    expect(PermissionService.assert).toHaveBeenCalledWith(actor.userId, "hrms_attendance_regularization", "approve", { createdBy: "user-1" });
    expect(prisma.attendanceCorrectionRequest.updateMany).not.toHaveBeenCalled();
  });

  it("rejects re-approving a request that's no longer PENDING (e.g. REJECTED)", async () => {
    vi.mocked(AttendanceCorrectionRepository.findAnyById).mockResolvedValue({ id: "req-1", status: "REJECTED" } as never);

    await expect(approveAttendanceCorrectionRequest(actor, "req-1")).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  });

  it("notifies the requesting employee's own login account once approved", async () => {
    vi.mocked(AttendanceCorrectionRepository.findAnyById).mockResolvedValue({
      id: "req-1",
      type: "MISSED_PUNCH",
      status: "PENDING",
      employeeId: "emp-1",
      attendanceDate: new Date("2026-09-01"),
      requestedPunchIn: new Date("2026-09-01T03:30:00.000Z"),
      requestedPunchOut: new Date("2026-09-01T12:30:00.000Z"),
      createdByUserId: "user-2",
    } as never);
    vi.mocked(prisma.user.findFirst).mockResolvedValue({ id: "user-emp-1" } as never);

    await approveAttendanceCorrectionRequest(actor, "req-1");

    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-emp-1", title: "Missed punch approved", relatedModule: "ATTENDANCE_CORRECTION" })
    );
  });
});

describe("rejectAttendanceCorrectionRequest", () => {
  it("stores the rejection reason and notifies the requester", async () => {
    vi.mocked(AttendanceCorrectionRepository.findAnyById).mockResolvedValue({
      id: "req-1",
      type: "MISSED_PUNCH",
      status: "PENDING",
      employeeId: "emp-1",
      attendanceDate: new Date("2026-09-01"),
    } as never);
    vi.mocked(AttendanceCorrectionRepository.findById).mockResolvedValue({ id: "req-1", status: "REJECTED" } as never);
    vi.mocked(prisma.user.findFirst).mockResolvedValue({ id: "user-emp-1" } as never);

    await rejectAttendanceCorrectionRequest(actor, "req-1", { reason: "No supporting evidence for the claimed time" });

    expect(prisma.attendanceCorrectionRequest.updateMany).toHaveBeenCalledWith({
      where: { id: "req-1", status: "PENDING" },
      data: expect.objectContaining({ status: "REJECTED", rejectionReason: "No supporting evidence for the claimed time" }),
    });
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-emp-1", title: "Missed punch rejected", relatedModule: "ATTENDANCE_CORRECTION" })
    );
  });

  it("returns existing record if already REJECTED (idempotent repeat)", async () => {
    vi.mocked(AttendanceCorrectionRepository.findAnyById).mockResolvedValue({ id: "req-1", status: "REJECTED" } as never);
    vi.mocked(AttendanceCorrectionRepository.findById).mockResolvedValue({ id: "req-1", status: "REJECTED" } as never);

    const result = await rejectAttendanceCorrectionRequest(actor, "req-1", { reason: "test" });
    expect(result).toEqual({ id: "req-1", status: "REJECTED" });
    expect(prisma.attendanceCorrectionRequest.updateMany).not.toHaveBeenCalled();
  });

  it("rejects re-rejecting a request that's no longer PENDING (e.g. APPROVED)", async () => {
    vi.mocked(AttendanceCorrectionRepository.findAnyById).mockResolvedValue({ id: "req-1", status: "APPROVED" } as never);

    await expect(rejectAttendanceCorrectionRequest(actor, "req-1", { reason: "test" })).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  });
});
