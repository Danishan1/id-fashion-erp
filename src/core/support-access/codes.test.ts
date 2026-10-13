import { beforeAll, describe, expect, it } from "vitest";
import {
  generateExchangeToken,
  generateVerificationCode,
  hashExchangeToken,
  hashVerificationCode,
  verificationCodeMatches,
} from "./codes";

beforeAll(() => {
  process.env.NEXTAUTH_SECRET ??= "test-secret";
});

describe("verification codes", () => {
  it("are always exactly 6 digits", () => {
    for (let i = 0; i < 200; i++) expect(generateVerificationCode()).toMatch(/^\d{6}$/);
  });

  it("match only the right code for the right record and scope", () => {
    const hash = hashVerificationCode("access", "req-1", "123456");
    expect(verificationCodeMatches("access", "req-1", "123456", hash)).toBe(true);
    expect(verificationCodeMatches("access", "req-1", "123457", hash)).toBe(false);
    expect(verificationCodeMatches("access", "req-2", "123456", hash)).toBe(false);
    expect(verificationCodeMatches("write", "req-1", "123456", hash)).toBe(false);
  });

  it("never store the plain code", () => {
    expect(hashVerificationCode("access", "req-1", "123456")).not.toContain("123456");
  });
});

describe("exchange tokens", () => {
  it("are unique and hashed deterministically", () => {
    const a = generateExchangeToken();
    const b = generateExchangeToken();
    expect(a).not.toBe(b);
    expect(hashExchangeToken(a)).toBe(hashExchangeToken(a));
    expect(hashExchangeToken(a)).not.toBe(hashExchangeToken(b));
  });
});
