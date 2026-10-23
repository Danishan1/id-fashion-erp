import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { FileTooLargeError, UnsupportedFileTypeError, readStoredFile, saveFile } from "./FileStorage";

// A minimal, valid 1x1 PNG (real magic bytes) — used to prove the
// content-sniffing check accepts a genuinely matching file.
const REAL_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

let originalRoot: string | undefined;
let tempDir: string;

beforeEach(async () => {
  originalRoot = process.env.FILE_STORAGE_ROOT;
  tempDir = await mkdtemp(path.join(tmpdir(), "erp-file-storage-test-"));
  process.env.FILE_STORAGE_ROOT = tempDir;
});

afterEach(async () => {
  process.env.FILE_STORAGE_ROOT = originalRoot;
  await rm(tempDir, { recursive: true, force: true });
});

describe("saveFile — magic-byte content verification (CF-6)", () => {
  it("accepts a real PNG declared as image/png", async () => {
    const buffer = Buffer.from(REAL_PNG_BASE64, "base64");
    const result = await saveFile(buffer, "photo.png", "image/png");
    expect(result.storageKey).toMatch(/\.png$/);

    const roundTripped = await readStoredFile(result.storageKey);
    expect(roundTripped.equals(buffer)).toBe(true);
  });

  it("rejects an executable's real content declared with a fake image/png Content-Type", async () => {
    // MZ header — the real magic bytes of a Windows PE executable.
    const fakeExeBuffer = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00]);

    await expect(saveFile(fakeExeBuffer, "totally-a-photo.png", "image/png")).rejects.toThrow(
      UnsupportedFileTypeError
    );
  });

  it("rejects a buffer whose content type cannot be fingerprinted at all, even if the extension/declared type look fine", async () => {
    const plainTextBuffer = Buffer.from("just some plain text, not a real PDF at all", "utf-8");

    await expect(saveFile(plainTextBuffer, "fake.pdf", "application/pdf")).rejects.toThrow(UnsupportedFileTypeError);
  });

  it("still rejects a disallowed declared mimeType before ever inspecting content", async () => {
    const buffer = Buffer.from(REAL_PNG_BASE64, "base64");
    await expect(saveFile(buffer, "photo.png", "image/gif")).rejects.toThrow(UnsupportedFileTypeError);
  });

  it("still enforces the size cap independently of content verification", async () => {
    const oversized = Buffer.alloc(21 * 1024 * 1024, 0);
    await expect(saveFile(oversized, "huge.png", "image/png")).rejects.toThrow(FileTooLargeError);
  });
});

describe("saveFile — voice notes", () => {
  // EBML header with DocType "webm" — what a browser MediaRecorder writes.
  const WEBM_HEADER = Buffer.from(
    "1A45DFA39F4286810142F7810142F2810442F381084282847765626D428781044285810200",
    "hex"
  );

  it("accepts a recorded webm voice note declared with codec parameters", async () => {
    const result = await saveFile(WEBM_HEADER, "voice-note.webm", "audio/webm;codecs=opus");
    expect(result.storageKey).toMatch(/\.webm$/);
  });

  it("accepts an Ogg/Opus recording (detected type carries codec parameters)", async () => {
    const ogg = Buffer.concat([Buffer.from("OggS"), Buffer.alloc(24), Buffer.from("OpusHead"), Buffer.alloc(20)]);
    await expect(saveFile(ogg, "voice-note.ogg", "audio/ogg")).resolves.toBeTruthy();
  });

  it("still rejects a non-audio file declared as audio", async () => {
    const png = Buffer.from(REAL_PNG_BASE64, "base64");
    await expect(saveFile(png, "voice-note.webm", "audio/webm")).rejects.toThrow(UnsupportedFileTypeError);
  });
});
