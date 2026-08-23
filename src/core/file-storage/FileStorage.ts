import { randomUUID } from "crypto";
import { mkdir, readFile, unlink, writeFile } from "fs/promises";
import path from "path";

// Deliberately outside `public/` — anything under public/ is served by Next.js
// with no auth check at all, which would make every tenant's files (including
// this one's) downloadable by anyone who guesses/finds the URL. Files here are
// only ever reachable through an authenticated, company-scoped download route.
const STORAGE_ROOT = process.env.FILE_STORAGE_ROOT ?? "./uploads";

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "application/vnd.ms-excel",
]);

const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB

export class UnsupportedFileTypeError extends Error {}
export class FileTooLargeError extends Error {}

interface StoredFile {
  storageKey: string;
  fileSizeBytes: number;
}

/**
 * Local-disk file storage abstraction for dev/small deployments. Swap the
 * implementation for an S3-compatible client later without touching callers —
 * they only depend on this module's exported functions.
 */
export async function saveFile(
  buffer: Buffer,
  originalFileName: string,
  mimeType: string
): Promise<StoredFile> {
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    throw new UnsupportedFileTypeError(`File type "${mimeType}" is not allowed.`);
  }
  if (buffer.byteLength > MAX_FILE_SIZE_BYTES) {
    throw new FileTooLargeError(
      `File exceeds the maximum allowed size of ${MAX_FILE_SIZE_BYTES / (1024 * 1024)}MB.`
    );
  }

  const extension = path.extname(originalFileName);
  const storageKey = `${randomUUID()}${extension}`;
  const destinationPath = path.join(STORAGE_ROOT, storageKey);

  await mkdir(STORAGE_ROOT, { recursive: true });
  await writeFile(destinationPath, buffer);

  return { storageKey, fileSizeBytes: buffer.byteLength };
}

export async function readStoredFile(storageKey: string): Promise<Buffer> {
  return readFile(path.join(STORAGE_ROOT, storageKey));
}

export async function deleteStoredFile(storageKey: string): Promise<void> {
  await unlink(path.join(STORAGE_ROOT, storageKey));
}
