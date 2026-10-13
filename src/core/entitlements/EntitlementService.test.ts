import { beforeEach, describe, expect, it, vi } from "vitest";

const { findManyMock } = vi.hoisted(() => ({ findManyMock: vi.fn() }));
vi.mock("@/core/db/client", () => ({ prisma: { companyModuleEntitlement: { findMany: findManyMock } } }));

const { EntitlementService } = await import("./EntitlementService");

beforeEach(() => {
  EntitlementService.invalidate();
  findManyMock.mockReset();
});

describe("EntitlementService", () => {
  it("treats a company with no rows as having every module enabled", async () => {
    findManyMock.mockResolvedValue([]);
    await expect(EntitlementService.isModuleEnabled("co-1", "crm")).resolves.toBe(true);
  });

  it("turns off every module of a disabled package and ignores unknown keys", async () => {
    findManyMock.mockResolvedValue([{ packageKey: "CRM" }, { packageKey: "RETIRED_PACKAGE" }]);
    expect([...(await EntitlementService.getDisabledModules("co-1"))].sort()).toEqual(["crm", "crm_settings"]);
    await expect(EntitlementService.isModuleEnabled("co-1", "sales_orders")).resolves.toBe(true);
  });

  it("caches per company and re-reads after invalidate()", async () => {
    findManyMock.mockResolvedValue([]);
    await EntitlementService.isModuleEnabled("co-1", "crm");
    await EntitlementService.isModuleEnabled("co-1", "crm");
    expect(findManyMock).toHaveBeenCalledTimes(1);
    EntitlementService.invalidate("co-1");
    await EntitlementService.isModuleEnabled("co-1", "crm");
    expect(findManyMock).toHaveBeenCalledTimes(2);
  });

  it("lists every package with its state", async () => {
    findManyMock.mockResolvedValue([{ packageKey: "HRMS" }]);
    const states = await EntitlementService.listPackageStates("co-1");
    expect(states.find((s) => s.key === "HRMS")?.isEnabled).toBe(false);
    expect(states.find((s) => s.key === "CRM")?.isEnabled).toBe(true);
  });
});
