import { beforeEach, describe, expect, it, vi } from "vitest";

const { findManyMock, subFindUniqueMock } = vi.hoisted(() => ({ findManyMock: vi.fn(), subFindUniqueMock: vi.fn() }));
vi.mock("@/core/db/client", () => ({
  prisma: {
    companyModuleEntitlement: { findMany: findManyMock },
    companySubscription: { findUnique: subFindUniqueMock },
  },
}));

const { EntitlementService } = await import("./EntitlementService");

const plan = (...keys: string[]) => ({ plan: { modules: keys.map((packageKey) => ({ packageKey })) } });

beforeEach(() => {
  EntitlementService.invalidate();
  findManyMock.mockReset().mockResolvedValue([]);
  subFindUniqueMock.mockReset().mockResolvedValue(null);
});

describe("EntitlementService", () => {
  it("treats a company with no subscription and no overrides as having every module enabled", async () => {
    await expect(EntitlementService.isModuleEnabled("co-1", "crm")).resolves.toBe(true);
  });

  it("turns off every package the plan doesn't include (Phase 4)", async () => {
    subFindUniqueMock.mockResolvedValue(plan("SAMPLING", "PRODUCTION"));
    await expect(EntitlementService.isModuleEnabled("co-1", "crm")).resolves.toBe(false);
    await expect(EntitlementService.isModuleEnabled("co-1", "production")).resolves.toBe(true);
    await expect(EntitlementService.isModuleEnabled("co-1", "sales_orders")).resolves.toBe(true); // core
  });

  it("lets a per-company override win over the plan both ways", async () => {
    subFindUniqueMock.mockResolvedValue(plan("CRM"));
    findManyMock.mockResolvedValue([
      { packageKey: "CRM", isEnabled: false },
      { packageKey: "HRMS", isEnabled: true },
      { packageKey: "RETIRED_PACKAGE", isEnabled: false },
    ]);
    expect([...(await EntitlementService.getDisabledModules("co-1"))]).not.toContain("hrms_leave");
    await expect(EntitlementService.isModuleEnabled("co-1", "crm")).resolves.toBe(false);
  });

  it("caches per company and re-reads after invalidate()", async () => {
    await EntitlementService.isModuleEnabled("co-1", "crm");
    await EntitlementService.isModuleEnabled("co-1", "crm");
    expect(findManyMock).toHaveBeenCalledTimes(1);
    EntitlementService.invalidate("co-1");
    await EntitlementService.isModuleEnabled("co-1", "crm");
    expect(findManyMock).toHaveBeenCalledTimes(2);
  });

  it("lists every package with its state, plan inclusion and override", async () => {
    subFindUniqueMock.mockResolvedValue(plan("CRM"));
    findManyMock.mockResolvedValue([{ packageKey: "HRMS", isEnabled: true }]);
    const states = await EntitlementService.listPackageStates("co-1");
    expect(states.find((s) => s.key === "CRM")).toMatchObject({ isEnabled: true, inPlan: true, override: null });
    expect(states.find((s) => s.key === "HRMS")).toMatchObject({ isEnabled: true, inPlan: false, override: true });
    expect(states.find((s) => s.key === "SAMPLING")).toMatchObject({ isEnabled: false, inPlan: false, override: null });
  });
});
