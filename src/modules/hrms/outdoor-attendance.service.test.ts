import { beforeEach, describe, expect, it, vi } from "vitest";

const hrmsScope = vi.hoisted(() => ({ getHrmsEmployeeScope: vi.fn(), assertHrmsEmployeeInScope: vi.fn() }));
vi.mock("./hrms-scope", () => ({
  ...hrmsScope,
  hrmsEmployeeWhere: (scope: string[] | null) => (scope === null ? {} : { employeeId: { in: scope } }),
}));

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/core/rbac/PermissionService", () => ({ PermissionService: { assert: vi.fn() } }));
vi.mock("@/core/notifications/NotificationService", () => ({ createNotification: vi.fn().mockResolvedValue({}) }));
vi.mock("./attendance-events", () => ({ onAttendanceDayChanged: vi.fn().mockResolvedValue(undefined) }));
vi.mock("./attendance-session.core", () => ({
  syncDayRecord: vi.fn().mockResolvedValue(undefined),
  saveProofFile: vi.fn(),
}));
vi.mock("./attendance-session.service", () => ({
  assertSessionTimesAllowed: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/core/db/client", () => {
  const p = {
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(p)),
    user: { findUnique: vi.fn(), findFirst: vi.fn() },
    attendanceSession: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    attendanceRecord: { findUnique: vi.fn() },
    outdoorRejection: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  };
  return { prisma: p };
});

const { prisma } = await import("@/core/db/client");
const { syncDayRecord } = await import("./attendance-session.core");
const { onAttendanceDayChanged } = await import("./attendance-events");
const {
  rejectOutdoorSession,
  acceptOutdoorRejection,
  clarifyOutdoorRejection,
  decideOutdoorClarification,
  cancelOutdoorRejection,
} = await import("./outdoor-attendance.service");

const adminActor = { companyId: "co-1", userId: "admin-1", branchId: "br-1" };
const employeeActor = { companyId: "co-1", userId: "emp-user-1", branchId: "br-1" };

beforeEach(() => {
  hrmsScope.getHrmsEmployeeScope.mockReset().mockResolvedValue(null);
  hrmsScope.assertHrmsEmployeeInScope.mockReset().mockResolvedValue(undefined);
  vi.mocked(syncDayRecord).mockReset();
  vi.mocked(onAttendanceDayChanged).mockReset();

  vi.mocked(prisma.$transaction).mockImplementation(async (fn: unknown) => (fn as (tx: unknown) => Promise<unknown>)(prisma));
  vi.mocked(prisma.user.findUnique).mockReset().mockResolvedValue({ employeeId: "admin-emp-id" } as never);
  vi.mocked(prisma.user.findFirst).mockReset().mockResolvedValue({ id: "emp-user-1" } as never);

  vi.mocked(prisma.attendanceSession.findFirst).mockReset();
  vi.mocked(prisma.attendanceSession.update).mockReset();
  vi.mocked(prisma.attendanceSession.updateMany).mockReset().mockResolvedValue({ count: 1 });

  vi.mocked(prisma.outdoorRejection.findFirst).mockReset();
  vi.mocked(prisma.outdoorRejection.create).mockReset().mockImplementation(((args: { data: Record<string, unknown> }) =>
    Promise.resolve({ id: "rej-1", ...args.data })) as never);
  vi.mocked(prisma.outdoorRejection.updateMany).mockReset().mockResolvedValue({ count: 1 });
});

describe("outdoor-attendance.service (trim, restore, cancel)", () => {
  const origIn = new Date("2026-10-24T09:00:00.000Z");
  const origOut = new Date("2026-10-24T18:00:00.000Z");
  const trimmedIn = new Date("2026-10-24T10:00:00.000Z");
  const trimmedOut = new Date("2026-10-24T17:00:00.000Z");

  it("trims session times on reject and stores originals in outdoorRejection", async () => {
    vi.mocked(prisma.attendanceSession.findFirst).mockResolvedValue({
      id: "sess-1",
      companyId: "co-1",
      employeeId: "emp-1",
      status: "PRESENT_FROM_OUTSIDE",
      checkInAt: origIn,
      checkOutAt: origOut,
      attendanceRecordId: "rec-1",
      attendanceRecord: { attendanceDate: new Date("2026-10-24T00:00:00.000Z") },
    } as never);
    vi.mocked(prisma.outdoorRejection.findFirst).mockResolvedValue(null);

    const rej = await rejectOutdoorSession(adminActor, "sess-1", {
      reason: "Client visit not pre-approved",
      trimmedCheckInAt: trimmedIn.toISOString(),
      trimmedCheckOutAt: trimmedOut.toISOString(),
    });

    expect(prisma.outdoorRejection.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sessionId: "sess-1",
        employeeId: "emp-1",
        originalCheckIn: origIn,
        originalCheckOut: origOut,
        trimmedCheckIn: trimmedIn,
        trimmedCheckOut: trimmedOut,
        rejectedReason: "Client visit not pre-approved",
      }),
    });
    expect(prisma.attendanceSession.update).toHaveBeenCalledWith({
      where: { id: "sess-1" },
      data: expect.objectContaining({
        checkInAt: trimmedIn,
        checkOutAt: trimmedOut,
      }),
    });
    expect(syncDayRecord).toHaveBeenCalledWith(expect.anything(), "rec-1");
    expect(onAttendanceDayChanged).toHaveBeenCalledWith("co-1", "emp-1", "2026-10-24");
    expect(rej.id).toBe("rej-1");
  });

  it("employee accepts outdoor rejection", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ employeeId: "emp-1" } as never);
    vi.mocked(prisma.outdoorRejection.findFirst).mockResolvedValue({
      id: "rej-1",
      employeeId: "emp-1",
      status: "PENDING",
      session: { attendanceRecord: { attendanceDate: new Date("2026-10-24T00:00:00.000Z") } },
    } as never);

    await acceptOutdoorRejection(employeeActor, "rej-1");

    expect(prisma.outdoorRejection.updateMany).toHaveBeenCalledWith({
      where: { id: "rej-1", status: "PENDING" },
      data: expect.objectContaining({ status: "APPROVED" }),
    });
  });

  it("employee clarifies outdoor rejection moving it to IN_PROCESS", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ employeeId: "emp-1" } as never);
    vi.mocked(prisma.outdoorRejection.findFirst).mockResolvedValue({
      id: "rej-1",
      employeeId: "emp-1",
      status: "PENDING",
      session: { attendanceRecord: { attendanceDate: new Date("2026-10-24T00:00:00.000Z") } },
    } as never);

    await clarifyOutdoorRejection(employeeActor, "rej-1", "I was on site visiting supplier ABC", null);

    expect(prisma.outdoorRejection.updateMany).toHaveBeenCalledWith({
      where: { id: "rej-1", status: "PENDING" },
      data: expect.objectContaining({
        status: "IN_PROCESS",
        clarificationReason: "I was on site visiting supplier ABC",
      }),
    });
  });

  it("admin approving clarification restores the original times and marks session REMOTE", async () => {
    vi.mocked(prisma.outdoorRejection.findFirst).mockResolvedValue({
      id: "rej-1",
      employeeId: "emp-1",
      sessionId: "sess-1",
      status: "IN_PROCESS",
      originalCheckIn: origIn,
      originalCheckOut: origOut,
      session: {
        id: "sess-1",
        attendanceRecordId: "rec-1",
        attendanceRecord: { attendanceDate: new Date("2026-10-24T00:00:00.000Z") },
      },
    } as never);

    await decideOutdoorClarification(adminActor, "rej-1", "APPROVED");

    expect(prisma.attendanceSession.update).toHaveBeenCalledWith({
      where: { id: "sess-1" },
      data: expect.objectContaining({
        checkInAt: origIn,
        checkOutAt: origOut,
        status: "REMOTE",
      }),
    });
    expect(syncDayRecord).toHaveBeenCalledWith(expect.anything(), "rec-1");
    expect(onAttendanceDayChanged).toHaveBeenCalledWith("co-1", "emp-1", "2026-10-24");
  });

  it("admin cancelling outdoor rejection restores original times", async () => {
    vi.mocked(prisma.outdoorRejection.findFirst).mockResolvedValue({
      id: "rej-1",
      employeeId: "emp-1",
      sessionId: "sess-1",
      status: "PENDING",
      originalCheckIn: origIn,
      originalCheckOut: origOut,
      session: {
        id: "sess-1",
        attendanceRecordId: "rec-1",
        attendanceRecord: { attendanceDate: new Date("2026-10-24T00:00:00.000Z") },
      },
    } as never);

    await cancelOutdoorRejection(adminActor, "rej-1");

    expect(prisma.outdoorRejection.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "APPROVED",
          isRevoked: true,
        }),
      })
    );
    expect(prisma.attendanceSession.update).toHaveBeenCalledWith({
      where: { id: "sess-1" },
      data: expect.objectContaining({
        checkInAt: origIn,
        checkOutAt: origOut,
        status: "REMOTE",
      }),
    });
    expect(onAttendanceDayChanged).toHaveBeenCalledWith("co-1", "emp-1", "2026-10-24");
  });
});
