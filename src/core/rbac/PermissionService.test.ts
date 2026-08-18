import { beforeEach, describe, expect, it, vi } from "vitest";

const { findManyMock, countMock } = vi.hoisted(() => ({
  findManyMock: vi.fn(),
  countMock: vi.fn(),
}));

vi.mock("@/core/db/client", () => ({
  prisma: {
    userBranchRole: {
      findMany: findManyMock,
      count: countMock,
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
