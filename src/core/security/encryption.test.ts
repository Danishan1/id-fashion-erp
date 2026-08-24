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
    const tampered = `${iv}:${authTag}:${data.slice(0, -2)}AA`;
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it("requires NEXTAUTH_SECRET to be set", () => {
    delete process.env.NEXTAUTH_SECRET;
    expect(() => encryptSecret("x")).toThrow(/NEXTAUTH_SECRET/);
  });
});
