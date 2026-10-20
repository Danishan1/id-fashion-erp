import { beforeEach, describe, expect, it, vi } from "vitest";

const hrmsScope = vi.hoisted(() => ({ getHrmsEmployeeScope: vi.fn(), assertHrmsEmployeeInScope: vi.fn() }));
vi.mock("./hrms-scope", () => ({
  ...hrmsScope,
  hrmsEmployeeWhere: (scope: string[] | null) => (scope === null ? {} : { employeeId: { in: scope } }),
}));

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/core/rbac/PermissionService", () => ({ PermissionService: { assert: vi.fn() } }));
vi.mock("@/core/notifications/NotificationService", () => ({ createNotification: vi.fn() }));
vi.mock("@/core/db/client", () => ({
  prisma: {
    employee: { findFirst: vi.fn() },
    user: { findFirst: vi.fn() },
  },
}));
vi.mock("./attendance.repository", () => ({
  AttendanceRepository: {
    findByEmployeeAndDate: vi.fn(),
    upsert: vi.fn(),
  },
}));
vi.mock("./attendance-correction.repository", () => ({
  AttendanceCorrectionRepository: {
    create: vi.fn(),
    update: vi.fn(),
    findAnyById: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
  },
}));

const { prisma } = await import("@/core/db/client");
const { PermissionService } = await import("@/core/rbac/PermissionService");
const { createNotification } = await import("@/core/notifications/NotificationService");
const { AttendanceRepository } = await import("./attendance.repository");
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
  vi.mocked(prisma.employee.findFirst).mockReset();
  vi.mocked(prisma.user.findFirst).mockReset();
  vi.mocked(PermissionService.assert).mockReset().mockResolvedValue(undefined);
  vi.mocked(createNotification).mockReset();
  vi.mocked(AttendanceRepository.findByEmployeeAndDate).mockReset();
  vi.mocked(AttendanceRepository.upsert).mockReset();
  vi.mocked(AttendanceCorrectionRepository.create).mockReset();
  vi.mocked(AttendanceCorrectionRepository.update).mockReset();
  vi.mocked(AttendanceCorrectionRepository.findAnyById).mockReset();
});

describe("createAttendanceCorrectionRequest", () => {
  it("links the existing AttendanceRecord for that date, if one exists", async () => {
    vi.mocked(prisma.employee.findFirst).mockResolvedValue({ id: "emp-1", fullName: "Asha Rao", reportsToId: null } as never);
    vi.mocked(AttendanceRepository.findByEmployeeAndDate).mockResolvedValue({ id: "rec-1" } as never);
    vi.mocked(AttendanceCorrectionRepository.create).mockResolvedValue({ id: "req-1", employeeId: "emp-1" } as never);

    await createAttendanceCorrectionRequest(actor, {
      employeeId: "emp-1",
      attendanceDate: "2026-09-01",
      requestedPunchIn: "2026-09-01T09:15:00",
      requestedPunchOut: "",
      reason: "Forgot to punch in on time due to a system outage",
    } as never);

    expect(AttendanceCorrectionRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ attendanceRecordId: "rec-1", employeeId: "emp-1" })
    );
  });

  it("leaves attendanceRecordId null when no record exists yet for that date", async () => {
    vi.mocked(prisma.employee.findFirst).mockResolvedValue({ id: "emp-1", fullName: "Asha Rao", reportsToId: null } as never);
    vi.mocked(AttendanceRepository.findByEmployeeAndDate).mockResolvedValue(null as never);
    vi.mocked(AttendanceCorrectionRepository.create).mockResolvedValue({ id: "req-1", employeeId: "emp-1" } as never);

    await createAttendanceCorrectionRequest(actor, {
      employeeId: "emp-1",
      attendanceDate: "2026-09-01",
      requestedPunchIn: "2026-09-01T09:15:00",
      requestedPunchOut: "",
      reason: "Forgot to punch in entirely that day",
    } as never);

    expect(AttendanceCorrectionRepository.create).toHaveBeenCalledWith(expect.objectContaining({ attendanceRecordId: null }));
  });

  it("notifies the employee's reporting manager when the manager has a login account", async () => {
    vi.mocked(prisma.employee.findFirst).mockResolvedValue({ id: "emp-1", fullName: "Asha Rao", reportsToId: "emp-mgr" } as never);
    vi.mocked(AttendanceRepository.findByEmployeeAndDate).mockResolvedValue(null as never);
    vi.mocked(prisma.user.findFirst).mockResolvedValue({ id: "user-mgr" } as never);
    vi.mocked(AttendanceCorrectionRepository.create).mockResolvedValue({ id: "req-1", employeeId: "emp-1" } as never);

    await createAttendanceCorrectionRequest(actor, {
      employeeId: "emp-1",
      attendanceDate: "2026-09-01",
      requestedPunchIn: "2026-09-01T09:15:00",
      requestedPunchOut: "",
      reason: "Punch-in device was offline",
    } as never);

    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-mgr", relatedModule: "ATTENDANCE_CORRECTION", relatedRecordId: "req-1" })
    );
  });

  it("skips the notification when the employee has no reporting manager set", async () => {
    vi.mocked(prisma.employee.findFirst).mockResolvedValue({ id: "emp-1", fullName: "Asha Rao", reportsToId: null } as never);
    vi.mocked(AttendanceRepository.findByEmployeeAndDate).mockResolvedValue(null as never);
    vi.mocked(AttendanceCorrectionRepository.create).mockResolvedValue({ id: "req-1", employeeId: "emp-1" } as never);

    await createAttendanceCorrectionRequest(actor, {
      employeeId: "emp-1",
      attendanceDate: "2026-09-01",
      requestedPunchIn: "2026-09-01T09:15:00",
      requestedPunchOut: "",
      reason: "Punch-in device was offline",
    } as never);

    expect(prisma.user.findFirst).not.toHaveBeenCalled();
    expect(createNotification).not.toHaveBeenCalled();
  });
});

describe("approveAttendanceCorrectionRequest", () => {
  it("merges the requested field(s) with the existing record, preserving whatever wasn't requested", async () => {
    vi.mocked(AttendanceCorrectionRepository.findAnyById).mockResolvedValue({
      id: "req-1",
      status: "PENDING",
      employeeId: "emp-1",
      attendanceDate: new Date("2026-09-01"),
      requestedPunchIn: new Date("2026-09-01T09:15:00"),
      requestedPunchOut: null,
      createdByUserId: "user-2",
    } as never);
    vi.mocked(AttendanceRepository.findByEmployeeAndDate).mockResolvedValue({
      punchIn: new Date("2026-09-01T10:00:00"),
      punchOut: new Date("2026-09-01T18:00:00"),
      remarks: "existing remark",
    } as never);
    vi.mocked(AttendanceRepository.upsert).mockResolvedValue({ id: "rec-1" } as never);
    vi.mocked(AttendanceCorrectionRepository.update).mockResolvedValue({ id: "req-1", status: "APPROVED", employeeId: "emp-1" } as never);

    await approveAttendanceCorrectionRequest(actor, "req-1");

    expect(AttendanceRepository.upsert).toHaveBeenCalledWith(
      "emp-1",
      new Date("2026-09-01"),
      expect.objectContaining({
        punchIn: new Date("2026-09-01T09:15:00"), // requested value wins
        punchOut: new Date("2026-09-01T18:00:00"), // untouched field is preserved
        recordedByUserId: "user-1",
      }),
      "co-1"
    );
    expect(AttendanceCorrectionRepository.update).toHaveBeenCalledWith("req-1", expect.objectContaining({ status: "APPROVED", attendanceRecordId: "rec-1" }));
  });

  it("creates a fresh record when none existed for that date at all", async () => {
    vi.mocked(AttendanceCorrectionRepository.findAnyById).mockResolvedValue({
      id: "req-1",
      status: "PENDING",
      employeeId: "emp-1",
      attendanceDate: new Date("2026-09-01"),
      requestedPunchIn: new Date("2026-09-01T09:15:00"),
      requestedPunchOut: null,
      createdByUserId: "user-2",
    } as never);
    vi.mocked(AttendanceRepository.findByEmployeeAndDate).mockResolvedValue(null as never);
    vi.mocked(AttendanceRepository.upsert).mockResolvedValue({ id: "rec-new" } as never);
    vi.mocked(AttendanceCorrectionRepository.update).mockResolvedValue({ id: "req-1", status: "APPROVED", employeeId: "emp-1" } as never);

    await approveAttendanceCorrectionRequest(actor, "req-1");

    expect(AttendanceRepository.upsert).toHaveBeenCalledWith(
      "emp-1",
      new Date("2026-09-01"),
      expect.objectContaining({ punchIn: new Date("2026-09-01T09:15:00"), punchOut: null }),
      "co-1"
    );
  });

  it("asserts the self-approval guard with the request's real creator, and propagates a denial", async () => {
    vi.mocked(AttendanceCorrectionRepository.findAnyById).mockResolvedValue({
      id: "req-1",
      status: "PENDING",
      createdByUserId: "user-1",
    } as never);
    vi.mocked(PermissionService.assert).mockRejectedValue(Object.assign(new Error("denied"), { code: "PERMISSION_DENIED" }));

    await expect(approveAttendanceCorrectionRequest(actor, "req-1")).rejects.toMatchObject({ code: "PERMISSION_DENIED" });

    expect(PermissionService.assert).toHaveBeenCalledWith(actor.userId, "hrms_attendance", "approve", { createdBy: "user-1" });
    expect(AttendanceRepository.upsert).not.toHaveBeenCalled();
  });

  it("rejects re-approving a request that's no longer PENDING", async () => {
    vi.mocked(AttendanceCorrectionRepository.findAnyById).mockResolvedValue({ id: "req-1", status: "APPROVED" } as never);

    await expect(approveAttendanceCorrectionRequest(actor, "req-1")).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  });

  it("notifies the requesting employee's own login account once approved", async () => {
    vi.mocked(AttendanceCorrectionRepository.findAnyById).mockResolvedValue({
      id: "req-1",
      status: "PENDING",
      employeeId: "emp-1",
      attendanceDate: new Date("2026-09-01"),
      requestedPunchIn: new Date("2026-09-01T09:15:00"),
      requestedPunchOut: null,
      createdByUserId: "user-2",
    } as never);
    vi.mocked(AttendanceRepository.findByEmployeeAndDate).mockResolvedValue(null as never);
    vi.mocked(AttendanceRepository.upsert).mockResolvedValue({ id: "rec-1" } as never);
    vi.mocked(AttendanceCorrectionRepository.update).mockResolvedValue({ id: "req-1", status: "APPROVED", employeeId: "emp-1" } as never);
    vi.mocked(prisma.user.findFirst).mockResolvedValue({ id: "user-emp-1" } as never);

    await approveAttendanceCorrectionRequest(actor, "req-1");

    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-emp-1", title: "Attendance correction approved", relatedModule: "ATTENDANCE_CORRECTION" })
    );
  });
});

describe("rejectAttendanceCorrectionRequest", () => {
  it("stores the rejection reason and notifies the requester", async () => {
    vi.mocked(AttendanceCorrectionRepository.findAnyById).mockResolvedValue({
      id: "req-1",
      status: "PENDING",
      attendanceDate: new Date("2026-09-01"),
    } as never);
    vi.mocked(AttendanceCorrectionRepository.update).mockResolvedValue({ id: "req-1", status: "REJECTED", employeeId: "emp-1" } as never);
    vi.mocked(prisma.user.findFirst).mockResolvedValue({ id: "user-emp-1" } as never);

    await rejectAttendanceCorrectionRequest(actor, "req-1", { reason: "No supporting evidence for the claimed time" });

    expect(AttendanceCorrectionRepository.update).toHaveBeenCalledWith(
      "req-1",
      expect.objectContaining({ status: "REJECTED", rejectionReason: "No supporting evidence for the claimed time" })
    );
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-emp-1", title: "Attendance correction rejected", relatedModule: "ATTENDANCE_CORRECTION" })
    );
  });

  it("rejects re-rejecting a request that's no longer PENDING", async () => {
    vi.mocked(AttendanceCorrectionRepository.findAnyById).mockResolvedValue({ id: "req-1", status: "REJECTED" } as never);

    await expect(rejectAttendanceCorrectionRequest(actor, "req-1", { reason: "test" })).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  });
});
