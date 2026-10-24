import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/core/file-storage/FileStorage", () => ({
  deleteStoredFile: vi.fn().mockImplementation(() => Promise.resolve()),
}));
vi.mock("./attendance-events", () => ({
  onAttendanceDayChanged: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./attendance-session.core", () => ({
  requireLinkedEmployee: vi.fn(),
  saveImageFile: vi.fn(),
  getOrCreateDayRecord: vi.fn(),
  syncDayRecord: vi.fn(),
}));

vi.mock("@/core/db/client", () => {
  const p = {
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(p)),
    employeeFacePhoto: { findFirst: vi.fn() },
    attendanceSettings: { findUnique: vi.fn() },
    attendanceLocation: { findMany: vi.fn() },
    attendanceSession: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
    },
    attendanceRecord: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
  };
  return { prisma: p };
});

const { prisma } = await import("@/core/db/client");
const { requireLinkedEmployee, saveImageFile, getOrCreateDayRecord, syncDayRecord } = await import("./attendance-session.core");
const { onAttendanceDayChanged } = await import("./attendance-events");
const { deleteStoredFile } = await import("@/core/file-storage/FileStorage");
const { punch } = await import("./attendance-punch.service");

const actor = { companyId: "co-1", userId: "user-1", branchId: "br-1" };
const fakeSelfie = new File(["bytes"], "selfie.jpg", { type: "image/jpeg" });

beforeEach(() => {
  vi.mocked(requireLinkedEmployee).mockReset().mockResolvedValue({ id: "emp-1", fullName: "Asha Rao" } as never);
  vi.mocked(saveImageFile).mockReset().mockResolvedValue({ storageKey: "selfies/1.jpg", mimeType: "image/jpeg", sizeBytes: 100 } as never);
  vi.mocked(getOrCreateDayRecord).mockReset().mockResolvedValue({ id: "rec-1" } as never);
  vi.mocked(syncDayRecord).mockReset().mockResolvedValue(undefined as never);
  vi.mocked(onAttendanceDayChanged).mockReset();
  vi.mocked(deleteStoredFile).mockReset();

  vi.mocked(prisma.$transaction).mockImplementation(async (fn: unknown) => (fn as (tx: unknown) => Promise<unknown>)(prisma));
  vi.mocked(prisma.attendanceSettings.findUnique).mockReset().mockResolvedValue({
    gpsAccuracyMeters: 50,
    requireFace: false,
    requireSelfie: true,
  } as never);
  vi.mocked(prisma.attendanceLocation.findMany).mockReset().mockResolvedValue([
    { id: "loc-1", name: "HQ", latitude: 12.9716, longitude: 77.5946, radiusMeters: 100, isActive: true },
  ] as never);
  vi.mocked(prisma.employeeFacePhoto.findFirst).mockReset().mockResolvedValue({ id: "photo-1" } as never);
  vi.mocked(prisma.attendanceSession.findFirst).mockReset().mockResolvedValue(null);
  vi.mocked(prisma.attendanceSession.create).mockReset().mockImplementation(((args: { data: Record<string, unknown> }) =>
    Promise.resolve({ id: "sess-1", ...args.data })) as never);
  vi.mocked(prisma.attendanceSession.updateMany).mockReset().mockResolvedValue({ count: 1 });
});

describe("attendance-punch.service (punch rules)", () => {
  it("refuses punch IN when a session is already open", async () => {
    vi.mocked(prisma.attendanceSession.findFirst).mockResolvedValue({
      id: "open-sess",
      checkInAt: new Date("2026-10-24T09:00:00Z"),
      checkOutAt: null,
    } as never);

    await expect(
      punch(actor, {
        type: "IN",
        latitude: 12.9716,
        longitude: 77.5946,
        accuracyMeters: 15,
        selfie: fakeSelfie,
      })
    ).rejects.toMatchObject({
      code: "INVALID_STATE_TRANSITION",
      message: expect.stringContaining("already logged in"),
    });
  });

  it("refuses punch OUT when no session is open", async () => {
    vi.mocked(prisma.attendanceSession.findFirst).mockResolvedValue(null);

    await expect(
      punch(actor, {
        type: "OUT",
        latitude: 12.9716,
        longitude: 77.5946,
        accuracyMeters: 15,
        selfie: fakeSelfie,
      })
    ).rejects.toMatchObject({
      code: "INVALID_STATE_TRANSITION",
      message: expect.stringContaining("Cannot mark Time OUT without a corresponding Time IN"),
    });
  });

  it("refuses punch when GPS coordinate is invalid (0, 0)", async () => {
    await expect(
      punch(actor, {
        type: "IN",
        latitude: 0,
        longitude: 0,
        accuracyMeters: 10,
        selfie: fakeSelfie,
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: expect.stringContaining("Turn on location (GPS)"),
    });
  });

  it("refuses punch when GPS accuracy exceeds setting threshold", async () => {
    await expect(
      punch(actor, {
        type: "IN",
        latitude: 12.9716,
        longitude: 77.5946,
        accuracyMeters: 120, // threshold is 50
        selfie: fakeSelfie,
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: expect.stringContaining("GPS accuracy is too low"),
    });
  });

  it("refuses punch when no active office locations exist", async () => {
    vi.mocked(prisma.attendanceLocation.findMany).mockResolvedValue([]);

    await expect(
      punch(actor, {
        type: "IN",
        latitude: 12.9716,
        longitude: 77.5946,
        accuracyMeters: 20,
        selfie: fakeSelfie,
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: expect.stringContaining("No office location is set up yet"),
    });
  });

  it("refuses punch when face verification is required by settings but facePhotoId is missing", async () => {
    vi.mocked(prisma.attendanceSettings.findUnique).mockResolvedValue({
      gpsAccuracyMeters: 50,
      requireFace: true,
      requireSelfie: true,
    } as never);

    await expect(
      punch(actor, {
        type: "IN",
        latitude: 12.9716,
        longitude: 77.5946,
        accuracyMeters: 20,
        selfie: fakeSelfie,
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: expect.stringContaining("Face verification is required"),
    });
  });

  it("refuses punch when facePhotoId does not belong to the employee", async () => {
    vi.mocked(prisma.employeeFacePhoto.findFirst).mockResolvedValue(null);

    await expect(
      punch(actor, {
        type: "IN",
        latitude: 12.9716,
        longitude: 77.5946,
        accuracyMeters: 20,
        facePhotoId: "other-user-photo",
        selfie: fakeSelfie,
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: expect.stringContaining("face does not belong to you"),
    });
  });

  it("marks session as PRESENT_FROM_OUTSIDE when punching outside all geofences (F9)", async () => {
    // 13.0827, 80.2707 is Chennai (~290 km away from Bangalore 12.9716, 77.5946)
    const res = await punch(actor, {
      type: "IN",
      latitude: 13.0827,
      longitude: 80.2707,
      accuracyMeters: 20,
      selfie: fakeSelfie,
    });

    expect(prisma.attendanceSession.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "PRESENT_FROM_OUTSIDE",
          isLoginFromOffice: false,
        }),
      })
    );
    expect(res.session.status).toBe("PRESENT_FROM_OUTSIDE");
  });

  it("marks session as PRESENT when inside geofence", async () => {
    const res = await punch(actor, {
      type: "IN",
      latitude: 12.9716,
      longitude: 77.5946,
      accuracyMeters: 10,
      selfie: fakeSelfie,
    });

    expect(prisma.attendanceSession.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "PRESENT",
          isLoginFromOffice: true,
        }),
      })
    );
    expect(res.session.status).toBe("PRESENT");
  });

  it("closes the open session on OUT and triggers overtime recalculation via onAttendanceDayChanged", async () => {
    const inTime = new Date("2026-10-24T09:00:00Z");
    const outTime = new Date("2026-10-24T18:00:00Z");
    vi.mocked(prisma.attendanceSession.findFirst).mockResolvedValue({
      id: "open-sess",
      attendanceRecordId: "rec-1",
      checkInAt: inTime,
      checkOutAt: null,
      source: "SELF_PUNCH",
    } as never);
    vi.mocked(prisma.attendanceSession.findUniqueOrThrow).mockResolvedValue({
      id: "open-sess",
      attendanceRecordId: "rec-1",
      checkInAt: inTime,
      checkOutAt: outTime,
      source: "SELF_PUNCH",
      status: "PRESENT",
    } as never);
    vi.mocked(prisma.attendanceRecord.findUniqueOrThrow).mockResolvedValue({
      id: "rec-1",
      attendanceDate: new Date("2026-10-24T00:00:00Z"),
    } as never);

    const res = await punch(
      actor,
      {
        type: "OUT",
        latitude: 12.9716,
        longitude: 77.5946,
        accuracyMeters: 10,
        selfie: fakeSelfie,
      },
      outTime
    );

    expect(prisma.attendanceSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "open-sess", checkOutAt: null },
      })
    );
    expect(onAttendanceDayChanged).toHaveBeenCalledWith("co-1", "emp-1", "2026-10-24");
    expect(res.session.checkOutAt).toEqual(outTime);
    expect(res.message).toBe("Time OUT marked successfully");
  });
});
