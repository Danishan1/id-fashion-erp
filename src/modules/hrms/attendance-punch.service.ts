import { Prisma } from "@prisma/client";
import { writeAuditLog } from "@/core/audit/AuditLogger";
import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { deleteStoredFile } from "@/core/file-storage/FileStorage";
import { computeDayHours, evaluateGeofence, istDateKey, isValidCoordinate } from "./attendance-calculator";
import { getAttendanceSettings, listAttendanceLocations, type HrmsActor } from "./attendance-settings.service";
import { getOrCreateDayRecord, requireLinkedEmployee, saveImageFile, syncDayRecord } from "./attendance-session.core";
import { onAttendanceDayChanged } from "./attendance-events";

export interface PunchInput {
  type: "IN" | "OUT";
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
  address?: string | null;
  facePhotoId?: string | null;
  selfie: File | null;
}

/**
 * Old markAttendance(): selfie + GPS + face id, checked against every active
 * office location. IN refuses while a session is open; OUT closes the open
 * session only (fix F7: never overwrites an already-closed one).
 */
export async function punch(actor: HrmsActor, input: PunchInput, now: Date = new Date()) {
  const employee = await requireLinkedEmployee(actor.companyId, actor.userId);
  const settings = await getAttendanceSettings(actor.companyId);

  if (input.type !== "IN" && input.type !== "OUT") throw new BusinessRuleError("VALIDATION_ERROR", "Punch type must be IN or OUT.");
  if (!isValidCoordinate(input.latitude, input.longitude)) {
    throw new BusinessRuleError("VALIDATION_ERROR", "Your location could not be read. Turn on location (GPS) and try again.");
  }
  if (input.accuracyMeters === null || !Number.isFinite(input.accuracyMeters) || input.accuracyMeters > settings.gpsAccuracyMeters) {
    throw new BusinessRuleError(
      "VALIDATION_ERROR",
      `GPS accuracy is too low (${input.accuracyMeters === null ? "unknown" : Math.round(input.accuracyMeters) + " m"}). It must be within ${settings.gpsAccuracyMeters} m — move to an open area and try again.`
    );
  }
  if (!input.selfie) throw new BusinessRuleError("VALIDATION_ERROR", "A live selfie is required to punch.");

  if (input.facePhotoId) {
    const photo = await prisma.employeeFacePhoto.findFirst({ where: { id: input.facePhotoId, employeeId: employee.id, companyId: actor.companyId }, select: { id: true } });
    if (!photo) throw new BusinessRuleError("VALIDATION_ERROR", "Face verification failed — the matched face does not belong to you.");
  } else if (settings.requireFace) {
    throw new BusinessRuleError("VALIDATION_ERROR", "Face verification is required to punch.");
  }

  const locations = await listAttendanceLocations(actor.companyId, { activeOnly: true });
  if (locations.length === 0) throw new BusinessRuleError("VALIDATION_ERROR", "No office location is set up yet. Ask HR to add one in Attendance → Settings.");
  const geo = evaluateGeofence(input.latitude, input.longitude, locations);

  // Cheap pre-checks before storing a photo.
  const open = await prisma.attendanceSession.findFirst({
    where: { employeeId: employee.id, checkOutAt: null, source: "SELF_PUNCH" },
    orderBy: { checkInAt: "desc" },
  });
  if (input.type === "IN" && open) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "You are already logged in. Please punch out first.");
  if (input.type === "OUT" && !open) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "Cannot mark Time OUT without a corresponding Time IN.");

  const selfie = await saveImageFile(input.selfie, "Selfie");
  try {
    const result = await prisma.$transaction(async (tx) => {
      if (input.type === "IN") {
        const dateKey = istDateKey(now);
        const record = await getOrCreateDayRecord(tx, actor.companyId, employee.id, dateKey, actor.userId);
        const session = await tx.attendanceSession.create({
          data: {
            companyId: actor.companyId,
            attendanceRecordId: record.id,
            employeeId: employee.id,
            checkInAt: now,
            source: "SELF_PUNCH",
            // Fix F9: a punch outside every location is "Outside" straight away.
            status: geo.inside ? "PRESENT" : "PRESENT_FROM_OUTSIDE",
            isLoginFromOffice: geo.inside,
            inLatitude: input.latitude,
            inLongitude: input.longitude,
            inAccuracyMeters: input.accuracyMeters,
            inAddress: input.address || null,
            inLocationId: geo.location?.id ?? null,
            inDistanceMeters: geo.distanceMeters,
            inSelfieKey: selfie.storageKey,
            inSelfieMime: selfie.mimeType,
            inFacePhotoId: input.facePhotoId || null,
            createdByUserId: actor.userId,
          },
        });
        await syncDayRecord(tx, record.id);
        return { session, dateKey };
      }

      // OUT — re-read the open session inside the transaction.
      const current = await tx.attendanceSession.findFirst({
        where: { employeeId: employee.id, checkOutAt: null, source: "SELF_PUNCH" },
        orderBy: { checkInAt: "desc" },
      });
      if (!current) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "Cannot mark Time OUT without a corresponding Time IN.");
      if (now.getTime() <= current.checkInAt.getTime()) throw new BusinessRuleError("VALIDATION_ERROR", "Punch out must be after punch in.");
      const closed = await tx.attendanceSession.updateMany({
        where: { id: current.id, checkOutAt: null },
        data: {
          checkOutAt: now,
          isLogoutFromOffice: geo.inside,
          ...(geo.inside ? {} : { status: "PRESENT_FROM_OUTSIDE" as const }),
          outLatitude: input.latitude,
          outLongitude: input.longitude,
          outAccuracyMeters: input.accuracyMeters,
          outAddress: input.address || null,
          outLocationId: geo.location?.id ?? null,
          outDistanceMeters: geo.distanceMeters,
          outSelfieKey: selfie.storageKey,
          outSelfieMime: selfie.mimeType,
          outFacePhotoId: input.facePhotoId || null,
          updatedByUserId: actor.userId,
        },
      });
      if (closed.count === 0) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This session was already punched out.");
      await syncDayRecord(tx, current.attendanceRecordId);
      const session = await tx.attendanceSession.findUniqueOrThrow({ where: { id: current.id } });
      const record = await tx.attendanceRecord.findUniqueOrThrow({ where: { id: current.attendanceRecordId }, select: { attendanceDate: true } });
      return { session, dateKey: record.attendanceDate.toISOString().slice(0, 10) };
    });

    await writeAuditLog({
      companyId: actor.companyId,
      userId: actor.userId,
      tableName: "hrms_attendance_sessions",
      recordId: result.session.id,
      action: input.type === "IN" ? "CREATE" : "UPDATE",
      newValues: {
        punch: input.type,
        at: now.toISOString(),
        fromOffice: geo.inside,
        locationId: geo.location?.id ?? null,
        distanceMeters: geo.distanceMeters,
        accuracyMeters: input.accuracyMeters,
        facePhotoId: input.facePhotoId ?? null,
      },
    });

    if (input.type === "OUT") await onAttendanceDayChanged(actor.companyId, employee.id, result.dateKey);

    return {
      message: input.type === "IN" ? "Time IN marked successfully" : "Time OUT marked successfully",
      session: result.session,
      fromOffice: geo.inside,
      locationName: geo.inside ? (locations.find((l) => l.id === geo.location?.id)?.name ?? null) : null,
      distanceMeters: geo.distanceMeters,
    };
  } catch (error) {
    await deleteStoredFile(selfie.storageKey).catch(() => undefined);
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new BusinessRuleError("INVALID_STATE_TRANSITION", "You are already logged in. Please punch out first.");
    }
    throw error;
  }
}

/** Data for the My Attendance screen: today's sessions, live hours, face photos, rules. */
export async function getMyAttendanceToday(actor: HrmsActor, now: Date = new Date()) {
  const employee = await requireLinkedEmployee(actor.companyId, actor.userId);
  const settings = await getAttendanceSettings(actor.companyId);
  const dateKey = istDateKey(now);
  const [record, open, facePhotos, locationCount] = await Promise.all([
    prisma.attendanceRecord.findUnique({
      where: { employeeId_attendanceDate: { employeeId: employee.id, attendanceDate: new Date(`${dateKey}T00:00:00.000Z`) } },
      include: { sessions: { orderBy: { checkInAt: "asc" }, include: { inLocation: { select: { name: true } }, outLocation: { select: { name: true } } } } },
    }),
    prisma.attendanceSession.findFirst({ where: { employeeId: employee.id, checkOutAt: null, source: "SELF_PUNCH" }, orderBy: { checkInAt: "desc" } }),
    prisma.employeeFacePhoto.findMany({ where: { employeeId: employee.id }, select: { id: true }, orderBy: { createdAt: "asc" } }),
    prisma.attendanceLocation.count({ where: { companyId: actor.companyId, isActive: true } }),
  ]);
  const sessions = record?.sessions ?? [];
  // An open session started on an earlier day still counts as "logged in".
  const all = open && !sessions.some((s) => s.id === open.id) ? [...sessions, open] : sessions;
  const hours = computeDayHours(all, now, settings.maxSessionHours);
  return {
    employee: { id: employee.id, fullName: employee.fullName, employeeCode: employee.employeeCode, shift: employee.shift },
    dateKey,
    isPunchedIn: !!open,
    openSessionId: open?.id ?? null,
    sessions: all.map((s) => ({
      id: s.id,
      checkInAt: s.checkInAt,
      checkOutAt: s.checkOutAt,
      status: s.status,
      source: s.source,
      isLoginFromOffice: s.isLoginFromOffice,
      isLogoutFromOffice: s.isLogoutFromOffice,
      inLocationName: "inLocation" in s ? (s.inLocation as { name: string } | null)?.name ?? null : null,
      outLocationName: "outLocation" in s ? (s.outLocation as { name: string } | null)?.name ?? null : null,
      inDistanceMeters: s.inDistanceMeters,
      outDistanceMeters: s.outDistanceMeters,
    })),
    finalizedHours: hours.finalizedHours,
    liveHours: hours.liveHours,
    facePhotoIds: facePhotos.map((p) => p.id),
    hasLocations: locationCount > 0,
    rules: {
      requireFace: settings.requireFace,
      faceMatchThreshold: settings.faceMatchThreshold,
      faceMatchFrames: settings.faceMatchFrames,
      gpsAccuracyMeters: settings.gpsAccuracyMeters,
    },
  };
}
