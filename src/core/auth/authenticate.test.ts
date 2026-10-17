import { beforeEach, describe, expect, it, vi } from "vitest";

const { userFindUniqueMock, userUpdateMock, platformFindUniqueMock, platformUpdateMock, verifyPasswordMock } = vi.hoisted(() => ({
  userFindUniqueMock: vi.fn(),
  userUpdateMock: vi.fn(),
  platformFindUniqueMock: vi.fn(),
  platformUpdateMock: vi.fn(),
  verifyPasswordMock: vi.fn(),
}));

vi.mock("@/core/db/client", () => ({
  prisma: {
    user: { findUnique: userFindUniqueMock, update: userUpdateMock },
    platformUser: { findUnique: platformFindUniqueMock, update: platformUpdateMock },
  },
}));
vi.mock("@/core/auth/password", () => ({ verifyPassword: verifyPasswordMock }));

const { authenticateTenantUser, authenticatePlatformUser } = await import("./authenticate");
const { clearAttempts } = await import("./rateLimiter");

const tenantRow = {
  id: "user-1",
  email: "owner@acme.test",
  passwordHash: "hash",
  fullName: "Owner",
  companyId: "co-1",
  defaultBranchId: "br-1",
  status: "ACTIVE",
  company: { isActive: true },
};
const platformRow = {
  id: "platform-1",
  email: "ops@platform.test",
  passwordHash: "hash",
  fullName: "Ops",
  role: "PLATFORM_SUPER_ADMIN",
  status: "ACTIVE",
};

beforeEach(() => {
  for (const mock of [userFindUniqueMock, userUpdateMock, platformFindUniqueMock, platformUpdateMock, verifyPasswordMock]) mock.mockReset();
  verifyPasswordMock.mockResolvedValue(true);
  userFindUniqueMock.mockResolvedValue(tenantRow);
  platformFindUniqueMock.mockResolvedValue(platformRow);
  for (const email of [tenantRow.email, platformRow.email]) {
    clearAttempts(email);
    clearAttempts(`platform:${email}`);
  }
});

describe("authenticateTenantUser (/login)", () => {
  it("signs in an active user of an active company as a TENANT with their companyId", async () => {
    await expect(authenticateTenantUser(tenantRow.email, "pw")).resolves.toEqual({
      id: "user-1",
      email: tenantRow.email,
      name: "Owner",
      userType: "TENANT",
      companyId: "co-1",
      defaultBranchId: "br-1",
    });
  });

  it("PLAT-006: refuses a user whose company is suspended, without checking the password", async () => {
    userFindUniqueMock.mockResolvedValue({ ...tenantRow, company: { isActive: false } });
    await expect(authenticateTenantUser(tenantRow.email, "pw")).resolves.toBeNull();
    expect(verifyPasswordMock).not.toHaveBeenCalled();
  });

  it("refuses a suspended user and a wrong password", async () => {
    userFindUniqueMock.mockResolvedValueOnce({ ...tenantRow, status: "SUSPENDED" });
    await expect(authenticateTenantUser(tenantRow.email, "pw")).resolves.toBeNull();
    verifyPasswordMock.mockResolvedValueOnce(false);
    await expect(authenticateTenantUser(tenantRow.email, "wrong")).resolves.toBeNull();
  });

  it("only ever looks in the tenant users table — a platform account can't sign in here", async () => {
    userFindUniqueMock.mockResolvedValue(null);
    await expect(authenticateTenantUser(platformRow.email, "pw")).resolves.toBeNull();
    expect(platformFindUniqueMock).not.toHaveBeenCalled();
  });
});

describe("authenticatePlatformUser (/platform/login, PLAT-002)", () => {
  it("signs in an active platform operator as PLATFORM, with no companyId", async () => {
    const result = await authenticatePlatformUser(platformRow.email, "pw");
    expect(result).toEqual({
      id: "platform-1",
      email: platformRow.email,
      name: "Ops",
      userType: "PLATFORM",
      platformRole: "PLATFORM_SUPER_ADMIN",
    });
    expect(result).not.toHaveProperty("companyId");
  });

  it("only ever looks in platform_users — a customer account can't sign in here", async () => {
    platformFindUniqueMock.mockResolvedValue(null);
    await expect(authenticatePlatformUser(tenantRow.email, "pw")).resolves.toBeNull();
    expect(userFindUniqueMock).not.toHaveBeenCalled();
  });

  it("refuses a suspended platform operator and a wrong password", async () => {
    platformFindUniqueMock.mockResolvedValueOnce({ ...platformRow, status: "SUSPENDED" });
    await expect(authenticatePlatformUser(platformRow.email, "pw")).resolves.toBeNull();
    verifyPasswordMock.mockResolvedValueOnce(false);
    await expect(authenticatePlatformUser(platformRow.email, "wrong")).resolves.toBeNull();
  });

  it("locks out after repeated failures, in a bucket separate from the tenant login", async () => {
    verifyPasswordMock.mockResolvedValue(false);
    for (let i = 0; i < 5; i++) await authenticatePlatformUser(platformRow.email, "wrong");

    verifyPasswordMock.mockResolvedValue(true);
    await expect(authenticatePlatformUser(platformRow.email, "pw")).resolves.toBeNull(); // locked
    // The same email on the tenant login is unaffected by the platform lockout.
    userFindUniqueMock.mockResolvedValue({ ...tenantRow, email: platformRow.email });
    await expect(authenticateTenantUser(platformRow.email, "pw")).resolves.not.toBeNull();
  });
});
