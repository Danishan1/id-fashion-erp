import { beforeEach, describe, expect, it, vi } from "vitest";

// Phase 4: the plan user limit is tested in company-subscription.service.test.ts.
vi.mock("@/modules/platform/company-subscription.service", () => ({ assertUserLimitAllows: vi.fn().mockResolvedValue(undefined) }));
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
    addBranchRole: vi.fn(),
    removeBranchRole: vi.fn(),
  },
  UserAdminScopeRepository: {
    findBranchCompanyId: vi.fn(),
    findRoleCompanyId: vi.fn(),
    findEmployeeCompanyId: vi.fn(),
    findUserIdByEmployeeId: vi.fn(),
  },
  RoleGrantRepository: {
    findRoleGrantProfile: vi.fn(),
    findUserGrantProfile: vi.fn(),
  },
}));

const { writeAuditLog } = await import("@/core/audit/AuditLogger");
const { hashPassword } = await import("@/core/auth/password");
const { PermissionService } = await import("@/core/rbac/PermissionService");
const { UserAdminRepository, UserAdminScopeRepository, RoleGrantRepository } = await import("./user-admin.repository");
const {
  createUser,
  updateUser,
  setUserStatus,
  resetUserPassword,
  addUserBranchRole,
  removeUserBranchRole,
  createEmployeeLoginInTx,
  suspendLoginForEmployee,
  assertNewLoginAllowed,
} = await import("./user-admin.service");

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
  vi.mocked(RoleGrantRepository.findRoleGrantProfile)
    .mockReset()
    .mockResolvedValue({ name: "MERCHANDISER", rolePermissions: [{ permission: { key: "sales_orders.view" } }] } as never);
  vi.mocked(RoleGrantRepository.findUserGrantProfile)
    .mockReset()
    .mockResolvedValue({ roleNames: new Set(["ADMIN"]), permissionKeys: new Set(["sales_orders.view", "administration_users.edit"]) });
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
    expect(UserAdminRepository.updatePasswordHash).toHaveBeenCalledWith("user-2", "hashed-password", true);
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

describe("role grant guards (P0)", () => {
  const target = (branchRoles: Array<{ id: string; branch: { id: string }; role: { id: string } }>) =>
    ({ id: "user-2", branchRoles }) as never;
  const oneRole = [{ id: "ubr-1", branch: { id: "branch-1" }, role: { id: "role-old" } }];

  beforeEach(() => {
    vi.mocked(UserAdminRepository.addBranchRole).mockReset().mockResolvedValue({ id: "ubr-new" } as never);
    vi.mocked(UserAdminRepository.removeBranchRole).mockReset().mockResolvedValue({} as never);
  });

  it("refuses to change your own role assignments — even adding one", async () => {
    vi.mocked(UserAdminRepository.findById).mockResolvedValue({ id: "user-1", branchRoles: oneRole } as never);
    await expect(addUserBranchRole(actor, "user-1", { branchId: "branch-1", roleId: "role-x" })).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
    });
    expect(UserAdminRepository.addBranchRole).not.toHaveBeenCalled();
  });

  it("refuses to remove your own role assignment", async () => {
    vi.mocked(UserAdminRepository.findById).mockResolvedValue({
      id: "user-1",
      branchRoles: [...oneRole, { id: "ubr-2", branch: { id: "branch-1" }, role: { id: "role-2" } }],
    } as never);
    await expect(removeUserBranchRole(actor, "user-1", "ubr-1")).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    expect(UserAdminRepository.removeBranchRole).not.toHaveBeenCalled();
  });

  it("only a Super Admin can give the SUPER_ADMIN role", async () => {
    vi.mocked(UserAdminRepository.findById).mockResolvedValue(target(oneRole));
    vi.mocked(RoleGrantRepository.findRoleGrantProfile).mockResolvedValue({ name: "SUPER_ADMIN", rolePermissions: [] } as never);
    await expect(addUserBranchRole(actor, "user-2", { branchId: "branch-1", roleId: "role-sa" })).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
    });
    await expect(createUser(actor, { ...input, roleId: "role-sa" })).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    expect(UserAdminRepository.addBranchRole).not.toHaveBeenCalled();
    expect(UserAdminRepository.createWithRoleInTx).not.toHaveBeenCalled();
  });

  it("a Super Admin can give the SUPER_ADMIN role to someone else", async () => {
    vi.mocked(UserAdminRepository.findById).mockResolvedValue(target(oneRole));
    vi.mocked(RoleGrantRepository.findRoleGrantProfile).mockResolvedValue({ name: "SUPER_ADMIN", rolePermissions: [] } as never);
    vi.mocked(RoleGrantRepository.findUserGrantProfile).mockResolvedValue({
      roleNames: new Set(["SUPER_ADMIN"]),
      permissionKeys: new Set<string>(),
    });
    await addUserBranchRole(actor, "user-2", { branchId: "branch-1", roleId: "role-sa" });
    expect(UserAdminRepository.addBranchRole).toHaveBeenCalledWith("user-2", "branch-1", "role-sa");
  });

  it("refuses a role carrying permissions the actor doesn't hold", async () => {
    vi.mocked(UserAdminRepository.findById).mockResolvedValue(target(oneRole));
    vi.mocked(RoleGrantRepository.findRoleGrantProfile).mockResolvedValue({
      name: "ACCOUNTS_MANAGER",
      rolePermissions: [{ permission: { key: "sales_orders.view" } }, { permission: { key: "payments.approve" } }],
    } as never);
    await expect(addUserBranchRole(actor, "user-2", { branchId: "branch-1", roleId: "role-acc" })).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
      details: { missingPermissions: ["payments.approve"] },
    });
    expect(UserAdminRepository.addBranchRole).not.toHaveBeenCalled();
  });

  it("clears the user's cached permissions after a role is added", async () => {
    vi.mocked(UserAdminRepository.findById).mockResolvedValue(target(oneRole));
    await addUserBranchRole(actor, "user-2", { branchId: "branch-1", roleId: "role-new" });
    expect(PermissionService.invalidate).toHaveBeenCalledWith("user-2");
  });

  it("clears the user's cached permissions after a role is removed", async () => {
    vi.mocked(UserAdminRepository.findById).mockResolvedValue(
      target([...oneRole, { id: "ubr-2", branch: { id: "branch-1" }, role: { id: "role-2" } }])
    );
    await removeUserBranchRole(actor, "user-2", "ubr-2");
    expect(UserAdminRepository.removeBranchRole).toHaveBeenCalledWith("ubr-2");
    expect(PermissionService.invalidate).toHaveBeenCalledWith("user-2");
  });
});

describe("P2 -- employee logins", () => {
  it("createUser stores the email lower-cased and checks duplicates on the lower-cased value", async () => {
    await createUser(actor, { ...input, email: "  New@CO1.com " });
    expect(UserAdminRepository.findByEmail).toHaveBeenCalledWith("new@co1.com");
    expect(UserAdminRepository.createWithRoleInTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ email: "new@co1.com" }),
      expect.anything()
    );
  });

  it("an employee login uses the hashed temporary password and must be changed at first sign-in", async () => {
    await createEmployeeLoginInTx({} as never, actor, {
      email: "Ravi@Co1.com",
      fullName: "Ravi",
      branchId: "br-1",
      roleId: "role-1",
      employeeId: "emp-1",
    });
    expect(hashPassword).toHaveBeenCalledWith("12345678");
    const [, data] = vi.mocked(UserAdminRepository.createWithRoleInTx).mock.calls[0];
    expect(data).toMatchObject({ email: "ravi@co1.com", passwordHash: "hashed-password", mustChangePassword: true, employeeId: "emp-1" });
    expect(JSON.stringify(data)).not.toContain("12345678");
  });

  it("an employee login goes through the same role-grant guard as Admin -> Users", async () => {
    vi.mocked(RoleGrantRepository.findRoleGrantProfile).mockResolvedValue({
      name: "ACCOUNTS_MANAGER",
      rolePermissions: [{ permission: { key: "accounts.post" } }],
    } as never);
    await expect(assertNewLoginAllowed(actor, { email: "x@co1.com", branchId: "br-1", roleId: "role-1" })).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
    });
  });

  it("suspends the linked login and clears its permission cache", async () => {
    vi.mocked(UserAdminScopeRepository.findUserIdByEmployeeId).mockResolvedValue({ id: "user-2" } as never);
    vi.mocked(UserAdminRepository.findById).mockResolvedValue({ id: "user-2", status: "ACTIVE" } as never);
    await expect(suspendLoginForEmployee(actor, "emp-1")).resolves.toBe("user-2");
    expect(UserAdminRepository.updateStatus).toHaveBeenCalledWith("user-2", "SUSPENDED");
    expect(PermissionService.invalidate).toHaveBeenCalledWith("user-2");
  });

  it("does nothing when the employee has no login", async () => {
    await expect(suspendLoginForEmployee(actor, "emp-1")).resolves.toBeNull();
    expect(UserAdminRepository.updateStatus).not.toHaveBeenCalled();
  });
});
