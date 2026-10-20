import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  user: { findFirst: vi.fn() },
  userBranchRole: { count: vi.fn() },
  permission: { findUnique: vi.fn() },
  userPermissionOverride: { findUnique: vi.fn(), upsert: vi.fn(), findFirst: vi.fn(), delete: vi.fn(), findMany: vi.fn() },
}));
vi.mock("@/core/db/client", () => ({ prisma: db }));
vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/core/rbac/PermissionService", () => ({ PermissionService: { can: vi.fn(), invalidate: vi.fn() } }));

const { PermissionService } = await import("@/core/rbac/PermissionService");
const { writeAuditLog } = await import("@/core/audit/AuditLogger");
const { setUserOverride, removeUserOverride, setOverrideSchema } = await import("./permission-override.service");

const actor = { companyId: "co-1", userId: "admin-1" };
const input = { module: "crm" as const, action: "export" as const, effect: "GRANT" as const, reason: "monthly report" };

beforeEach(() => {
  db.user.findFirst.mockReset().mockResolvedValue({ id: "u-2", fullName: "Ravi" });
  db.userBranchRole.count.mockReset().mockResolvedValue(0);
  db.permission.findUnique.mockReset().mockResolvedValue({ id: "perm-1" });
  db.userPermissionOverride.findUnique.mockReset().mockResolvedValue(null);
  db.userPermissionOverride.upsert.mockReset().mockResolvedValue({ id: "ov-1" });
  db.userPermissionOverride.findFirst.mockReset();
  db.userPermissionOverride.delete.mockReset();
  vi.mocked(PermissionService.can).mockReset().mockResolvedValue(true);
  vi.mocked(PermissionService.invalidate).mockReset();
  vi.mocked(writeAuditLog).mockReset();
});

describe("setUserOverride (P6)", () => {
  it("saves the override, clears the user's permission cache and audits it", async () => {
    await setUserOverride(actor, "u-2", input);
    expect(db.userPermissionOverride.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ userId: "u-2", permissionId: "perm-1", effect: "GRANT", companyId: "co-1" }),
      })
    );
    expect(PermissionService.invalidate).toHaveBeenCalledWith("u-2");
    expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ tableName: "user_permission_overrides", action: "CREATE" }));
  });

  it("refuses overriding your own permissions", async () => {
    await expect(setUserOverride(actor, "admin-1", input)).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    expect(db.userPermissionOverride.upsert).not.toHaveBeenCalled();
  });

  it("refuses granting a permission the actor doesn't hold", async () => {
    vi.mocked(PermissionService.can).mockResolvedValue(false);
    await expect(setUserOverride(actor, "u-2", input)).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    expect(PermissionService.can).toHaveBeenCalledWith("admin-1", "crm", "export");
  });

  it("a DENY doesn't need the actor to hold the permission", async () => {
    vi.mocked(PermissionService.can).mockResolvedValue(false);
    await setUserOverride(actor, "u-2", { ...input, effect: "DENY" });
    expect(db.userPermissionOverride.upsert).toHaveBeenCalled();
  });

  it("only a Super Admin can override a Super Admin", async () => {
    db.userBranchRole.count.mockImplementation(async ({ where }: { where: { userId: string } }) => (where.userId === "u-2" ? 1 : 0));
    await expect(setUserOverride(actor, "u-2", { ...input, effect: "DENY" })).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  });

  it("a user from another company is not found", async () => {
    db.user.findFirst.mockResolvedValue(null);
    await expect(setUserOverride(actor, "u-x", input)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("validates the module and action", () => {
    expect(setOverrideSchema.safeParse({ ...input, module: "nope" }).success).toBe(false);
    expect(setOverrideSchema.safeParse({ ...input, reason: "" }).success).toBe(false);
  });
});

describe("removeUserOverride (P6)", () => {
  it("deletes it and clears the cache", async () => {
    db.userPermissionOverride.findFirst.mockResolvedValue({ id: "ov-1", effect: "DENY", reason: "r", permission: { key: "crm.view" } });
    await removeUserOverride(actor, "u-2", "ov-1");
    expect(db.userPermissionOverride.delete).toHaveBeenCalledWith({ where: { id: "ov-1" } });
    expect(PermissionService.invalidate).toHaveBeenCalledWith("u-2");
  });

  it("an override of another user is not found", async () => {
    db.userPermissionOverride.findFirst.mockResolvedValue(null);
    await expect(removeUserOverride(actor, "u-2", "ov-9")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
