import { beforeEach, describe, expect, it, vi } from "vitest";

const { findManyMock, countMock, userFindUniqueMock, roleStageAccessFindManyMock } = vi.hoisted(() => ({
  findManyMock: vi.fn(),
  countMock: vi.fn(),
  userFindUniqueMock: vi.fn(),
  roleStageAccessFindManyMock: vi.fn(),
}));

const { entitlementMock } = vi.hoisted(() => ({ entitlementMock: { disabled: new Set<string>() } }));
vi.mock("@/core/entitlements/EntitlementService", () => ({
  EntitlementService: {
    isModuleEnabled: async (_c: string, m: string) => !entitlementMock.disabled.has(m),
    getDisabledModules: async () => new Set(entitlementMock.disabled),
    invalidate: () => {},
  },
}));

vi.mock("@/core/db/client", () => ({
  prisma: {
    userBranchRole: {
      findMany: findManyMock,
      count: countMock,
    },
    user: {
      findUnique: userFindUniqueMock,
    },
    roleProductionStageAccess: {
      findMany: roleStageAccessFindManyMock,
    },
  },
}));

const { PermissionService } = await import("./PermissionService");

function mockPermissions(keys: string[]) {
  findManyMock.mockResolvedValue([
    { role: { rolePermissions: keys.map((key) => ({ permission: { key } })) } },
  ]);
}

beforeEach(() => {
  PermissionService.invalidate();
  findManyMock.mockReset();
  countMock.mockReset();
  userFindUniqueMock.mockReset().mockResolvedValue({ company: { isActive: true }, status: "ACTIVE" });
  roleStageAccessFindManyMock.mockReset();
});

describe("PermissionService.can", () => {
  it("returns true when the user holds the requested permission", async () => {
    mockPermissions(["sales_orders.view"]);
    await expect(PermissionService.can("user-1", "sales_orders", "view")).resolves.toBe(true);
  });

  it("returns false when the user does not hold the requested permission", async () => {
    mockPermissions(["sales_orders.view"]);
    await expect(PermissionService.can("user-1", "sales_orders", "delete")).resolves.toBe(false);
  });

  it("caches permission keys per user — a second call does not re-query the database", async () => {
    mockPermissions(["sales_orders.view"]);
    await PermissionService.can("user-1", "sales_orders", "view");
    await PermissionService.can("user-1", "sales_orders", "view");
    expect(findManyMock).toHaveBeenCalledTimes(1);
  });

  it("denies self-approval: the creator of a record cannot approve their own record", async () => {
    mockPermissions(["sales_orders.approve"]);
    countMock.mockResolvedValue(0); // not SUPER_ADMIN

    const result = await PermissionService.can("user-1", "sales_orders", "approve", { createdBy: "user-1" });
    expect(result).toBe(false);
  });

  it("allows self-approval when the user is SUPER_ADMIN", async () => {
    mockPermissions(["sales_orders.approve"]);
    countMock.mockResolvedValue(1); // holds SUPER_ADMIN role

    const result = await PermissionService.can("user-1", "sales_orders", "approve", { createdBy: "user-1" });
    expect(result).toBe(true);
  });

  it("does not apply the self-approval check when createdBy belongs to someone else", async () => {
    mockPermissions(["sales_orders.approve"]);

    const result = await PermissionService.can("user-1", "sales_orders", "approve", { createdBy: "user-2" });
    expect(result).toBe(true);
    expect(countMock).not.toHaveBeenCalled();
  });

  it("does not apply the self-approval check to actions outside approve/post", async () => {
    mockPermissions(["sales_orders.edit"]);

    const result = await PermissionService.can("user-1", "sales_orders", "edit", { createdBy: "user-1" });
    expect(result).toBe(true);
    expect(countMock).not.toHaveBeenCalled();
  });

  it("denies a suspended user even though they hold the permission (CF-7: suspend must take effect immediately)", async () => {
    mockPermissions(["sales_orders.view"]);
    userFindUniqueMock.mockResolvedValue({ company: { isActive: true }, status: "SUSPENDED" });

    await expect(PermissionService.can("user-1", "sales_orders", "view")).resolves.toBe(false);
  });

  it("denies a user that no longer exists at all", async () => {
    mockPermissions(["sales_orders.view"]);
    userFindUniqueMock.mockResolvedValue(null);

    await expect(PermissionService.can("user-1", "sales_orders", "view")).resolves.toBe(false);
  });

  it("re-checks live status on every call — not cached the way permission keys are", async () => {
    mockPermissions(["sales_orders.view"]);
    userFindUniqueMock.mockResolvedValueOnce({ company: { isActive: true }, status: "ACTIVE" }).mockResolvedValueOnce({ company: { isActive: true }, status: "SUSPENDED" });

    await expect(PermissionService.can("user-1", "sales_orders", "view")).resolves.toBe(true);
    await expect(PermissionService.can("user-1", "sales_orders", "view")).resolves.toBe(false);
    expect(userFindUniqueMock).toHaveBeenCalledTimes(2);
  });

  describe("no universal bypass (Platform SaaS Phase 1, PLAT-004)", () => {
    it("the old isPlatformAdmin flag grants nothing — a flagged user gets only what their roles grant", async () => {
      mockPermissions([]); // holds nothing
      userFindUniqueMock.mockResolvedValue({ company: { isActive: true }, status: "ACTIVE", isPlatformAdmin: true });

      await expect(PermissionService.can("user-1", "sales_orders", "delete")).resolves.toBe(false);
      expect(findManyMock).toHaveBeenCalled(); // goes through the normal permission-key check
    });

    it("a flagged user can't self-approve without SUPER_ADMIN — the self-approval guard applies to everyone", async () => {
      mockPermissions(["sales_orders.approve"]);
      userFindUniqueMock.mockResolvedValue({ company: { isActive: true }, status: "ACTIVE", isPlatformAdmin: true });
      countMock.mockResolvedValue(0);

      const result = await PermissionService.can("user-1", "sales_orders", "approve", { createdBy: "user-1" });
      expect(result).toBe(false);
    });

    it("a platform operator's id (not in the tenant users table) gets no permission at all", async () => {
      mockPermissions(["sales_orders.view"]);
      userFindUniqueMock.mockResolvedValue(null);

      await expect(PermissionService.can("platform-user-1", "sales_orders", "view")).resolves.toBe(false);
    });

    it("denies an active user whose company is suspended (PLAT-006), even with the permission", async () => {
      mockPermissions(["sales_orders.view"]);
      userFindUniqueMock.mockResolvedValue({ company: { isActive: false }, status: "ACTIVE", passwordChangedAt: null });

      await expect(PermissionService.can("user-1", "sales_orders", "view")).resolves.toBe(false);
    });
  });

  describe("PermissionService.getViewableModules", () => {
    it("the old isPlatformAdmin flag no longer unlocks every module", async () => {
      mockPermissions(["sales_orders.view"]);
      userFindUniqueMock.mockResolvedValue({ company: { isActive: true }, status: "ACTIVE", isPlatformAdmin: true });
      await expect(PermissionService.getViewableModules("user-1")).resolves.toEqual(new Set(["sales_orders"]));
    });

    it("returns an empty Set when the user's company is suspended", async () => {
      mockPermissions(["sales_orders.view"]);
      userFindUniqueMock.mockResolvedValue({ company: { isActive: false }, status: "ACTIVE" });
      await expect(PermissionService.getViewableModules("user-1")).resolves.toEqual(new Set());
    });

    it("returns only the modules the user holds view on, not modules where they only have a non-view action", async () => {
      mockPermissions(["sales_orders.view", "sales_orders.edit", "production.create"]);
      userFindUniqueMock.mockResolvedValue({ company: { isActive: true }, status: "ACTIVE", isPlatformAdmin: false });

      const result = await PermissionService.getViewableModules("user-1");
      expect(result).toEqual(new Set(["sales_orders"]));
    });

    it("returns an empty Set for a suspended user", async () => {
      mockPermissions(["sales_orders.view"]);
      userFindUniqueMock.mockResolvedValue({ company: { isActive: true }, status: "SUSPENDED", isPlatformAdmin: false });

      await expect(PermissionService.getViewableModules("user-1")).resolves.toEqual(new Set());
    });

    it("returns an empty Set for a user that no longer exists", async () => {
      userFindUniqueMock.mockResolvedValue(null);
      await expect(PermissionService.getViewableModules("user-1")).resolves.toEqual(new Set());
    });
  });

  describe("sessionIssuedAt staleness (password changed/reset — reuses the CF-7 mechanism)", () => {
    it("denies a session issued before the account's last password change", async () => {
      mockPermissions(["sales_orders.view"]);
      const changedAt = new Date("2026-08-25T12:00:00Z");
      userFindUniqueMock.mockResolvedValue({ company: { isActive: true }, status: "ACTIVE", passwordChangedAt: changedAt });
      const sessionIssuedBeforeChange = Math.floor(new Date("2026-08-25T11:00:00Z").getTime() / 1000);

      await expect(
        PermissionService.can("user-1", "sales_orders", "view", { sessionIssuedAt: sessionIssuedBeforeChange })
      ).resolves.toBe(false);
    });

    it("allows a session issued after the account's last password change", async () => {
      mockPermissions(["sales_orders.view"]);
      const changedAt = new Date("2026-08-25T12:00:00Z");
      userFindUniqueMock.mockResolvedValue({ company: { isActive: true }, status: "ACTIVE", passwordChangedAt: changedAt });
      const sessionIssuedAfterChange = Math.floor(new Date("2026-08-25T13:00:00Z").getTime() / 1000);

      await expect(
        PermissionService.can("user-1", "sales_orders", "view", { sessionIssuedAt: sessionIssuedAfterChange })
      ).resolves.toBe(true);
    });

    it("does not check staleness at all when sessionIssuedAt is omitted — the caller went through requireSession() instead", async () => {
      mockPermissions(["sales_orders.view"]);
      userFindUniqueMock.mockResolvedValue({ company: { isActive: true }, status: "ACTIVE", passwordChangedAt: new Date() });

      await expect(PermissionService.can("user-1", "sales_orders", "view")).resolves.toBe(true);
    });

    it("never flags staleness for an account that has never changed its password (passwordChangedAt is null)", async () => {
      mockPermissions(["sales_orders.view"]);
      userFindUniqueMock.mockResolvedValue({ company: { isActive: true }, status: "ACTIVE", passwordChangedAt: null });

      await expect(
        PermissionService.can("user-1", "sales_orders", "view", { sessionIssuedAt: 0 })
      ).resolves.toBe(true);
    });
  });
});

describe("PermissionService.getAllowedProductionStageIds", () => {
  it("the old isPlatformAdmin flag no longer means unrestricted — the result comes from roles only", async () => {
    userFindUniqueMock.mockResolvedValue({ company: { isActive: true }, status: "ACTIVE", isPlatformAdmin: true });
    findManyMock.mockResolvedValue([]); // holds no role
    await expect(PermissionService.getAllowedProductionStageIds("user-1")).resolves.toEqual(new Set());
  });

  it("returns an empty Set for a user holding no role at all", async () => {
    findManyMock.mockResolvedValue([]);
    const result = await PermissionService.getAllowedProductionStageIds("user-1");
    expect(result).toEqual(new Set());
  });

  it("returns null (unrestricted) when the user holds at least one role with zero stage-access rows", async () => {
    findManyMock.mockResolvedValue([{ roleId: "role-unrestricted" }]);
    roleStageAccessFindManyMock.mockResolvedValue([]);
    await expect(PermissionService.getAllowedProductionStageIds("user-1")).resolves.toBeNull();
  });

  it("returns the union of allowed stages when every held role is individually restricted", async () => {
    findManyMock.mockResolvedValue([{ roleId: "role-cutting" }, { roleId: "role-qc" }]);
    roleStageAccessFindManyMock.mockResolvedValue([
      { roleId: "role-cutting", productionStageId: "stage-cutting" },
      { roleId: "role-qc", productionStageId: "stage-cutting" },
      { roleId: "role-qc", productionStageId: "stage-qc" },
    ]);
    const result = await PermissionService.getAllowedProductionStageIds("user-1");
    expect(result).toEqual(new Set(["stage-cutting", "stage-qc"]));
  });

  it("an unrestricted role wins outright — holding one extra restricted role must never shrink an otherwise-unrestricted user", async () => {
    findManyMock.mockResolvedValue([{ roleId: "role-production-manager" }, { roleId: "role-qc-only-stage" }]);
    // role-production-manager has zero rows below (unrestricted); role-qc-only-stage has one.
    roleStageAccessFindManyMock.mockResolvedValue([{ roleId: "role-qc-only-stage", productionStageId: "stage-qc" }]);
    await expect(PermissionService.getAllowedProductionStageIds("user-1")).resolves.toBeNull();
  });
});

describe("PermissionService.assert", () => {
  it("resolves without throwing when the permission is held", async () => {
    mockPermissions(["masters_core.view"]);
    await expect(PermissionService.assert("user-1", "masters_core", "view")).resolves.toBeUndefined();
  });

  it("throws a PERMISSION_DENIED BusinessRuleError when the permission is missing", async () => {
    mockPermissions([]);
    await expect(PermissionService.assert("user-1", "masters_core", "delete")).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
      httpStatus: 403,
    });
  });
});

describe("module entitlements (Platform SaaS Phase 3, PLAT-019)", () => {
  beforeEach(() => {
    entitlementMock.disabled = new Set();
    userFindUniqueMock.mockResolvedValue({ companyId: "co-1", company: { isActive: true }, status: "ACTIVE" });
  });

  it("refuses a module turned off for the company even when the role grants it", async () => {
    mockPermissions(["crm.view", "sales_orders.view"]);
    entitlementMock.disabled = new Set(["crm"]);
    await expect(PermissionService.can("user-1", "crm", "view")).resolves.toBe(false);
    await expect(PermissionService.can("user-1", "sales_orders", "view")).resolves.toBe(true);
  });

  it("assert() reports MODULE_NOT_ENABLED, not PERMISSION_DENIED, for a disabled module", async () => {
    mockPermissions(["crm.view"]);
    entitlementMock.disabled = new Set(["crm"]);
    await expect(PermissionService.assert("user-1", "crm", "view")).rejects.toMatchObject({ code: "MODULE_NOT_ENABLED" });
  });

  it("assert() still reports PERMISSION_DENIED when the module is on but the role lacks it", async () => {
    mockPermissions([]);
    await expect(PermissionService.assert("user-1", "crm", "view")).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  });

  it("hides disabled modules from the sidebar module list", async () => {
    mockPermissions(["crm.view", "sales_orders.view"]);
    entitlementMock.disabled = new Set(["crm"]);
    const modules = await PermissionService.getViewableModules("user-1");
    expect(modules.has("crm")).toBe(false);
    expect(modules.has("sales_orders")).toBe(true);
  });
});
