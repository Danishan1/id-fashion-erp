import { beforeEach, describe, expect, it, vi } from "vitest";

const { authMock, userFindUniqueMock, platformUserFindUniqueMock, liveMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  userFindUniqueMock: vi.fn(),
  platformUserFindUniqueMock: vi.fn(),
  liveMock: vi.fn(),
}));

vi.mock("@/core/auth/auth", () => ({ auth: authMock }));
vi.mock("@/core/support-access/support-session-guard", () => ({ getLiveSupportSession: liveMock }));
vi.mock("@/core/db/client", () => ({
  prisma: { user: { findUnique: userFindUniqueMock }, platformUser: { findUnique: platformUserFindUniqueMock } },
}));

const { requireSession, requirePlatformSession } = await import("./api-route");

function session(
  overrides: { id?: string; companyId?: string; sessionIssuedAt?: number; userType?: "TENANT" | "PLATFORM" } = {}
) {
  const { id = "user-1", companyId = "co-1", sessionIssuedAt = Math.floor(Date.now() / 1000), userType } = overrides;
  return { user: { id, companyId, defaultBranchId: null, sessionIssuedAt, ...(userType ? { userType } : {}) } };
}

const activeTenantUser = { status: "ACTIVE", passwordChangedAt: null, company: { isActive: true } };
const activePlatformUser = { status: "ACTIVE", role: "PLATFORM_SUPER_ADMIN", passwordChangedAt: null };

beforeEach(() => {
  authMock.mockReset();
  userFindUniqueMock.mockReset().mockResolvedValue(activeTenantUser);
  platformUserFindUniqueMock.mockReset().mockResolvedValue(activePlatformUser);
});

describe("requireSession", () => {
  it("throws PERMISSION_DENIED when there is no session at all", async () => {
    authMock.mockResolvedValue(null);
    await expect(requireSession()).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  });

  it("resolves with the session when the user is active and the password was never changed", async () => {
    authMock.mockResolvedValue(session({ userType: "TENANT" }));
    await expect(requireSession()).resolves.toBeDefined();
  });

  it("accepts a pre-Phase-1 session with no userType claim (treated as tenant)", async () => {
    authMock.mockResolvedValue(session());
    await expect(requireSession()).resolves.toBeDefined();
  });

  it("throws when the user is no longer ACTIVE", async () => {
    authMock.mockResolvedValue(session());
    userFindUniqueMock.mockResolvedValue({ ...activeTenantUser, status: "SUSPENDED" });
    await expect(requireSession()).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  });

  it("throws when the user row no longer exists", async () => {
    authMock.mockResolvedValue(session());
    userFindUniqueMock.mockResolvedValue(null);
    await expect(requireSession()).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  });

  describe("Platform SaaS Phase 1", () => {
    it("PLAT-004: refuses a platform-operator session on customer ERP routes, without touching the users table", async () => {
      authMock.mockResolvedValue(session({ id: "platform-1", companyId: "", userType: "PLATFORM" }));
      await expect(requireSession()).rejects.toMatchObject({ code: "PERMISSION_DENIED", httpStatus: 403 });
      expect(userFindUniqueMock).not.toHaveBeenCalled();
    });

    it("PLAT-006: refuses an active user whose company is suspended, with ACCOUNT_SUSPENDED (403)", async () => {
      authMock.mockResolvedValue(session());
      userFindUniqueMock.mockResolvedValue({ ...activeTenantUser, company: { isActive: false } });
      await expect(requireSession()).rejects.toMatchObject({ code: "ACCOUNT_SUSPENDED", httpStatus: 403 });
    });
  });

  describe("passwordChangedAt staleness (CF-7 mechanism reused for password change/reset)", () => {
    it("rejects a session issued before the account's password was last changed", async () => {
      const changedAt = new Date("2026-08-25T12:00:00Z");
      const sessionIssuedBeforeChange = Math.floor(new Date("2026-08-25T11:00:00Z").getTime() / 1000);
      authMock.mockResolvedValue(session({ sessionIssuedAt: sessionIssuedBeforeChange }));
      userFindUniqueMock.mockResolvedValue({ ...activeTenantUser, passwordChangedAt: changedAt });

      await expect(requireSession()).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    });

    it("accepts a session issued after the account's password was last changed", async () => {
      const changedAt = new Date("2026-08-25T12:00:00Z");
      const sessionIssuedAfterChange = Math.floor(new Date("2026-08-25T13:00:00Z").getTime() / 1000);
      authMock.mockResolvedValue(session({ sessionIssuedAt: sessionIssuedAfterChange }));
      userFindUniqueMock.mockResolvedValue({ ...activeTenantUser, passwordChangedAt: changedAt });

      await expect(requireSession()).resolves.toBeDefined();
    });

    it("never rejects for an account that has never changed its password (passwordChangedAt is null)", async () => {
      authMock.mockResolvedValue(session({ sessionIssuedAt: 0 }));
      await expect(requireSession()).resolves.toBeDefined();
    });
  });
});

describe("requirePlatformSession (PLAT-002)", () => {
  it("throws PERMISSION_DENIED when there is no session", async () => {
    authMock.mockResolvedValue(null);
    await expect(requirePlatformSession()).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  });

  it("refuses a tenant session — even a company's own Super Admin can't use platform routes", async () => {
    authMock.mockResolvedValue(session({ userType: "TENANT" }));
    await expect(requirePlatformSession()).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    expect(platformUserFindUniqueMock).not.toHaveBeenCalled();
  });

  it("refuses a pre-Phase-1 session with no userType (the old platform-admin JWT no longer works)", async () => {
    authMock.mockResolvedValue(session());
    await expect(requirePlatformSession()).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  });

  it("accepts an active platform operator and returns their id and live role", async () => {
    authMock.mockResolvedValue(session({ id: "platform-1", companyId: "", userType: "PLATFORM" }));
    await expect(requirePlatformSession()).resolves.toMatchObject({
      platformUser: { id: "platform-1", role: "PLATFORM_SUPER_ADMIN" },
    });
  });

  it("refuses a suspended platform operator (checked live, not from the JWT)", async () => {
    authMock.mockResolvedValue(session({ id: "platform-1", companyId: "", userType: "PLATFORM" }));
    platformUserFindUniqueMock.mockResolvedValue({ ...activePlatformUser, status: "SUSPENDED" });
    await expect(requirePlatformSession()).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  });

  it("refuses a platform session issued before the operator's password change", async () => {
    const sessionIssuedAt = Math.floor(new Date("2026-10-01T10:00:00Z").getTime() / 1000);
    authMock.mockResolvedValue(session({ id: "platform-1", companyId: "", userType: "PLATFORM", sessionIssuedAt }));
    platformUserFindUniqueMock.mockResolvedValue({ ...activePlatformUser, passwordChangedAt: new Date("2026-10-01T11:00:00Z") });
    await expect(requirePlatformSession()).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  });

  it("enforces the required role list using the live role", async () => {
    authMock.mockResolvedValue(session({ id: "platform-1", companyId: "", userType: "PLATFORM" }));
    platformUserFindUniqueMock.mockResolvedValue({ ...activePlatformUser, role: "SUPPORT_AGENT" });
    await expect(requirePlatformSession(["PLATFORM_SUPER_ADMIN"])).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await expect(requirePlatformSession(["PLATFORM_SUPER_ADMIN", "SUPPORT_AGENT"])).resolves.toBeDefined();
  });
});

describe("requireSession — support sessions (Phase 2)", () => {
  function supportSession() {
    return { user: { ...session().user, id: "proxy-1", userType: "SUPPORT", supportSessionId: "sess-1" } };
  }

  it("works while the customer-approved session is live", async () => {
    authMock.mockResolvedValue(supportSession());
    liveMock.mockResolvedValue({ id: "sess-1", proxyUserId: "proxy-1", companyId: "co-1" });
    await expect(requireSession()).resolves.toBeDefined();
  });

  it("is refused once the session is revoked or expired", async () => {
    authMock.mockResolvedValue(supportSession());
    liveMock.mockResolvedValue(null);
    await expect(requireSession()).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  });

  it("is refused if the session belongs to a different proxy user", async () => {
    authMock.mockResolvedValue(supportSession());
    liveMock.mockResolvedValue({ id: "sess-1", proxyUserId: "someone-else", companyId: "co-1" });
    await expect(requireSession()).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  });
});
