import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import {
  deleteStoredFile,
  FileTooLargeError,
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

  return prisma.attachment.create({
    data: {
      companyId: actor.companyId,
      uploadedById: actor.userId,
      relatedModule,
      relatedRecordId,
      fileName: file.fileName,
      storageKey: stored.storageKey,
      fileSizeBytes: stored.fileSizeBytes,
      mimeType: file.mimeType,
      contextLabel: contextLabel || null,
    },
  });
}

export async function listAttachments(companyId: string, relatedModule: RelatedModule, relatedRecordId: string) {
  return prisma.attachment.findMany({
    where: { companyId, relatedModule, relatedRecordId },
    orderBy: { uploadedAt: "desc" },
    include: { uploadedBy: { select: { id: true, fullName: true } } },
  });
}

export async function getAttachmentForDownload(companyId: string, attachmentId: string) {
  const attachment = await prisma.attachment.findFirst({ where: { id: attachmentId, companyId } });
  if (!attachment) throw new BusinessRuleError("NOT_FOUND", "Attachment not found.", { id: attachmentId });

  const buffer = await readStoredFile(attachment.storageKey);
  return { attachment, buffer };
}

export async function deleteAttachment(companyId: string, attachmentId: string) {
  const attachment = await prisma.attachment.findFirst({ where: { id: attachmentId, companyId } });
  if (!attachment) throw new BusinessRuleError("NOT_FOUND", "Attachment not found.", { id: attachmentId });

  await deleteStoredFile(attachment.storageKey);
  await prisma.attachment.delete({ where: { id: attachmentId } });
}
