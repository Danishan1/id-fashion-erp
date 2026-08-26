import { beforeEach, describe, expect, it, vi } from "vitest";

const { authMock, userFindUniqueMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  userFindUniqueMock: vi.fn(),
}));

vi.mock("@/core/auth/auth", () => ({ auth: authMock }));
vi.mock("@/core/db/client", () => ({ prisma: { user: { findUnique: userFindUniqueMock } } }));

const { requireSession } = await import("./api-route");

function session(overrides: { id?: string; companyId?: string; sessionIssuedAt?: number } = {}) {
  const { id = "user-1", companyId = "co-1", sessionIssuedAt = Math.floor(Date.now() / 1000) } = overrides;
  return { user: { id, companyId, defaultBranchId: null, sessionIssuedAt } };
}

beforeEach(() => {
  authMock.mockReset();
  userFindUniqueMock.mockReset().mockResolvedValue({ status: "ACTIVE", passwordChangedAt: null });
});

describe("requireSession", () => {
  it("throws PERMISSION_DENIED when there is no session at all", async () => {
    authMock.mockResolvedValue(null);
    await expect(requireSession()).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  });

  it("resolves with the session when the user is active and the password was never changed", async () => {
    authMock.mockResolvedValue(session());
    await expect(requireSession()).resolves.toBeDefined();
  });

  it("throws when the user is no longer ACTIVE", async () => {
    authMock.mockResolvedValue(session());
    userFindUniqueMock.mockResolvedValue({ status: "SUSPENDED", passwordChangedAt: null });
    await expect(requireSession()).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  });

  it("throws when the user row no longer exists", async () => {
    authMock.mockResolvedValue(session());
    userFindUniqueMock.mockResolvedValue(null);
    await expect(requireSession()).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  });

  describe("passwordChangedAt staleness (CF-7 mechanism reused for password change/reset)", () => {
    it("rejects a session issued before the account's password was last changed", async () => {
      const changedAt = new Date("2026-08-25T12:00:00Z");
      const sessionIssuedBeforeChange = Math.floor(new Date("2026-08-25T11:00:00Z").getTime() / 1000);
      authMock.mockResolvedValue(session({ sessionIssuedAt: sessionIssuedBeforeChange }));
      userFindUniqueMock.mockResolvedValue({ status: "ACTIVE", passwordChangedAt: changedAt });

      await expect(requireSession()).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    });

    it("accepts a session issued after the account's password was last changed", async () => {
      const changedAt = new Date("2026-08-25T12:00:00Z");
      const sessionIssuedAfterChange = Math.floor(new Date("2026-08-25T13:00:00Z").getTime() / 1000);
      authMock.mockResolvedValue(session({ sessionIssuedAt: sessionIssuedAfterChange }));
      userFindUniqueMock.mockResolvedValue({ status: "ACTIVE", passwordChangedAt: changedAt });

      await expect(requireSession()).resolves.toBeDefined();
    });

    it("never rejects for an account that has never changed its password (passwordChangedAt is null)", async () => {
      authMock.mockResolvedValue(session({ sessionIssuedAt: 0 }));
      userFindUniqueMock.mockResolvedValue({ status: "ACTIVE", passwordChangedAt: null });

      await expect(requireSession()).resolves.toBeDefined();
    });
  });
});
