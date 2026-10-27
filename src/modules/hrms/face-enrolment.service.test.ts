import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma, mockWriteAuditLog, mockSaveImageFile, mockDeleteStoredFile, mockReadStoredFile, mockPermissionService, mockAssertScope } = vi.hoisted(() => ({
  mockPrisma: {
    employee: { findFirst: vi.fn() },
    employeeFacePhoto: { findMany: vi.fn(), count: vi.fn(), create: vi.fn(), findFirst: vi.fn(), delete: vi.fn() },
    user: { findUnique: vi.fn() },
    attendanceSession: { findFirst: vi.fn() },
  },
  mockWriteAuditLog: vi.fn().mockResolvedValue(undefined),
  mockSaveImageFile: vi.fn(),
  mockDeleteStoredFile: vi.fn().mockResolvedValue(undefined),
  mockReadStoredFile: vi.fn().mockResolvedValue(Buffer.from("sample-image-data")),
  mockPermissionService: { can: vi.fn() },
  mockAssertScope: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/core/db/client", () => ({ prisma: mockPrisma }));
vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: mockWriteAuditLog }));
vi.mock("@/core/file-storage/FileStorage", () => ({
  deleteStoredFile: mockDeleteStoredFile,
  readStoredFile: mockReadStoredFile,
}));
vi.mock("@/core/rbac/PermissionService", () => ({ PermissionService: mockPermissionService }));
vi.mock("./attendance-session.core", () => ({ saveImageFile: mockSaveImageFile }));
vi.mock("./hrms-scope", () => ({ assertHrmsEmployeeInScope: mockAssertScope }));

import {
  MAX_FACE_PHOTOS,
  addFacePhotos,
  deleteFacePhoto,
  listFacePhotos,
  readFacePhoto,
  readSessionSelfie,
} from "./face-enrolment.service";

describe("face-enrolment.service (Unit Tests)", () => {
  const actor = { companyId: "c-1", userId: "u-1" };
  const employeeId = "e-1";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("listFacePhotos", () => {
    it("throws NOT_FOUND if employee does not exist in company", async () => {
      mockPrisma.employee.findFirst.mockResolvedValue(null);
      await expect(listFacePhotos(actor.companyId, employeeId)).rejects.toMatchObject({
        code: "NOT_FOUND",
        message: "Employee not found.",
      });
    });

    it("returns employee metadata and enrolled photos list", async () => {
      mockPrisma.employee.findFirst.mockResolvedValue({ id: employeeId, fullName: "Test Employee", employeeCode: "EMP-01" });
      const photos = [
        { id: "p-1", fileName: "face1.jpg", sizeBytes: 1024, createdAt: new Date() },
      ];
      mockPrisma.employeeFacePhoto.findMany.mockResolvedValue(photos);

      const res = await listFacePhotos(actor.companyId, employeeId);
      expect(res.employee.fullName).toBe("Test Employee");
      expect(res.photos).toHaveLength(1);
      expect(res.max).toBe(MAX_FACE_PHOTOS);
    });
  });

  describe("addFacePhotos (TDD)", () => {
    it("throws VALIDATION_ERROR when no files provided", async () => {
      mockPrisma.employee.findFirst.mockResolvedValue({ id: employeeId });
      await expect(addFacePhotos(actor, employeeId, [])).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        message: "Choose at least one photo.",
      });
    });

    it("throws VALIDATION_ERROR when total exceeds MAX_FACE_PHOTOS (3)", async () => {
      mockPrisma.employee.findFirst.mockResolvedValue({ id: employeeId });
      mockPrisma.employeeFacePhoto.count.mockResolvedValue(2);
      const fakeFiles = [
        new File([new Uint8Array(10)], "p1.jpg", { type: "image/jpeg" }),
        new File([new Uint8Array(10)], "p2.jpg", { type: "image/jpeg" }),
      ];

      await expect(addFacePhotos(actor, employeeId, fakeFiles)).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        message: expect.stringContaining("at most 3 face photos (2 already enrolled)"),
      });
    });

    it("saves image file, inserts record, and writes audit log on success", async () => {
      mockPrisma.employee.findFirst.mockResolvedValue({ id: employeeId });
      mockPrisma.employeeFacePhoto.count.mockResolvedValue(1);
      mockSaveImageFile.mockResolvedValue({
        storageKey: "storage-key-123",
        mimeType: "image/jpeg",
        sizeBytes: 2048,
      });
      mockPrisma.employeeFacePhoto.create.mockResolvedValue({
        id: "photo-new",
        fileName: "profile.jpg",
        sizeBytes: 2048,
        createdAt: new Date(),
      });

      const file = new File([new Uint8Array(2048)], "profile.jpg", { type: "image/jpeg" });
      const result = await addFacePhotos(actor, employeeId, [file]);

      expect(mockSaveImageFile).toHaveBeenCalledWith(file, "Face photo");
      expect(mockPrisma.employeeFacePhoto.create).toHaveBeenCalledWith({
        data: {
          companyId: actor.companyId,
          employeeId,
          storageKey: "storage-key-123",
          mimeType: "image/jpeg",
          fileName: "profile.jpg",
          sizeBytes: 2048,
          uploadedByUserId: actor.userId,
        },
        select: expect.any(Object),
      });
      expect(mockWriteAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "CREATE",
          recordId: "photo-new",
        })
      );
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("photo-new");
    });
  });

  describe("deleteFacePhoto", () => {
    it("throws NOT_FOUND if photo does not exist", async () => {
      mockPrisma.employeeFacePhoto.findFirst.mockResolvedValue(null);
      await expect(deleteFacePhoto(actor, "p-missing")).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("deletes photo row, storage file, and writes audit log", async () => {
      mockPrisma.employeeFacePhoto.findFirst.mockResolvedValue({
        id: "p-1",
        employeeId,
        fileName: "p1.jpg",
        storageKey: "storage/p1.jpg",
        companyId: actor.companyId,
      });
      mockPrisma.employeeFacePhoto.delete.mockResolvedValue({ id: "p-1" });

      const res = await deleteFacePhoto(actor, "p-1");
      expect(res.id).toBe("p-1");
      expect(mockPrisma.employeeFacePhoto.delete).toHaveBeenCalledWith({ where: { id: "p-1" } });
      expect(mockDeleteStoredFile).toHaveBeenCalledWith("storage/p1.jpg");
      expect(mockWriteAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "DELETE", recordId: "p-1" }));
    });
  });

  describe("readFacePhoto & readSessionSelfie", () => {
    it("allows the employee themselves to read their own face photo", async () => {
      mockPrisma.employeeFacePhoto.findFirst.mockResolvedValue({
        id: "p-1",
        employeeId,
        storageKey: "key-1",
        mimeType: "image/jpeg",
      });
      mockPrisma.user.findUnique.mockResolvedValue({ employeeId }); // self

      const file = await readFacePhoto(actor, "p-1");
      expect(file.mimeType).toBe("image/jpeg");
      expect(mockReadStoredFile).toHaveBeenCalledWith("key-1");
    });

    it("forbids another user without hrms_attendance_settings:edit permission", async () => {
      mockPrisma.employeeFacePhoto.findFirst.mockResolvedValue({
        id: "p-1",
        employeeId,
        storageKey: "key-1",
        mimeType: "image/jpeg",
      });
      mockPrisma.user.findUnique.mockResolvedValue({ employeeId: "e-other" });
      mockPermissionService.can.mockResolvedValue(false);

      await expect(readFacePhoto(actor, "p-1")).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("reads in-punch selfie after validating employee in scope", async () => {
      mockPrisma.attendanceSession.findFirst.mockResolvedValue({
        id: "s-1",
        employeeId,
        inSelfieKey: "selfie-in-key",
        inSelfieMime: "image/png",
      });

      const selfie = await readSessionSelfie(actor, "s-1", "in");
      expect(mockAssertScope).toHaveBeenCalledWith(actor.userId, ["hrms_attendance_team", "hrms_attendance_photos", "hrms_attendance_outdoor"], employeeId, expect.any(Object));
      expect(selfie.mimeType).toBe("image/png");
      expect(mockReadStoredFile).toHaveBeenCalledWith("selfie-in-key");
    });
  });
});
