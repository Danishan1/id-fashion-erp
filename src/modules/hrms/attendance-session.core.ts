import type { Prisma } from "@prisma/client";
import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { FileTooLargeError, UnsupportedFileTypeError, saveFile } from "@/core/file-storage/FileStorage";
import { dateKeyToDbDate } from "./attendance-calculator";

type Tx = Prisma.TransactionClient;

/** The employee a logged-in user punches as (User.employeeId). */
export async function getLinkedEmployee(companyId: string, userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      employee: {
        select: {
          id: true,
          companyId: true,
          employeeCode: true,
          fullName: true,
          isActive: true,
          deletedAt: true,
          shift: { select: { id: true, name: true, startTime: true, endTime: true, graceMinutes: true } },
        },
      },
    },
  });
  const employee = user?.employee;
  if (!employee || employee.companyId !== companyId || employee.deletedAt || !employee.isActive) return null;
  return employee;
}

export async function requireLinkedEmployee(companyId: string, userId: string) {
  const employee = await getLinkedEmployee(companyId, userId);
  if (!employee) {
    throw new BusinessRuleError("VALIDATION_ERROR", "Your login is not linked to an active employee record. Ask HR to link your user to your employee profile.");
  }
  return employee;
}

/** The day row for an employee + IST date, created if missing. */
export async function getOrCreateDayRecord(tx: Tx, companyId: string, employeeId: string, dateKey: string, userId: string) {
  const attendanceDate = dateKeyToDbDate(dateKey);
  return tx.attendanceRecord.upsert({
    where: { employeeId_attendanceDate: { employeeId, attendanceDate } },
    create: { companyId, employeeId, attendanceDate, recordedByUserId: userId },
    update: {},
  });
}

/**
 * Keeps the day row's punchIn / punchOut = first check-in / last check-out of
 * its sessions, so older readers (team dashboard, reports) stay correct.
 */
export async function syncDayRecord(tx: Tx, attendanceRecordId: string) {
  const sessions = await tx.attendanceSession.findMany({
    where: { attendanceRecordId },
    select: { checkInAt: true, checkOutAt: true },
  });
  let punchIn: Date | null = null;
  let punchOut: Date | null = null;
  for (const s of sessions) {
    if (!punchIn || s.checkInAt < punchIn) punchIn = s.checkInAt;
    if (s.checkOutAt && (!punchOut || s.checkOutAt > punchOut)) punchOut = s.checkOutAt;
  }
  await tx.attendanceRecord.update({ where: { id: attendanceRecordId }, data: { punchIn, punchOut } });
}

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Saves an uploaded image through the shared private file storage. */
export async function saveImageFile(file: File, label: string) {
  if (!IMAGE_TYPES.has(file.type)) throw new BusinessRuleError("VALIDATION_ERROR", `${label} must be a JPG, PNG or WEBP image.`);
  if (file.size > MAX_IMAGE_BYTES) throw new BusinessRuleError("VALIDATION_ERROR", `${label} must be 5 MB or smaller.`);
  try {
    const stored = await saveFile(Buffer.from(await file.arrayBuffer()), file.name || "image.jpg", file.type);
    return { storageKey: stored.storageKey, mimeType: file.type, sizeBytes: stored.fileSizeBytes };
  } catch (error) {
    if (error instanceof UnsupportedFileTypeError || error instanceof FileTooLargeError) {
      throw new BusinessRuleError("VALIDATION_ERROR", `${label}: ${error.message}`);
    }
    throw error;
  }
}

/** Saves an uploaded proof document (image or PDF). */
export async function saveProofFile(file: File) {
  const allowed = new Set([...IMAGE_TYPES, "application/pdf"]);
  if (!allowed.has(file.type)) throw new BusinessRuleError("VALIDATION_ERROR", "Proof must be a JPG, PNG, WEBP image or a PDF.");
  if (file.size > 10 * 1024 * 1024) throw new BusinessRuleError("VALIDATION_ERROR", "Proof must be 10 MB or smaller.");
  try {
    const stored = await saveFile(Buffer.from(await file.arrayBuffer()), file.name || "proof", file.type);
    return { storageKey: stored.storageKey, mimeType: file.type, fileName: file.name || "proof" };
  } catch (error) {
    if (error instanceof UnsupportedFileTypeError || error instanceof FileTooLargeError) {
      throw new BusinessRuleError("VALIDATION_ERROR", `Proof: ${error.message}`);
    }
    throw error;
  }
}
