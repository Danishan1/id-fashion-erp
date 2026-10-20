import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/core/auth/password", () => ({ hashPassword: vi.fn(), verifyPassword: vi.fn() }));
vi.mock("@/modules/administration/user-admin.repository", () => ({
  UserAdminRepository: {
    findByIdWithPasswordHash: vi.fn(),
    updatePasswordHash: vi.fn(),
  },
}));

const { writeAuditLog } = await import("@/core/audit/AuditLogger");
const { hashPassword, verifyPassword } = await import("@/core/auth/password");
const { UserAdminRepository } = await import("@/modules/administration/user-admin.repository");
const { changeOwnPassword } = await import("./account.service");

const actor = { companyId: "co-1", userId: "user-1" };

beforeEach(() => {
  vi.mocked(writeAuditLog).mockReset().mockResolvedValue(undefined as never);
  vi.mocked(hashPassword).mockReset().mockResolvedValue("new-hashed-password" as never);
  vi.mocked(verifyPassword).mockReset();
  vi.mocked(UserAdminRepository.findByIdWithPasswordHash).mockReset();
  vi.mocked(UserAdminRepository.updatePasswordHash).mockReset().mockResolvedValue({ id: "user-1" } as never);
});

describe("changeOwnPassword", () => {
  it("rejects when the user doesn't exist", async () => {
    vi.mocked(UserAdminRepository.findByIdWithPasswordHash).mockResolvedValue(null);
    await expect(
      changeOwnPassword(actor, { currentPassword: "old", newPassword: "newpassword123" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects when the current password is wrong, without ever hashing or storing a new one", async () => {
    vi.mocked(UserAdminRepository.findByIdWithPasswordHash).mockResolvedValue({ id: "user-1", passwordHash: "old-hash" } as never);
    vi.mocked(verifyPassword).mockResolvedValue(false);

    await expect(
      changeOwnPassword(actor, { currentPassword: "wrong", newPassword: "newpassword123" })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    expect(hashPassword).not.toHaveBeenCalled();
    expect(UserAdminRepository.updatePasswordHash).not.toHaveBeenCalled();
  });

  it("hashes and stores the new password, always scoped to the caller's own id", async () => {
    vi.mocked(UserAdminRepository.findByIdWithPasswordHash).mockResolvedValue({ id: "user-1", passwordHash: "old-hash" } as never);
    vi.mocked(verifyPassword).mockResolvedValue(true);

    await changeOwnPassword(actor, { currentPassword: "correct", newPassword: "newpassword123" });

    expect(verifyPassword).toHaveBeenCalledWith("correct", "old-hash");
    expect(hashPassword).toHaveBeenCalledWith("newpassword123");
    expect(UserAdminRepository.updatePasswordHash).toHaveBeenCalledWith("user-1", "new-hashed-password", false);
  });

  it("never logs the password or its hash in the audit trail", async () => {
    vi.mocked(UserAdminRepository.findByIdWithPasswordHash).mockResolvedValue({ id: "user-1", passwordHash: "old-hash" } as never);
    vi.mocked(verifyPassword).mockResolvedValue(true);

    await changeOwnPassword(actor, { currentPassword: "correct", newPassword: "super-secret-new-password" });

    const [call] = vi.mocked(writeAuditLog).mock.calls;
    const logged = JSON.stringify(call[0]);
    expect(logged).not.toContain("super-secret-new-password");
    expect(logged).not.toContain("old-hash");
    expect(logged).not.toContain("new-hashed-password");
  });

  it("P2: refuses the temporary password and the current password as the new one", async () => {
    vi.mocked(UserAdminRepository.findByIdWithPasswordHash).mockResolvedValue({ id: "user-1", passwordHash: "old-hash" } as never);
    vi.mocked(verifyPassword).mockResolvedValue(true);
    await expect(changeOwnPassword(actor, { currentPassword: "12345678", newPassword: "12345678" })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    await expect(changeOwnPassword(actor, { currentPassword: "samepass99", newPassword: "samepass99" })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    expect(UserAdminRepository.updatePasswordHash).not.toHaveBeenCalled();
  });
});
