import { writeAuditLog } from "@/core/audit/AuditLogger";
import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { deleteStoredFile, readStoredFile } from "@/core/file-storage/FileStorage";
import { PermissionService } from "@/core/rbac/PermissionService";
import type { HrmsActor } from "./attendance-settings.service";
import { saveImageFile } from "./attendance-session.core";
import { assertHrmsEmployeeInScope } from "./hrms-scope";

/** Old system: up to 3 baseline face photos per employee. */
export const MAX_FACE_PHOTOS = 3;

async function requireEmployee(companyId: string, employeeId: string) {
  const employee = await prisma.employee.findFirst({
    where: { id: employeeId, companyId, deletedAt: null },
    select: { id: true, fullName: true, employeeCode: true },
  });
  if (!employee) throw new BusinessRuleError("NOT_FOUND", "Employee not found.", { id: employeeId });
  return employee;
}

export async function listFacePhotos(companyId: string, employeeId: string) {
  const employee = await requireEmployee(companyId, employeeId);
  const photos = await prisma.employeeFacePhoto.findMany({
    where: { employeeId, companyId },
    orderBy: { createdAt: "asc" },
    select: { id: true, fileName: true, sizeBytes: true, createdAt: true },
  });
  return { employee, photos, max: MAX_FACE_PHOTOS };
}

export async function addFacePhotos(actor: HrmsActor, employeeId: string, files: File[]) {
  await requireEmployee(actor.companyId, employeeId);
  if (files.length === 0) throw new BusinessRuleError("VALIDATION_ERROR", "Choose at least one photo.");
  const existing = await prisma.employeeFacePhoto.count({ where: { employeeId, companyId: actor.companyId } });
  if (existing + files.length > MAX_FACE_PHOTOS) {
    throw new BusinessRuleError("VALIDATION_ERROR", `An employee can have at most ${MAX_FACE_PHOTOS} face photos (${existing} already enrolled).`);
  }
  const created = [];
  for (const file of files) {
    const stored = await saveImageFile(file, "Face photo");
    const row = await prisma.employeeFacePhoto.create({
      data: {
        companyId: actor.companyId,
        employeeId,
        storageKey: stored.storageKey,
        mimeType: stored.mimeType,
        fileName: file.name || "face.jpg",
        sizeBytes: stored.sizeBytes,
        uploadedByUserId: actor.userId,
      },
      select: { id: true, fileName: true, sizeBytes: true, createdAt: true },
    });
    created.push(row);
    await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName: "hrms_employee_face_photos", recordId: row.id, action: "CREATE", newValues: { employeeId, fileName: row.fileName } });
  }
  return created;
}

export async function deleteFacePhoto(actor: HrmsActor, photoId: string) {
  const photo = await prisma.employeeFacePhoto.findFirst({ where: { id: photoId, companyId: actor.companyId } });
  if (!photo) throw new BusinessRuleError("NOT_FOUND", "Face photo not found.", { id: photoId });
  await prisma.employeeFacePhoto.delete({ where: { id: photoId } });
  await deleteStoredFile(photo.storageKey).catch(() => undefined);
  await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName: "hrms_employee_face_photos", recordId: photoId, action: "DELETE", oldValues: { employeeId: photo.employeeId, fileName: photo.fileName } });
  return { id: photoId };
}

/** A face photo file: for the employee themselves (browser matching) or HR (edit). */
export async function readFacePhoto(actor: HrmsActor, photoId: string) {
  const photo = await prisma.employeeFacePhoto.findFirst({ where: { id: photoId, companyId: actor.companyId } });
  if (!photo) throw new BusinessRuleError("NOT_FOUND", "Face photo not found.", { id: photoId });
  const user = await prisma.user.findUnique({ where: { id: actor.userId }, select: { employeeId: true } });
  const isSelf = user?.employeeId === photo.employeeId;
  if (!isSelf && !(await PermissionService.can(actor.userId, "hrms_attendance", "edit"))) {
    throw new BusinessRuleError("NOT_FOUND", "Face photo not found.", { id: photoId });
  }
  return { buffer: await readStoredFile(photo.storageKey), mimeType: photo.mimeType };
}

/** A punch selfie, for anyone who can see that employee's attendance. */
export async function readSessionSelfie(actor: HrmsActor, sessionId: string, side: "in" | "out") {
  const session = await prisma.attendanceSession.findFirst({ where: { id: sessionId, companyId: actor.companyId } });
  if (!session) throw new BusinessRuleError("NOT_FOUND", "Selfie not found.", { id: sessionId });
  await assertHrmsEmployeeInScope(actor.userId, "hrms_attendance", session.employeeId, { label: "Selfie", id: sessionId });
  const key = side === "in" ? session.inSelfieKey : session.outSelfieKey;
  const mime = side === "in" ? session.inSelfieMime : session.outSelfieMime;
  if (!key) throw new BusinessRuleError("NOT_FOUND", "No selfie for this punch.", { id: sessionId });
  return { buffer: await readStoredFile(key), mimeType: mime ?? "image/jpeg" };
}
