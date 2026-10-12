import { randomUUID } from "crypto";
import { mkdir, readFile, unlink, writeFile } from "fs/promises";
import path from "path";
import { fileTypeFromBuffer } from "file-type";

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
  "text/csv",
]);

const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB

// Legacy .doc/.xls are the pre-OOXML "Compound File Binary" container format —
// file-type can only fingerprint the generic container, not which legacy
// Office format it holds (that requires parsing the internal stream, well
// beyond what a magic-byte check should do). A CFB signature is accepted as a
// match for either legacy claimed type; it is not itself executable content,
// which is the actual threat this check exists to block.
const LEGACY_OFFICE_CFB_TYPES = new Set(["application/msword", "application/vnd.ms-excel"]);
const CFB_MIME = "application/x-cfb";

// Plain-text formats have no magic-byte signature at all, by definition --
// unlike the legacy-CFB case above (occasionally undetectable), a CSV file
// is ALWAYS undetectable by file-type, so the general "undetectable buffer
// is suspicious" rule can't apply to it uniformly or CSV storage would be
// impossible. Narrowly accepted instead: no NUL byte (the one cheap, real
// signal that a buffer is binary, not text) and valid UTF-8 decoding. The
// file's actual structure is still fully re-validated row-by-row by the
// bulk-import parser downstream, so this check only guards against an
// outright binary file being mislabeled as CSV, not malformed CSV content.
const PLAIN_TEXT_MIME_TYPES = new Set(["text/csv"]);

function looksLikePlainText(buffer: Buffer): boolean {
  if (buffer.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    return true;
  } catch {
    return false;
  }
}

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

  // The declared mimeType above is entirely client-asserted (sourced from the
  // browser's File.type, itself read from an attacker-controlled multipart
  // Content-Type header) — trusting it alone would let an uploaded .exe
  // declared as "application/pdf" be stored and later served back for
  // download. Every allow-listed type here is a real binary format file-type
  // can fingerprint, so a buffer it can't identify at all is treated as
  // suspicious rather than trusted on the client's word.
  const detected = await fileTypeFromBuffer(buffer);
  if (!detected) {
    if (PLAIN_TEXT_MIME_TYPES.has(mimeType) && looksLikePlainText(buffer)) {
      // Expected and fine — see PLAIN_TEXT_MIME_TYPES' own comment above.
    } else {
      throw new UnsupportedFileTypeError(
        `Could not verify the actual content of "${originalFileName}" — the file may be corrupted, empty, or not a genuinely supported type.`
      );
    }
  } else {
    const isLegacyOfficeMatch = LEGACY_OFFICE_CFB_TYPES.has(mimeType) && detected.mime === CFB_MIME;
    if (detected.mime !== mimeType && !isLegacyOfficeMatch) {
      throw new UnsupportedFileTypeError(
        `The file's actual content ("${detected.mime}") does not match its declared type ("${mimeType}").`
      );
    }
  }

  const extension = path.extname(originalFileName);
  const storageKey = `${randomUUID()}${extension}`;
  // STORAGE_ROOT is deliberately env-driven (see its own comment above) so
  // ops can point storage at a different disk/mount per deployment — the
  // path can never be statically narrowed to a fixed subfolder without
  // removing that. turbopackIgnore tells Next.js's build-time file tracer
  // this dynamic access is intentional; it has no effect on the actual
  // runtime fs call. Currently inert either way (this project has no
  // `output: "standalone"` configured, so the whole-project-tracing this
  // silences doesn't run today) — added so it's already correct if/when that
  // changes.
  const destinationPath = path.join(/* turbopackIgnore: true */ STORAGE_ROOT, storageKey);

  await mkdir(STORAGE_ROOT, { recursive: true });
  await writeFile(destinationPath, buffer);

  return { storageKey, fileSizeBytes: buffer.byteLength };
}

export async function readStoredFile(storageKey: string): Promise<Buffer> {
  return readFile(path.join(/* turbopackIgnore: true */ STORAGE_ROOT, storageKey));
}

export async function deleteStoredFile(storageKey: string): Promise<void> {
  await unlink(path.join(/* turbopackIgnore: true */ STORAGE_ROOT, storageKey));
}
