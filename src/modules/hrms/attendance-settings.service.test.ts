import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma, mockWriteAuditLog } = vi.hoisted(() => ({
  mockPrisma: {
    attendanceSettings: { findUnique: vi.fn(), upsert: vi.fn() },
    attendanceLocation: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(), count: vi.fn() },
    attendanceSession: { count: vi.fn() },
    branch: { findFirst: vi.fn() },
    employee: { findFirst: vi.fn() },
    employeeAttendanceProfile: { findUnique: vi.fn(), upsert: vi.fn(), updateMany: vi.fn() },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(mockPrisma)),
  },
  mockWriteAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/core/db/client", () => ({ prisma: mockPrisma }));
vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: mockWriteAuditLog }));

import {
  DEFAULT_ATTENDANCE_SETTINGS,
  applyWeekendsToAll,
  createAttendanceLocation,
  effectiveWeekends,
  getAttendanceSettings,
  setAttendanceLocationActive,
  updateAttendanceLocation,
  updateAttendanceSettings,
  upsertEmployeeAttendanceProfile,
} from "./attendance-settings.service";

describe("attendance-settings.service (Unit Tests)", () => {
  const actor = { companyId: "c-1", userId: "u-1" };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getAttendanceSettings", () => {
    it("returns DEFAULT_ATTENDANCE_SETTINGS when no company row exists", async () => {
      mockPrisma.attendanceSettings.findUnique.mockResolvedValue(null);
      const settings = await getAttendanceSettings(actor.companyId);
      expect(settings).toEqual(DEFAULT_ATTENDANCE_SETTINGS);
    });

    it("returns formatted settings from database row", async () => {
      mockPrisma.attendanceSettings.findUnique.mockResolvedValue({
        defaultWeekends: ["SATURDAY", "SUNDAY"],
        gpsAccuracyMeters: 40,
        maxSessionHours: 14,
        statusToleranceMinutes: 20,
        faceMatchThreshold: 0.40,
        faceMatchFrames: 4,
        requireFace: false,
      });

      const settings = await getAttendanceSettings(actor.companyId);
      expect(settings.defaultWeekends).toEqual(["SATURDAY", "SUNDAY"]);
      expect(settings.requireFace).toBe(false);
      expect(settings.gpsAccuracyMeters).toBe(40);
    });
  });

  describe("updateAttendanceSettings (TDD)", () => {
    it("upserts settings and writes audit log", async () => {
      mockPrisma.attendanceSettings.findUnique
        .mockResolvedValueOnce(null) // before
        .mockResolvedValueOnce({
          defaultWeekends: ["SUNDAY"],
          gpsAccuracyMeters: 30,
          maxSessionHours: 12,
          statusToleranceMinutes: 10,
          faceMatchThreshold: 0.5,
          faceMatchFrames: 3,
          requireFace: true,
        }); // after

      mockPrisma.attendanceSettings.upsert.mockResolvedValue({ id: "settings-1" });

      const res = await updateAttendanceSettings(actor, {
        defaultWeekends: ["SUNDAY"],
        gpsAccuracyMeters: 30,
        maxSessionHours: 12,
        statusToleranceMinutes: 10,
        faceMatchThreshold: 0.5,
        faceMatchFrames: 3,
        requireFace: true,
      });

      expect(mockPrisma.attendanceSettings.upsert).toHaveBeenCalled();
      expect(mockWriteAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "UPDATE",
          tableName: "hrms_attendance_settings",
        })
      );
      expect(res.gpsAccuracyMeters).toBe(30);
    });
  });

  describe("applyWeekendsToAll", () => {
    it("updates company weekends and resets all employee profiles to use company weekends", async () => {
      mockPrisma.attendanceSettings.findUnique.mockResolvedValue({
        defaultWeekends: ["SUNDAY"],
        gpsAccuracyMeters: 50,
        maxSessionHours: 18,
        statusToleranceMinutes: 15,
        faceMatchThreshold: 0.45,
        faceMatchFrames: 3,
        requireFace: true,
      });
      mockPrisma.attendanceSettings.upsert.mockResolvedValue({ id: "settings-1" });
      mockPrisma.employeeAttendanceProfile.updateMany.mockResolvedValue({ count: 12 });

      await applyWeekendsToAll(actor, ["SATURDAY", "SUNDAY"]);

      expect(mockPrisma.employeeAttendanceProfile.updateMany).toHaveBeenCalledWith({
        where: { companyId: actor.companyId },
        data: { useCompanyWeekends: true },
      });
    });
  });

  describe("createAttendanceLocation", () => {
    it("throws VALIDATION_ERROR when latitude and longitude are both 0", async () => {
      await expect(
        createAttendanceLocation(actor, {
          name: "Null Island Office",
          latitude: 0,
          longitude: 0,
          radiusMeters: 100,
        })
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        message: expect.stringContaining("can't both be 0"),
      });
    });

    it("throws VALIDATION_ERROR if duplicate name exists", async () => {
      mockPrisma.attendanceLocation.findFirst.mockResolvedValue({ id: "loc-existing" });

      await expect(
        createAttendanceLocation(actor, {
          name: "Head Office",
          latitude: 12.9716,
          longitude: 77.5946,
          radiusMeters: 200,
        })
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        message: expect.stringContaining("already exists"),
      });
    });

    it("creates geofence location and writes audit log", async () => {
      mockPrisma.attendanceLocation.findFirst.mockResolvedValue(null);
      mockPrisma.attendanceLocation.create.mockResolvedValue({
        id: "loc-new",
        name: "Branch Office",
        latitude: 12.9716,
        longitude: 77.5946,
        radiusMeters: 250,
        isActive: true,
      });

      const res = await createAttendanceLocation(actor, {
        name: "Branch Office",
        latitude: 12.9716,
        longitude: 77.5946,
        radiusMeters: 250,
      });

      expect(res.name).toBe("Branch Office");
      expect(mockWriteAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "CREATE",
          recordId: "loc-new",
        })
      );
    });
  });

  describe("updateAttendanceLocation & setAttendanceLocationActive", () => {
    it("throws NOT_FOUND when updating non-existent location", async () => {
      mockPrisma.attendanceLocation.findFirst.mockResolvedValue(null);
      await expect(
        updateAttendanceLocation(actor, "missing-id", {
          name: "Non-existent",
          latitude: 10,
          longitude: 10,
          radiusMeters: 100,
        })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("sets location active/inactive and writes audit log", async () => {
      mockPrisma.attendanceLocation.findFirst.mockResolvedValue({ id: "loc-1", isActive: true });
      mockPrisma.attendanceLocation.update.mockResolvedValue({ id: "loc-1", isActive: false });

      const res = await setAttendanceLocationActive(actor, "loc-1", false);
      expect(res.isActive).toBe(false);
      expect(mockPrisma.attendanceLocation.update).toHaveBeenCalledWith({
        where: { id: "loc-1" },
        data: { isActive: false },
      });
      expect(mockWriteAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "UPDATE",
          tableName: "hrms_attendance_locations",
          recordId: "loc-1",
        })
      );
    });
  });

  describe("upsertEmployeeAttendanceProfile & effectiveWeekends", () => {
    it("throws NOT_FOUND if employee does not exist", async () => {
      mockPrisma.employee.findFirst.mockResolvedValue(null);
      await expect(
        upsertEmployeeAttendanceProfile(actor, "e-missing", {
          overtimeRatePerHour: 200,
          useCompanyWeekends: true,
          weekends: ["SUNDAY"],
        })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("upserts employee attendance profile with overtime rate and custom weekends", async () => {
      mockPrisma.employee.findFirst.mockResolvedValue({ id: "e-1" });
      mockPrisma.employeeAttendanceProfile.findUnique.mockResolvedValue(null);
      mockPrisma.employeeAttendanceProfile.upsert.mockResolvedValue({
        id: "prof-1",
        employeeId: "e-1",
        overtimeRatePerHour: 300,
        useCompanyWeekends: false,
        weekends: ["SATURDAY", "SUNDAY"],
      });

      const res = await upsertEmployeeAttendanceProfile(actor, "e-1", {
        overtimeRatePerHour: 300,
        useCompanyWeekends: false,
        weekends: ["SATURDAY", "SUNDAY"],
      });

      expect(res.overtimeRatePerHour).toBe(300);
      expect(mockWriteAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "CREATE",
          tableName: "hrms_employee_attendance_profiles",
        })
      );
    });

    it("computes effectiveWeekends based on company vs employee override", () => {
      const companySettings = { defaultWeekends: ["SUNDAY"] as const };
      expect(effectiveWeekends(companySettings, null)).toEqual(["SUNDAY"]);
      expect(effectiveWeekends(companySettings, { useCompanyWeekends: true, weekends: ["FRIDAY"] })).toEqual(["SUNDAY"]);
      expect(effectiveWeekends(companySettings, { useCompanyWeekends: false, weekends: ["SATURDAY", "SUNDAY"] })).toEqual(["SATURDAY", "SUNDAY"]);
    });
  });
});
