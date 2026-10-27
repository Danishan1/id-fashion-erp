import { beforeEach, describe, expect, it, vi } from "vitest";

const hrmsScope = vi.hoisted(() => ({ getHrmsEmployeeScope: vi.fn(), assertHrmsEmployeeInScope: vi.fn() }));
vi.mock("./hrms-scope", () => ({
  ...hrmsScope,
  hrmsEmployeeWhere: (scope: string[] | null) => (scope === null ? {} : { employeeId: { in: scope } }),
}));

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/core/rbac/PermissionService", () => ({ PermissionService: { assert: vi.fn() } }));
vi.mock("@/core/notifications/NotificationService", () => ({ createNotification: vi.fn().mockResolvedValue({}) }));

vi.mock("@/core/db/client", () => {
  const p = {
    employee: { findFirst: vi.fn() },
    attendanceSettings: { findUnique: vi.fn() },
    attendanceRecord: { findUnique: vi.fn() },
    overtimeRecord: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
    user: { findUnique: vi.fn() },
  };
  return { prisma: p };
});

const { prisma } = await import("@/core/db/client");
const { PermissionService } = await import("@/core/rbac/PermissionService");
const { createNotification } = await import("@/core/notifications/NotificationService");
const { recalculateOvertimeForDay, decideOvertime } = await import("./overtime.service");

const actor = { companyId: "co-1", userId: "user-1", branchId: "br-1" };

beforeEach(() => {
  hrmsScope.getHrmsEmployeeScope.mockReset().mockResolvedValue(null);
  hrmsScope.assertHrmsEmployeeInScope.mockReset().mockResolvedValue(undefined);
  vi.mocked(PermissionService.assert).mockReset().mockResolvedValue(undefined);
  vi.mocked(createNotification).mockReset().mockResolvedValue({} as never);

  vi.mocked(prisma.employee.findFirst).mockReset();
  vi.mocked(prisma.attendanceSettings.findUnique).mockReset().mockResolvedValue({ maxSessionHours: 18 } as never);
  vi.mocked(prisma.attendanceRecord.findUnique).mockReset();
  vi.mocked(prisma.overtimeRecord.findUnique).mockReset();
  vi.mocked(prisma.overtimeRecord.findFirst).mockReset();
  vi.mocked(prisma.overtimeRecord.create).mockReset().mockResolvedValue({ id: "ot-1" } as never);
  vi.mocked(prisma.overtimeRecord.update).mockReset();
  vi.mocked(prisma.overtimeRecord.updateMany).mockReset().mockResolvedValue({ count: 1 });
  vi.mocked(prisma.overtimeRecord.delete).mockReset();
  vi.mocked(prisma.overtimeRecord.findUniqueOrThrow).mockReset();
});

describe("overtime.service", () => {
  describe("recalculateOvertimeForDay", () => {
    it("returns null and deletes any pending OT if employee has no OT rate configured", async () => {
      vi.mocked(prisma.employee.findFirst).mockResolvedValue({
        id: "emp-1",
        shift: { startTime: "09:00", endTime: "18:00" }, // 9 h shift
        attendanceProfile: { overtimeRatePerHour: null },
      } as never);
      vi.mocked(prisma.overtimeRecord.findUnique).mockResolvedValue({ id: "ot-pending", status: "PENDING" } as never);

      const res = await recalculateOvertimeForDay("co-1", "emp-1", "2026-10-24");
      expect(res).toBeNull();
      expect(prisma.overtimeRecord.delete).toHaveBeenCalledWith({ where: { id: "ot-pending" } });
    });

    it("returns null and deletes any pending OT if employee has no shift configured", async () => {
      vi.mocked(prisma.employee.findFirst).mockResolvedValue({
        id: "emp-1",
        shift: null,
        attendanceProfile: { overtimeRatePerHour: 150 },
      } as never);
      vi.mocked(prisma.overtimeRecord.findUnique).mockResolvedValue({ id: "ot-pending", status: "PENDING" } as never);

      const res = await recalculateOvertimeForDay("co-1", "emp-1", "2026-10-24");
      expect(res).toBeNull();
      expect(prisma.overtimeRecord.delete).toHaveBeenCalledWith({ where: { id: "ot-pending" } });
    });

    it("never touches an already decided (APPROVED or REJECTED) record (fix F5)", async () => {
      vi.mocked(prisma.employee.findFirst).mockResolvedValue({
        id: "emp-1",
        shift: { startTime: "09:00", endTime: "18:00" },
        attendanceProfile: { overtimeRatePerHour: 150 },
      } as never);
      vi.mocked(prisma.overtimeRecord.findUnique).mockResolvedValue({
        id: "ot-approved",
        status: "APPROVED",
        hours: 2,
      } as never);

      const res = await recalculateOvertimeForDay("co-1", "emp-1", "2026-10-24");
      expect(res).toEqual(expect.objectContaining({ id: "ot-approved", status: "APPROVED" }));
      expect(prisma.overtimeRecord.create).not.toHaveBeenCalled();
      expect(prisma.overtimeRecord.update).not.toHaveBeenCalled();
      expect(prisma.overtimeRecord.delete).not.toHaveBeenCalled();
    });

    it("creates a pending OT record when worked hours exceed shift hours", async () => {
      vi.mocked(prisma.employee.findFirst).mockResolvedValue({
        id: "emp-1",
        shift: { startTime: "09:00", endTime: "17:00" }, // 8 h shift
        attendanceProfile: { overtimeRatePerHour: 200 },
      } as never);
      vi.mocked(prisma.overtimeRecord.findUnique).mockResolvedValue(null);
      // Worked 10 hours: 09:00 to 19:00
      vi.mocked(prisma.attendanceRecord.findUnique).mockResolvedValue({
        sessions: [
          {
            id: "s-1",
            checkInAt: new Date("2026-10-24T03:30:00.000Z"), // 09:00 IST
            checkOutAt: new Date("2026-10-24T13:30:00.000Z"), // 19:00 IST
          },
        ],
      } as never);

      const res = await recalculateOvertimeForDay("co-1", "emp-1", "2026-10-24");
      expect(prisma.overtimeRecord.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          companyId: "co-1",
          employeeId: "emp-1",
          hours: 2,
          workedHours: 10,
          shiftHours: 8,
          status: "PENDING",
        }),
      });
      expect(res).toBeDefined();
    });
  });

  describe("decideOvertime", () => {
    it("asserts self-approval guard on approve with employee user id, propagating a denial", async () => {
      vi.mocked(prisma.overtimeRecord.findFirst).mockResolvedValue({
        id: "ot-1",
        status: "PENDING",
        employeeId: "emp-1",
        employee: { fullName: "Asha Rao", user: { id: "user-asha" } },
      } as never);
      vi.mocked(PermissionService.assert).mockRejectedValue(Object.assign(new Error("denied"), { code: "PERMISSION_DENIED" }));

      await expect(decideOvertime(actor, "ot-1", "APPROVED")).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
      expect(PermissionService.assert).toHaveBeenCalledWith("user-1", "hrms_attendance_overtime", "approve", { createdBy: "user-asha" });
      expect(prisma.overtimeRecord.updateMany).not.toHaveBeenCalled();
    });

    it("rejecting without reason throws VALIDATION_ERROR", async () => {
      vi.mocked(prisma.overtimeRecord.findFirst).mockResolvedValue({
        id: "ot-1",
        status: "PENDING",
        employeeId: "emp-1",
        employee: { fullName: "Asha Rao", user: { id: "user-asha" } },
      } as never);

      await expect(decideOvertime(actor, "ot-1", "REJECTED", "")).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        message: expect.stringContaining("A reason is required to reject overtime"),
      });
    });

    it("is idempotent when decision matches current status", async () => {
      vi.mocked(prisma.overtimeRecord.findFirst).mockResolvedValue({
        id: "ot-1",
        status: "APPROVED",
        employeeId: "emp-1",
        employee: { fullName: "Asha Rao", user: { id: "user-asha" } },
      } as never);

      const res = await decideOvertime(actor, "ot-1", "APPROVED");
      expect(res.status).toBe("APPROVED");
      expect(prisma.overtimeRecord.updateMany).not.toHaveBeenCalled();
    });

    it("approves pending overtime and notifies employee", async () => {
      vi.mocked(prisma.overtimeRecord.findFirst).mockResolvedValue({
        id: "ot-1",
        status: "PENDING",
        employeeId: "emp-1",
        hours: 2.5,
        attendanceDate: new Date("2026-10-24T00:00:00.000Z"),
        employee: { fullName: "Asha Rao", user: { id: "user-asha" } },
      } as never);
      vi.mocked(prisma.overtimeRecord.findUniqueOrThrow).mockResolvedValue({
        id: "ot-1",
        status: "APPROVED",
        hours: 2.5,
        workedHours: 10.5,
        shiftHours: 8,
        employee: { attendanceProfile: { overtimeRatePerHour: 100 } },
      } as never);

      const res = await decideOvertime(actor, "ot-1", "APPROVED");

      expect(prisma.overtimeRecord.updateMany).toHaveBeenCalledWith({
        where: { id: "ot-1", status: "PENDING" },
        data: expect.objectContaining({ status: "APPROVED", decidedByUserId: "user-1" }),
      });
      expect(createNotification).toHaveBeenCalledWith(
        expect.objectContaining({ userId: "user-asha", title: "Overtime approved" })
      );
      expect(res.status).toBe("APPROVED");
    });
  });
});
