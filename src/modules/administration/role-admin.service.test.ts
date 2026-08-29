import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/core/rbac/PermissionService", () => ({ PermissionService: { invalidate: vi.fn() } }));
vi.mock("./role-admin.repository", () => ({
  RoleAdminRepository: {
    findById: vi.fn(),
    findActiveProductionStages: vi.fn(),
    findGrantedStageIds: vi.fn(),
    replaceStageAccessInTx: vi.fn(),
  },
}));

const { writeAuditLog } = await import("@/core/audit/AuditLogger");
const { PermissionService } = await import("@/core/rbac/PermissionService");
const { RoleAdminRepository } = await import("./role-admin.repository");
const { getRoleProductionStageAccess, updateRoleProductionStages } = await import("./role-admin.service");

const actor = { companyId: "co-1", userId: "user-1" };
const STAGES = [
  { id: "stage-cutting", name: "Cutting", code: "CUT", sequence: 1 },
  { id: "stage-stitching", name: "Stitching", code: "STI", sequence: 2 },
];

beforeEach(() => {
  vi.mocked(writeAuditLog).mockReset().mockResolvedValue(undefined as never);
  vi.mocked(PermissionService.invalidate).mockReset();
  vi.mocked(RoleAdminRepository.findById).mockReset().mockResolvedValue({ id: "role-1", companyId: "co-1", name: "Cutting Supervisor", isSystemRole: false } as never);
  vi.mocked(RoleAdminRepository.findActiveProductionStages).mockReset().mockResolvedValue(STAGES as never);
  vi.mocked(RoleAdminRepository.findGrantedStageIds).mockReset().mockResolvedValue([]);
  vi.mocked(RoleAdminRepository.replaceStageAccessInTx).mockReset().mockResolvedValue(undefined as never);
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
});
