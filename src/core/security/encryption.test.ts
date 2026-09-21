import { beforeEach, describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "./encryption";

beforeEach(() => {
  process.env.NEXTAUTH_SECRET = "test-secret-value-not-real";
});

describe("encryptSecret / decryptSecret", () => {
  it("round-trips a plaintext value exactly", () => {
    const cipherText = encryptSecret("a-real-oauth-access-token-12345");
    expect(decryptSecret(cipherText)).toBe("a-real-oauth-access-token-12345");
  });

  it("produces a different ciphertext each time (random IV), never the plaintext itself", () => {
    const a = encryptSecret("same-token");
    const b = encryptSecret("same-token");
    expect(a).not.toBe(b);
    expect(a).not.toContain("same-token");
  });

  it("throws on a malformed ciphertext instead of silently returning garbage", () => {
    expect(() => decryptSecret("not-a-real-ciphertext")).toThrow();
  });

  it("throws on ciphertext tampering (GCM auth tag mismatch)", () => {
    const cipherText = encryptSecret("a-real-token");
    const [iv, authTag, data] = cipherText.split(":");
    // Deterministic tamper: flip every bit of the last byte via XOR 0xFF.
    // The previous version replaced the last 2 base64 characters with a
    // fixed "AA" — a ~1-in-4096 chance those characters already were "AA"
    // left the ciphertext unchanged and the test passing for the wrong
    // reason (a false negative, not a real assertion). XOR against a
    // nonzero mask guarantees a different byte every time, no probability
    // involved.
    const dataBuffer = Buffer.from(data, "base64");
    dataBuffer[dataBuffer.length - 1] ^= 0xff;
    const tampered = `${iv}:${authTag}:${dataBuffer.toString("base64")}`;
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it("requires AUTH_SECRET (or the legacy NEXTAUTH_SECRET) to be set", () => {
    delete process.env.NEXTAUTH_SECRET;
    delete process.env.AUTH_SECRET;
    expect(() => encryptSecret("x")).toThrow(/AUTH_SECRET/);
  });
});
