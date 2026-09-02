import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/core/auth/password", () => ({ hashPassword: vi.fn() }));
vi.mock("@/core/rbac/PermissionService", () => ({ PermissionService: { invalidate: vi.fn() } }));
vi.mock("@/core/db/client", () => ({
  prisma: { $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({})) },
}));
vi.mock("./user-admin.repository", () => ({
  UserAdminRepository: {
    findMany: vi.fn(),
    findByEmail: vi.fn(),
    findById: vi.fn(),
    createWithRoleInTx: vi.fn(),
    updateStatus: vi.fn(),
    updatePasswordHash: vi.fn(),
    updateProfile: vi.fn(),
  },
  UserAdminScopeRepository: {
    findBranchCompanyId: vi.fn(),
    findRoleCompanyId: vi.fn(),
    findEmployeeCompanyId: vi.fn(),
    findUserIdByEmployeeId: vi.fn(),
  },
}));

const { writeAuditLog } = await import("@/core/audit/AuditLogger");
const { hashPassword } = await import("@/core/auth/password");
const { PermissionService } = await import("@/core/rbac/PermissionService");
const { UserAdminRepository, UserAdminScopeRepository } = await import("./user-admin.repository");
const { createUser, updateUser, setUserStatus, resetUserPassword } = await import("./user-admin.service");

const actor = { companyId: "co-1", userId: "user-1" };
const input = { email: "new@co1.com", fullName: "New User", password: "password123", phone: "", branchId: "br-1", roleId: "role-1" };

beforeEach(() => {
  vi.mocked(writeAuditLog).mockReset().mockResolvedValue(undefined as never);
  vi.mocked(hashPassword).mockReset().mockResolvedValue("hashed-password" as never);
  vi.mocked(UserAdminRepository.findByEmail).mockReset().mockResolvedValue(null);
  vi.mocked(UserAdminRepository.findById).mockReset();
  vi.mocked(UserAdminRepository.createWithRoleInTx).mockReset().mockResolvedValue({ id: "user-2" } as never);
  vi.mocked(UserAdminRepository.updateStatus).mockReset();
  vi.mocked(UserAdminRepository.updatePasswordHash).mockReset().mockResolvedValue({ id: "user-2" } as never);
  vi.mocked(UserAdminRepository.updateProfile).mockReset();
  vi.mocked(UserAdminScopeRepository.findBranchCompanyId).mockReset().mockResolvedValue({ companyId: "co-1" } as never);
  vi.mocked(UserAdminScopeRepository.findRoleCompanyId).mockReset().mockResolvedValue({ companyId: "co-1" } as never);
  vi.mocked(UserAdminScopeRepository.findEmployeeCompanyId).mockReset().mockResolvedValue({ companyId: "co-1" } as never);
  vi.mocked(UserAdminScopeRepository.findUserIdByEmployeeId).mockReset().mockResolvedValue(null);
  vi.mocked(PermissionService.invalidate).mockReset();
});

describe("createUser", () => {
  it("rejects a duplicate email", async () => {
    vi.mocked(UserAdminRepository.findByEmail).mockResolvedValue({ id: "existing" } as never);
    await expect(createUser(actor, input)).rejects.toMatchObject({ code: "DUPLICATE_EMAIL_EXISTS" });
    expect(UserAdminRepository.createWithRoleInTx).not.toHaveBeenCalled();
  });

  it("rejects a branchId belonging to another company — the picker endpoints only constrain the UI, not a direct API call", async () => {
    vi.mocked(UserAdminScopeRepository.findBranchCompanyId).mockResolvedValue({ companyId: "co-2" } as never);
    await expect(createUser(actor, input)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(UserAdminRepository.createWithRoleInTx).not.toHaveBeenCalled();
  });

  it("rejects a branchId that doesn't exist at all", async () => {
    vi.mocked(UserAdminScopeRepository.findBranchCompanyId).mockResolvedValue(null);
    await expect(createUser(actor, input)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(UserAdminRepository.createWithRoleInTx).not.toHaveBeenCalled();
  });

  it("rejects a roleId belonging to another company", async () => {
    vi.mocked(UserAdminScopeRepository.findRoleCompanyId).mockResolvedValue({ companyId: "co-2" } as never);
    await expect(createUser(actor, input)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(UserAdminRepository.createWithRoleInTx).not.toHaveBeenCalled();
  });

  it("creates the user with a hashed password and the one initial role assignment when branch and role both belong to this company", async () => {
    await createUser(actor, input);

    expect(hashPassword).toHaveBeenCalledWith("password123");
    expect(UserAdminRepository.createWithRoleInTx).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ companyId: "co-1", email: "new@co1.com", passwordHash: "hashed-password" }),
      { branchId: "br-1", roleId: "role-1" }
    );
  });

  it("rejects an employeeId belonging to another company — the same cross-tenant FK check as branchId/roleId", async () => {
    vi.mocked(UserAdminScopeRepository.findEmployeeCompanyId).mockResolvedValue({ companyId: "co-2" } as never);
    await expect(createUser(actor, { ...input, employeeId: "emp-1" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(UserAdminRepository.createWithRoleInTx).not.toHaveBeenCalled();
  });

  it("rejects an employeeId already linked to a different user login — User.employeeId is @unique", async () => {
    vi.mocked(UserAdminScopeRepository.findUserIdByEmployeeId).mockResolvedValue({ id: "some-other-user" } as never);
    await expect(createUser(actor, { ...input, employeeId: "emp-1" })).rejects.toMatchObject({ code: "DUPLICATE_DOC_NUMBER" });
    expect(UserAdminRepository.createWithRoleInTx).not.toHaveBeenCalled();
  });

  it("creates the user with the given employeeId when it belongs to this company and isn't already linked", async () => {
    await createUser(actor, { ...input, employeeId: "emp-1" });
    expect(UserAdminRepository.createWithRoleInTx).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ employeeId: "emp-1" }),
      { branchId: "br-1", roleId: "role-1" }
    );
  });

  it("creates the user with a null employeeId when none is given — most users have no linked Employee", async () => {
    await createUser(actor, input);
    expect(UserAdminRepository.createWithRoleInTx).toHaveBeenCalledWith({}, expect.objectContaining({ employeeId: null }), {
      branchId: "br-1",
      roleId: "role-1",
    });
  });
});

describe("updateUser", () => {
  const existingUser = { id: "user-2", fullName: "Old Name", email: "old@co1.com", phone: null, employeeId: null };

  it("rejects an employeeId belonging to another company", async () => {
    vi.mocked(UserAdminRepository.findById).mockResolvedValue(existingUser as never);
    vi.mocked(UserAdminScopeRepository.findEmployeeCompanyId).mockResolvedValue({ companyId: "co-2" } as never);
    await expect(updateUser(actor, "user-2", { employeeId: "emp-1" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(UserAdminRepository.updateProfile).not.toHaveBeenCalled();
  });

  it("rejects an employeeId already linked to a different user", async () => {
    vi.mocked(UserAdminRepository.findById).mockResolvedValue(existingUser as never);
    vi.mocked(UserAdminScopeRepository.findUserIdByEmployeeId).mockResolvedValue({ id: "user-3" } as never);
    await expect(updateUser(actor, "user-2", { employeeId: "emp-1" })).rejects.toMatchObject({ code: "DUPLICATE_DOC_NUMBER" });
    expect(UserAdminRepository.updateProfile).not.toHaveBeenCalled();
  });

  it("allows re-saving a user's own already-linked employeeId without tripping the 'already linked' check", async () => {
    vi.mocked(UserAdminRepository.findById).mockResolvedValue({ ...existingUser, employeeId: "emp-1" } as never);
    vi.mocked(UserAdminScopeRepository.findUserIdByEmployeeId).mockResolvedValue({ id: "user-2" } as never);
    vi.mocked(UserAdminRepository.updateProfile).mockResolvedValue({ ...existingUser, employeeId: "emp-1" } as never);

    await updateUser(actor, "user-2", { employeeId: "emp-1" });
    expect(UserAdminRepository.updateProfile).toHaveBeenCalledWith("user-2", expect.objectContaining({ employeeId: "emp-1" }));
  });

  it("unlinks the Employee when employeeId is explicitly submitted as an empty string", async () => {
    vi.mocked(UserAdminRepository.findById).mockResolvedValue({ ...existingUser, employeeId: "emp-1" } as never);
    vi.mocked(UserAdminRepository.updateProfile).mockResolvedValue({ ...existingUser, employeeId: null } as never);

    await updateUser(actor, "user-2", { employeeId: "" });
    expect(UserAdminRepository.updateProfile).toHaveBeenCalledWith("user-2", expect.objectContaining({ employeeId: null }));
    expect(UserAdminScopeRepository.findEmployeeCompanyId).not.toHaveBeenCalled();
  });
});

describe("setUserStatus", () => {
  it("rejects suspending your own account", async () => {
    vi.mocked(UserAdminRepository.findById).mockResolvedValue({ id: "user-1", status: "ACTIVE" } as never);
    await expect(setUserStatus(actor, "user-1", "SUSPENDED")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(UserAdminRepository.updateStatus).not.toHaveBeenCalled();
  });

  it("allows suspending a different user", async () => {
    vi.mocked(UserAdminRepository.findById).mockResolvedValue({ id: "user-2", status: "ACTIVE" } as never);
    vi.mocked(UserAdminRepository.updateStatus).mockResolvedValue({ id: "user-2", status: "SUSPENDED" } as never);

    await setUserStatus(actor, "user-2", "SUSPENDED");
    expect(UserAdminRepository.updateStatus).toHaveBeenCalledWith("user-2", "SUSPENDED");
    // CF-7: invalidating the cache is defense-in-depth on top of
    // isUserActive()'s own uncached per-call DB check — see PermissionService.
    expect(PermissionService.invalidate).toHaveBeenCalledWith("user-2");
  });

  it("rejects a user that doesn't belong to this company", async () => {
    vi.mocked(UserAdminRepository.findById).mockResolvedValue(null);
    await expect(setUserStatus(actor, "user-x", "SUSPENDED")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("resetUserPassword", () => {
  it("rejects a user from another company — company isolation, no cross-company reset", async () => {
    vi.mocked(UserAdminRepository.findById).mockResolvedValue(null);
    await expect(resetUserPassword(actor, "user-other-company", "newpassword123")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(UserAdminRepository.updatePasswordHash).not.toHaveBeenCalled();
  });

  it("hashes and stores the new password with no current-password check, and invalidates the permission cache", async () => {
    vi.mocked(UserAdminRepository.findById).mockResolvedValue({ id: "user-2", status: "ACTIVE" } as never);

    await resetUserPassword(actor, "user-2", "brandnewpassword123");

    expect(hashPassword).toHaveBeenCalledWith("brandnewpassword123");
    expect(UserAdminRepository.updatePasswordHash).toHaveBeenCalledWith("user-2", "hashed-password");
    expect(PermissionService.invalidate).toHaveBeenCalledWith("user-2");
  });

  it("never logs the password or its hash in the audit trail", async () => {
    vi.mocked(UserAdminRepository.findById).mockResolvedValue({ id: "user-2", status: "ACTIVE" } as never);

    await resetUserPassword(actor, "user-2", "super-secret-reset-password");

    const [call] = vi.mocked(writeAuditLog).mock.calls;
    const logged = JSON.stringify(call[0]);
    expect(logged).not.toContain("super-secret-reset-password");
    expect(logged).not.toContain("hashed-password");
  });
});
