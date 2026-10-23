import { prisma } from "@/core/db/client";
import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import {
  deleteStoredFile,
  FileTooLargeError,
  normalizeMimeType,
  readStoredFile,
  saveFile,
  UnsupportedFileTypeError,
} from "@/core/file-storage/FileStorage";
import type { RelatedModule } from "@prisma/client";

interface ActorContext {
  companyId: string;
  userId: string;
}

interface UploadableFile {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
}

/**
 * Shared attachment upload/list/download/delete — polymorphic via
 * relatedModule + relatedRecordId (see Attachment model), so any future
 * module (Sales Orders, Purchase Orders, ...) can reuse this instead of
 * building its own file-handling code. Sampling is the first real caller.
 */
export async function uploadAttachment(
  actor: ActorContext,
  relatedModule: RelatedModule,
  relatedRecordId: string,
  file: UploadableFile,
  /** e.g. the parent record's current status/stage at upload time — see Attachment.contextLabel. */
  contextLabel?: string | null
) {
  let stored;
  try {
    stored = await saveFile(file.buffer, file.fileName, file.mimeType);
  } catch (err) {
    if (err instanceof UnsupportedFileTypeError || err instanceof FileTooLargeError) {
      throw new BusinessRuleError("VALIDATION_ERROR", err.message);
    }
    throw err;
  }

  const attachment = await prisma.attachment.create({
    data: {
      companyId: actor.companyId,
      uploadedById: actor.userId,
      relatedModule,
      relatedRecordId,
      fileName: file.fileName,
      storageKey: stored.storageKey,
      fileSizeBytes: stored.fileSizeBytes,
      mimeType: normalizeMimeType(file.mimeType),
      contextLabel: contextLabel || null,
    },
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "attachments",
    recordId: attachment.id,
    action: "CREATE",
    newValues: attachment,
  });

  return attachment;
}

export async function listAttachments(companyId: string, relatedModule: RelatedModule, relatedRecordId: string) {
  return prisma.attachment.findMany({
    where: { companyId, relatedModule, relatedRecordId },
    orderBy: { uploadedAt: "desc" },
    include: { uploadedBy: { select: { id: true, fullName: true } } },
  });
}

/** Metadata only, no file read — for a caller that only needs to display fileName/size/mimeType/uploadedBy, not the bytes. */
export async function getAttachmentMetadata(companyId: string, attachmentId: string) {
  const attachment = await prisma.attachment.findFirst({
    where: { id: attachmentId, companyId },
    include: { uploadedBy: { select: { id: true, fullName: true } } },
  });
  if (!attachment) throw new BusinessRuleError("NOT_FOUND", "Attachment not found.", { id: attachmentId });
  return attachment;
}

export async function getAttachmentForDownload(companyId: string, attachmentId: string) {
  const attachment = await prisma.attachment.findFirst({ where: { id: attachmentId, companyId } });
  if (!attachment) throw new BusinessRuleError("NOT_FOUND", "Attachment not found.", { id: attachmentId });

  const buffer = await readStoredFile(attachment.storageKey);
  return { attachment, buffer };
}

export async function deleteAttachment(actor: ActorContext, attachmentId: string) {
  const attachment = await prisma.attachment.findFirst({ where: { id: attachmentId, companyId: actor.companyId } });
  if (!attachment) throw new BusinessRuleError("NOT_FOUND", "Attachment not found.", { id: attachmentId });

  await deleteStoredFile(attachment.storageKey);
  await prisma.attachment.delete({ where: { id: attachmentId } });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "attachments",
    recordId: attachment.id,
    action: "DELETE",
    oldValues: {
      fileName: attachment.fileName,
      relatedModule: attachment.relatedModule,
      relatedRecordId: attachment.relatedRecordId,
    },
  });
}
