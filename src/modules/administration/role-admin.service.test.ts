import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/core/rbac/PermissionService", () => ({ PermissionService: { invalidate: vi.fn(), can: vi.fn() } }));
vi.mock("./role-admin.repository", () => ({
  RoleAdminRepository: {
    findById: vi.fn(),
    findActiveProductionStages: vi.fn(),
    findGrantedStageIds: vi.fn(),
    replaceStageAccessInTx: vi.fn(),
    findActiveBranches: vi.fn(),
    findGrantedBranchIds: vi.fn(),
    replaceBranchAccessInTx: vi.fn(),
    findPermissionCatalog: vi.fn(),
    findGrantedPermissionIds: vi.fn(),
    replacePermissionsInTx: vi.fn(),
    actorHoldsRole: vi.fn(),
  },
}));

const { writeAuditLog } = await import("@/core/audit/AuditLogger");
const { PermissionService } = await import("@/core/rbac/PermissionService");
const { RoleAdminRepository } = await import("./role-admin.repository");
const {
  getRoleProductionStageAccess,
  updateRoleProductionStages,
  updateRoleBranches,
  getRolePermissionMatrix,
  updateRolePermissions,
  actorHoldsRole,
} = await import("./role-admin.service");

const actor = { companyId: "co-1", userId: "user-1" };
const STAGES = [
  { id: "stage-cutting", name: "Cutting", code: "CUT", sequence: 1 },
  { id: "stage-stitching", name: "Stitching", code: "STI", sequence: 2 },
];
const PERMISSION_CATALOG = [
  { id: "perm-view", key: "sampling.view", module: "sampling" },
  { id: "perm-edit", key: "sampling.edit", module: "sampling" },
  { id: "perm-approve", key: "sampling.approve", module: "sampling" },
];

beforeEach(() => {
  vi.mocked(writeAuditLog).mockReset().mockResolvedValue(undefined as never);
  vi.mocked(PermissionService.invalidate).mockReset();
  vi.mocked(PermissionService.can).mockReset().mockResolvedValue(true);
  vi.mocked(RoleAdminRepository.findById).mockReset().mockResolvedValue({ id: "role-1", companyId: "co-1", name: "Cutting Supervisor", isSystemRole: false } as never);
  vi.mocked(RoleAdminRepository.findActiveProductionStages).mockReset().mockResolvedValue(STAGES as never);
  vi.mocked(RoleAdminRepository.findGrantedStageIds).mockReset().mockResolvedValue([]);
  vi.mocked(RoleAdminRepository.replaceStageAccessInTx).mockReset().mockResolvedValue(undefined as never);
  vi.mocked(RoleAdminRepository.findActiveBranches).mockReset().mockResolvedValue([{ id: "branch-1", name: "Head Office", code: "HO" }] as never);
  vi.mocked(RoleAdminRepository.findGrantedBranchIds).mockReset().mockResolvedValue([]);
  vi.mocked(RoleAdminRepository.replaceBranchAccessInTx).mockReset().mockResolvedValue(undefined as never);
  vi.mocked(RoleAdminRepository.findPermissionCatalog).mockReset().mockResolvedValue(PERMISSION_CATALOG as never);
  vi.mocked(RoleAdminRepository.findGrantedPermissionIds).mockReset().mockResolvedValue([{ permissionId: "perm-view" }] as never);
  vi.mocked(RoleAdminRepository.replacePermissionsInTx).mockReset().mockResolvedValue(undefined as never);
  vi.mocked(RoleAdminRepository.actorHoldsRole).mockReset().mockResolvedValue(false);
});

describe("getRoleProductionStageAccess", () => {
  it("reports isRestricted: false and every stage ungranted when zero rows exist", async () => {
    const result = await getRoleProductionStageAccess("co-1", "role-1");
    expect(result.isRestricted).toBe(false);
    expect(result.stages.every((s) => !s.granted)).toBe(true);
  });

  it("reports isRestricted: true and marks only the granted stages once rows exist", async () => {
    vi.mocked(RoleAdminRepository.findGrantedStageIds).mockResolvedValue([{ productionStageId: "stage-cutting" }] as never);
    const result = await getRoleProductionStageAccess("co-1", "role-1");
    expect(result.isRestricted).toBe(true);
    expect(result.stages.find((s) => s.id === "stage-cutting")?.granted).toBe(true);
    expect(result.stages.find((s) => s.id === "stage-stitching")?.granted).toBe(false);
  });

  it("throws NOT_FOUND for a role that doesn't belong to the company", async () => {
    vi.mocked(RoleAdminRepository.findById).mockResolvedValue(null);
    await expect(getRoleProductionStageAccess("co-1", "role-x")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("updateRoleProductionStages", () => {
  it("saves the selected stage ids, invalidates the permission cache, and writes an audit log", async () => {
    await updateRoleProductionStages(actor, "role-1", { stageIds: ["stage-cutting"] });
    expect(RoleAdminRepository.replaceStageAccessInTx).toHaveBeenCalledWith("role-1", ["stage-cutting"]);
    expect(PermissionService.invalidate).toHaveBeenCalled();
    expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ tableName: "role_production_stage_access", action: "UPDATE" }));
  });

  it("clears an existing restriction when saved with an empty array", async () => {
    await updateRoleProductionStages(actor, "role-1", { stageIds: [] });
    expect(RoleAdminRepository.replaceStageAccessInTx).toHaveBeenCalledWith("role-1", []);
  });

  it("rejects a stage id that isn't an active stage of this company", async () => {
    await expect(updateRoleProductionStages(actor, "role-1", { stageIds: ["stage-from-another-company"] })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    expect(RoleAdminRepository.replaceStageAccessInTx).not.toHaveBeenCalled();
  });

  it("is allowed on a system role — unlike updateRolePermissions, this is deliberately not blocked", async () => {
    vi.mocked(RoleAdminRepository.findById).mockResolvedValue({ id: "role-1", companyId: "co-1", name: "PRODUCTION_SUPERVISOR", isSystemRole: true } as never);
    await expect(updateRoleProductionStages(actor, "role-1", { stageIds: ["stage-cutting"] })).resolves.toBeDefined();
    expect(RoleAdminRepository.replaceStageAccessInTx).toHaveBeenCalledWith("role-1", ["stage-cutting"]);
  });

  it("throws NOT_FOUND for a role that doesn't belong to the company", async () => {
    vi.mocked(RoleAdminRepository.findById).mockResolvedValue(null);
    await expect(updateRoleProductionStages(actor, "role-x", { stageIds: [] })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  // SUPER_ADMIN carve-out (2026-09-24): unlike every OTHER system role
  // (PRODUCTION_SUPERVISOR above), SUPER_ADMIN must always stay fully
  // unrestricted — narrowing its stage access would silently reduce real
  // access for a company Super Admin who isn't separately flagged
  // isPlatformAdmin.
  it("blocks restricting the SUPER_ADMIN role's stage access, even for an empty (clearing) array", async () => {
    vi.mocked(RoleAdminRepository.findById).mockResolvedValue({ id: "role-1", companyId: "co-1", name: "SUPER_ADMIN", isSystemRole: true } as never);

    await expect(updateRoleProductionStages(actor, "role-1", { stageIds: ["stage-cutting"] })).rejects.toMatchObject({
      code: "REFERENCED_RECORD_IN_USE",
    });
    expect(RoleAdminRepository.replaceStageAccessInTx).not.toHaveBeenCalled();
  });
});

describe("updateRoleBranches", () => {
  it("saves the selected branch ids, invalidates the permission cache, and writes an audit log", async () => {
    await updateRoleBranches(actor, "role-1", { branchIds: ["branch-1"] });
    expect(RoleAdminRepository.replaceBranchAccessInTx).toHaveBeenCalledWith("role-1", ["branch-1"]);
    expect(PermissionService.invalidate).toHaveBeenCalled();
    expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ tableName: "role_branch_access", action: "UPDATE" }));
  });

  it("rejects a branch id that isn't an active branch of this company", async () => {
    await expect(updateRoleBranches(actor, "role-1", { branchIds: ["branch-from-another-company"] })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    expect(RoleAdminRepository.replaceBranchAccessInTx).not.toHaveBeenCalled();
  });

  it("is allowed on a system role other than SUPER_ADMIN", async () => {
    vi.mocked(RoleAdminRepository.findById).mockResolvedValue({ id: "role-1", companyId: "co-1", name: "STORE_MANAGER", isSystemRole: true } as never);
    await expect(updateRoleBranches(actor, "role-1", { branchIds: ["branch-1"] })).resolves.toBeDefined();
    expect(RoleAdminRepository.replaceBranchAccessInTx).toHaveBeenCalledWith("role-1", ["branch-1"]);
  });

  // SUPER_ADMIN carve-out (2026-09-24) — same reasoning as
  // updateRoleProductionStages()'s own regression test above.
  it("blocks restricting the SUPER_ADMIN role's branch access", async () => {
    vi.mocked(RoleAdminRepository.findById).mockResolvedValue({ id: "role-1", companyId: "co-1", name: "SUPER_ADMIN", isSystemRole: true } as never);

    await expect(updateRoleBranches(actor, "role-1", { branchIds: ["branch-1"] })).rejects.toMatchObject({ code: "REFERENCED_RECORD_IN_USE" });
    expect(RoleAdminRepository.replaceBranchAccessInTx).not.toHaveBeenCalled();
  });

  it("throws NOT_FOUND for a role that doesn't belong to the company", async () => {
    vi.mocked(RoleAdminRepository.findById).mockResolvedValue(null);
    await expect(updateRoleBranches(actor, "role-x", { branchIds: [] })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("getRolePermissionMatrix", () => {
  it("marks only the granted permission keys, leaving the rest ungranted", async () => {
    const result = await getRolePermissionMatrix("co-1", "role-1");
    expect(result.catalog.find((c) => c.key === "sampling.view")?.granted).toBe(true);
    expect(result.catalog.find((c) => c.key === "sampling.edit")?.granted).toBe(false);
    expect(result.catalog.find((c) => c.key === "sampling.approve")?.granted).toBe(false);
  });

  it("throws NOT_FOUND for a role that doesn't belong to the company", async () => {
    vi.mocked(RoleAdminRepository.findById).mockResolvedValue(null);
    await expect(getRolePermissionMatrix("co-1", "role-x")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("actorHoldsRole", () => {
  it("passes through the repository's true/false result", async () => {
    vi.mocked(RoleAdminRepository.actorHoldsRole).mockResolvedValueOnce(true);
    await expect(actorHoldsRole("user-1", "role-1")).resolves.toBe(true);

    vi.mocked(RoleAdminRepository.actorHoldsRole).mockResolvedValueOnce(false);
    await expect(actorHoldsRole("user-1", "role-1")).resolves.toBe(false);
  });
});

describe("updateRolePermissions", () => {
  it("saves the new granted keys, invalidates the permission cache, and writes a real before/after audit diff", async () => {
    await updateRolePermissions(actor, "role-1", ["sampling.view", "sampling.edit"]);

    expect(RoleAdminRepository.replacePermissionsInTx).toHaveBeenCalledWith("role-1", expect.arrayContaining(["perm-view", "perm-edit"]));
    expect(PermissionService.invalidate).toHaveBeenCalled();
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tableName: "role_permissions",
        recordId: "role-1",
        action: "UPDATE",
        oldValues: expect.objectContaining({ grantedKeys: ["sampling.view"] }),
        newValues: expect.objectContaining({ grantedKeys: ["sampling.view", "sampling.edit"] }),
      })
    );
  });

  it("is now allowed on a system role other than SUPER_ADMIN — the old blanket block is gone", async () => {
    vi.mocked(RoleAdminRepository.findById).mockResolvedValue({ id: "role-1", companyId: "co-1", name: "MANAGEMENT", isSystemRole: true } as never);
    await expect(updateRolePermissions(actor, "role-1", ["sampling.approve"])).resolves.toBeDefined();
    expect(RoleAdminRepository.replacePermissionsInTx).toHaveBeenCalled();
  });

  it("blocks editing SUPER_ADMIN's own permission matrix, for everyone including another Super Admin", async () => {
    vi.mocked(RoleAdminRepository.findById).mockResolvedValue({ id: "role-1", companyId: "co-1", name: "SUPER_ADMIN", isSystemRole: true } as never);
    await expect(updateRolePermissions(actor, "role-1", ["sampling.view"])).rejects.toMatchObject({ code: "REFERENCED_RECORD_IN_USE" });
    expect(RoleAdminRepository.replacePermissionsInTx).not.toHaveBeenCalled();
  });

  it("blocks a user from editing the permission matrix of a role they themselves currently hold (self-escalation guard)", async () => {
    vi.mocked(RoleAdminRepository.actorHoldsRole).mockResolvedValue(true);
    await expect(updateRolePermissions(actor, "role-1", ["sampling.view", "sampling.approve"])).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    expect(RoleAdminRepository.replacePermissionsInTx).not.toHaveBeenCalled();
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it("allows editing a role the actor does not hold, even if they hold some other role", async () => {
    vi.mocked(RoleAdminRepository.actorHoldsRole).mockResolvedValue(false);
    await expect(updateRolePermissions(actor, "role-1", ["sampling.view"])).resolves.toBeDefined();
    expect(RoleAdminRepository.replacePermissionsInTx).toHaveBeenCalled();
  });

  it("rejects an unknown permission key with VALIDATION_ERROR before writing anything", async () => {
    await expect(updateRolePermissions(actor, "role-1", ["sampling.view", "not.a.real.key"])).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(RoleAdminRepository.replacePermissionsInTx).not.toHaveBeenCalled();
  });

  it("throws NOT_FOUND for a role that doesn't belong to the company", async () => {
    vi.mocked(RoleAdminRepository.findById).mockResolvedValue(null);
    await expect(updateRolePermissions(actor, "role-x", [])).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  // FERP-QA-005 regression: an editor must not add a permission they don't
  // hold themselves (they could then assign the role to a second account).
  it("refuses to add a permission the editor does not hold, naming it", async () => {
    vi.mocked(PermissionService.can).mockImplementation(async (_u, mod, action) => !(mod === "sampling" && action === "edit"));
    await expect(updateRolePermissions(actor, "role-1", ["sampling.view", "sampling.edit"])).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
      details: { notHeld: ["sampling.edit"] },
    });
    expect(RoleAdminRepository.replacePermissionsInTx).not.toHaveBeenCalled();
  });

  it("only checks newly added keys — keeping or removing existing ones never needs the editor to hold them", async () => {
    vi.mocked(PermissionService.can).mockResolvedValue(false);
    // "sampling.view" is already granted on the role (see beforeEach), so keeping it is fine.
    await expect(updateRolePermissions(actor, "role-1", ["sampling.view"])).resolves.toBeDefined();
    await expect(updateRolePermissions(actor, "role-1", [])).resolves.toBeDefined();
    expect(PermissionService.can).not.toHaveBeenCalled();
  });
});
