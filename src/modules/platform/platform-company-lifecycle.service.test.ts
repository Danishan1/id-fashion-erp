import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  companyFindUnique: vi.fn(),
  companyUpdateMany: vi.fn(),
  companyUpdate: vi.fn(),
  entFindUnique: vi.fn(),
  entUpsert: vi.fn(),
  audit: vi.fn(),
  invalidate: vi.fn(),
}));

vi.mock("@/core/db/client", () => {
  const tx = {
    company: { updateMany: m.companyUpdateMany, update: m.companyUpdate },
    companyModuleEntitlement: { upsert: m.entUpsert },
  };
  return {
    prisma: {
      company: { findUnique: m.companyFindUnique },
      companyModuleEntitlement: { findUnique: m.entFindUnique },
      $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
    },
  };
});
vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: m.audit }));
vi.mock("@/core/entitlements/EntitlementService", () => ({ EntitlementService: { invalidate: m.invalidate } }));

const svc = await import("./platform-company-lifecycle.service");
const actor = { platformUserId: "pu-1" };

beforeEach(() => {
  Object.values(m).forEach((fn) => fn.mockReset());
  m.companyFindUnique.mockResolvedValue({ id: "co-1", taxRegistrationNo: null, suspensionReason: "late payment" });
});

describe("platform company lifecycle", () => {
  it("suspends an active company with the reason and the operator, and audits it", async () => {
    m.companyUpdateMany.mockResolvedValue({ count: 1 });
    await svc.suspendCompany(actor, "co-1", "Unpaid invoice");
    expect(m.companyUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "co-1", isActive: true },
        data: expect.objectContaining({
          isActive: false,
          suspensionReason: "Unpaid invoice",
          suspendedByPlatformUserId: "pu-1",
        }),
      })
    );
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ platformUserId: "pu-1" }), expect.anything());
  });

  it("refuses to suspend a company that is already suspended", async () => {
    m.companyUpdateMany.mockResolvedValue({ count: 0 });
    await expect(svc.suspendCompany(actor, "co-1", "Again")).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
    expect(m.audit).not.toHaveBeenCalled();
  });

  it("reactivation clears the suspension fields", async () => {
    m.companyUpdateMany.mockResolvedValue({ count: 1 });
    await svc.activateCompany(actor, "co-1");
    expect(m.companyUpdateMany).toHaveBeenCalledWith({
      where: { id: "co-1", isActive: false },
      data: { isActive: true, suspendedAt: null, suspensionReason: null, suspendedByPlatformUserId: null },
    });
  });

  it("returns NOT_FOUND for an unknown company", async () => {
    m.companyFindUnique.mockResolvedValue(null);
    await expect(svc.activateCompany(actor, "nope")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("refuses a tax registration number another company already uses", async () => {
    m.companyFindUnique
      .mockResolvedValueOnce({ id: "co-1", taxRegistrationNo: null })
      .mockResolvedValueOnce({ id: "co-2" });
    await expect(
      svc.updateCompanyDetails(actor, "co-1", {
        name: "A",
        legalName: null,
        taxRegistrationNo: "GST1",
        fiscalYearStartMonth: 4,
      })
    ).rejects.toMatchObject({ code: "DUPLICATE_TAX_REGISTRATION_NO" });
    expect(m.companyUpdate).not.toHaveBeenCalled();
  });

  it("toggling a module upserts, audits and clears the entitlement cache", async () => {
    m.entFindUnique.mockResolvedValue(null);
    const result = await svc.setModuleEntitlement(actor, "co-1", "CRM", false);
    expect(m.entUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ packageKey: "CRM", isEnabled: false }) })
    );
    expect(m.audit).toHaveBeenCalledWith(
      expect.objectContaining({ oldValues: { package: "CRM", isEnabled: true } }),
      expect.anything()
    );
    expect(m.invalidate).toHaveBeenCalledWith("co-1");
    expect(result).toEqual({ key: "CRM", label: expect.any(String), isEnabled: false });
  });
});
