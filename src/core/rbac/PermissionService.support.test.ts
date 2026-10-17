import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Platform SaaS Phase 2: a company's support proxy user holds no roles and
 * gets permissions only from its live, customer-approved support session.
 */
const { userFindUniqueMock, ubrFindManyMock, liveMock } = vi.hoisted(() => ({
  userFindUniqueMock: vi.fn(),
  ubrFindManyMock: vi.fn(),
  liveMock: vi.fn(),
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
    user: { findUnique: userFindUniqueMock },
    userBranchRole: { findMany: ubrFindManyMock, count: vi.fn() },
    roleBranchAccess: { findMany: vi.fn().mockResolvedValue([]) },
    roleProductionStageAccess: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

vi.mock("@/core/support-access/support-session-guard", async (importActual) => ({
  ...(await importActual<typeof import("@/core/support-access/support-session-guard")>()),
  getLiveSupportSessionForProxyUser: liveMock,
}));

const { PermissionService } = await import("./PermissionService");

const proxyUser = {
  status: "ACTIVE",
  passwordChangedAt: null,
  supportForPlatformUserId: "op-1",
  company: { isActive: true },
};

beforeEach(() => {
  PermissionService.invalidate();
  userFindUniqueMock.mockReset().mockResolvedValue(proxyUser);
  ubrFindManyMock.mockReset().mockResolvedValue([]);
  liveMock.mockReset();
});

describe("PermissionService — support proxy users", () => {
  it("gets nothing at all without a live support session", async () => {
    liveMock.mockResolvedValue(null);
    await expect(PermissionService.can("proxy-1", "sales_orders", "view")).resolves.toBe(false);
    await expect(PermissionService.getViewableModules("proxy-1")).resolves.toEqual(new Set());
    await expect(PermissionService.getAllowedBranchIds("proxy-1")).resolves.toEqual(new Set());
  });

  it("can only read in a read-only session", async () => {
    liveMock.mockResolvedValue({ mode: "READ_ONLY" });
    await expect(PermissionService.can("proxy-1", "sales_orders", "view")).resolves.toBe(true);
    await expect(PermissionService.can("proxy-1", "sales_orders", "create")).resolves.toBe(false);
    await expect(PermissionService.can("proxy-1", "sales_orders", "export")).resolves.toBe(false);
  });

  it("can create/edit after write approval, but never approve or delete", async () => {
    liveMock.mockResolvedValue({ mode: "READ_WRITE" });
    await expect(PermissionService.can("proxy-1", "sales_orders", "create")).resolves.toBe(true);
    await expect(PermissionService.can("proxy-1", "sales_orders", "approve")).resolves.toBe(false);
    await expect(PermissionService.can("proxy-1", "sales_orders", "delete")).resolves.toBe(false);
    await expect(PermissionService.can("proxy-1", "administration_users", "edit")).resolves.toBe(false);
  });

  it("is re-checked on every call — a revoke applies immediately (no caching)", async () => {
    liveMock.mockResolvedValueOnce({ mode: "READ_ONLY" }).mockResolvedValueOnce(null);
    await expect(PermissionService.can("proxy-1", "sales_orders", "view")).resolves.toBe(true);
    await expect(PermissionService.can("proxy-1", "sales_orders", "view")).resolves.toBe(false);
  });

  it("sees every branch and stage while live (read access to the whole company)", async () => {
    liveMock.mockResolvedValue({ mode: "READ_ONLY" });
    await expect(PermissionService.getAllowedBranchIds("proxy-1")).resolves.toBeNull();
    await expect(PermissionService.getAllowedProductionStageIds("proxy-1")).resolves.toBeNull();
  });

  it("leaves ordinary users unaffected", async () => {
    userFindUniqueMock.mockResolvedValue({ ...proxyUser, supportForPlatformUserId: null });
    ubrFindManyMock.mockResolvedValue([{ role: { rolePermissions: [{ permission: { key: "sales_orders.view" } }] } }]);
    await expect(PermissionService.can("user-1", "sales_orders", "view")).resolves.toBe(true);
    expect(liveMock).not.toHaveBeenCalled();
  });
});
