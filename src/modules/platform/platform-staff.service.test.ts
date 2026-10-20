import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  userFindMany: vi.fn(),
  userFindUnique: vi.fn(),
  userCreate: vi.fn(),
  userUpdate: vi.fn(),
  userCount: vi.fn(),
  hashPassword: vi.fn(),
}));

vi.mock("@/core/db/client", () => ({
  prisma: {
    platformUser: {
      findMany: m.userFindMany,
      findUnique: m.userFindUnique,
      create: m.userCreate,
      update: m.userUpdate,
      count: m.userCount,
    },
  },
}));

vi.mock("@/core/auth/password", () => ({
  hashPassword: m.hashPassword,
}));

const svc = await import("./platform-staff.service");
const actor = { platformUserId: "admin-1" };

beforeEach(() => {
  Object.values(m).forEach((fn) => fn.mockReset());
  m.hashPassword.mockResolvedValue("hashed_secret");
});

describe("platform-staff.service", () => {
  it("lists all platform operators", async () => {
    m.userFindMany.mockResolvedValue([
      { id: "1", email: "admin@test.com", fullName: "Admin User", role: "PLATFORM_SUPER_ADMIN", status: "ACTIVE" },
    ]);
    const res = await svc.listPlatformStaff();
    expect(res).toHaveLength(1);
    expect(res[0].email).toBe("admin@test.com");
  });

  it("creates a new platform staff member", async () => {
    m.userFindUnique.mockResolvedValue(null);
    m.userCreate.mockResolvedValue({
      id: "new-1",
      email: "support@test.com",
      fullName: "Support User",
      role: "SUPPORT_AGENT",
      status: "ACTIVE",
    });

    const res = await svc.createPlatformStaff(actor, {
      email: "support@test.com",
      fullName: "Support User",
      role: "SUPPORT_AGENT",
      password: "password123",
    });

    expect(m.hashPassword).toHaveBeenCalledWith("password123");
    expect(res.email).toBe("support@test.com");
  });

  it("prevents self-suspension of currently logged in operator", async () => {
    m.userFindUnique.mockResolvedValue({
      id: "admin-1",
      email: "admin@test.com",
      fullName: "Admin",
      role: "PLATFORM_SUPER_ADMIN",
      status: "ACTIVE",
    });

    await expect(
      svc.updatePlatformStaff(actor, "admin-1", { status: "SUSPENDED" })
    ).rejects.toThrow("You cannot suspend your own platform account.");
  });

  it("prevents suspending the last active super admin", async () => {
    m.userFindUnique.mockResolvedValue({
      id: "other-admin",
      email: "other@test.com",
      fullName: "Other Admin",
      role: "PLATFORM_SUPER_ADMIN",
      status: "ACTIVE",
    });
    m.userCount.mockResolvedValue(0); // 0 other super admins

    await expect(
      svc.updatePlatformStaff(actor, "other-admin", { status: "SUSPENDED" })
    ).rejects.toThrow("Cannot modify or suspend the only remaining active Platform Super Admin.");
  });

  it("resets platform operator password", async () => {
    m.userFindUnique.mockResolvedValue({
      id: "staff-2",
      email: "staff2@test.com",
    });
    m.userUpdate.mockResolvedValue({});

    const res = await svc.resetPlatformStaffPassword(actor, "staff-2", "new_secret_password_123");
    expect(m.hashPassword).toHaveBeenCalledWith("new_secret_password_123");
    expect(res.success).toBe(true);
  });
});
