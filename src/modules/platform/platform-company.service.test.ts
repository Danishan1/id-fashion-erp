import { beforeEach, describe, expect, it, vi } from "vitest";

// Phase 4: trial creation is tested in company-subscription.service.test.ts.
vi.mock("./company-subscription.service", () => ({ startTrialInTx: vi.fn().mockResolvedValue({ id: "sub-1" }) }));
vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/core/auth/password", () => ({ hashPassword: vi.fn(async () => "hashed-password") }));

const txMock = {
  company: { create: vi.fn() },
  branch: { create: vi.fn() },
  permission: { findMany: vi.fn(), createMany: vi.fn() },
  role: { create: vi.fn() },
  rolePermission: { createMany: vi.fn() },
  user: { create: vi.fn() },
  userBranchRole: { create: vi.fn() },
};

vi.mock("@/core/db/client", () => ({
  prisma: {
    company: { findUnique: vi.fn(), findMany: vi.fn() },
    user: { findUnique: vi.fn() },
    currency: { findUnique: vi.fn() },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(txMock)),
  },
}));

const { prisma } = await import("@/core/db/client");
const { writeAuditLog } = await import("@/core/audit/AuditLogger");
const { createCompany, listCompanies } = await import("./platform-company.service");
const { MODULES, ACTIONS, permissionKey } = await import("@/config/rbac");

// The real, full permission catalog (every module x action) — createCompany()
// looks up a key for every action every seeded role is granted, so a partial
// mock here would fail for the same reason a genuinely missing permission
// row would in production (an "Unknown permission key" throw).
const ALL_PERMISSIONS = MODULES.flatMap((mod) => ACTIONS.map((action) => ({ id: permissionKey(mod, action), key: permissionKey(mod, action) })));

const actor = { platformUserId: "platform-admin-1" };
const baseInput = {
  companyName: "Acme Garments",
  legalName: "",
  taxRegistrationNo: "",
  baseCurrencyCode: "INR",
  fiscalYearStartMonth: 4,
  branchCode: "HO",
  branchName: "Head Office",
  branchType: "FACTORY" as const,
  adminEmail: "admin@acme.example",
  adminPassword: "SuperSecret1",
  adminFullName: "Acme Admin",
};

beforeEach(() => {
  vi.mocked(prisma.company.findUnique).mockReset().mockResolvedValue(null as never);
  vi.mocked(prisma.company.findMany).mockReset();
  vi.mocked(prisma.user.findUnique).mockReset().mockResolvedValue(null as never);
  vi.mocked(prisma.currency.findUnique).mockReset().mockResolvedValue({ code: "INR" } as never);
  vi.mocked(writeAuditLog).mockReset();

  txMock.company.create.mockReset().mockResolvedValue({ id: "co-new", name: "Acme Garments" } as never);
  txMock.branch.create.mockReset().mockResolvedValue({ id: "br-new" } as never);
  txMock.permission.findMany.mockReset().mockResolvedValue(ALL_PERMISSIONS as never);
  txMock.permission.createMany.mockReset();
  txMock.role.create.mockReset().mockImplementation(({ data }: { data: { name: string } }) =>
    Promise.resolve({ id: `role-${data.name}`, name: data.name })
  );
  txMock.rolePermission.createMany.mockReset();
  txMock.user.create.mockReset().mockResolvedValue({ id: "user-new", email: "admin@acme.example" } as never);
  txMock.userBranchRole.create.mockReset();
});

describe("createCompany", () => {
  it("rejects a taxRegistrationNo that's already in use by another company", async () => {
    vi.mocked(prisma.company.findUnique).mockResolvedValue({ id: "co-existing" } as never);

    await expect(createCompany(actor, { ...baseInput, taxRegistrationNo: "TAX-001" })).rejects.toMatchObject({
      code: "DUPLICATE_TAX_REGISTRATION_NO",
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects an adminEmail already used by any user, in any company", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: "user-existing" } as never);

    await expect(createCompany(actor, baseInput)).rejects.toMatchObject({ code: "DUPLICATE_EMAIL_EXISTS" });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects an unknown baseCurrencyCode", async () => {
    vi.mocked(prisma.currency.findUnique).mockResolvedValue(null as never);

    await expect(createCompany(actor, baseInput)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("creates the company, branch, every role, and the first Super Admin user inside one transaction", async () => {
    const result = await createCompany(actor, baseInput);

    expect(txMock.company.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ name: "Acme Garments", baseCurrencyCode: "INR" }) })
    );
    expect(txMock.branch.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ companyId: "co-new", code: "HO" }) })
    );
    // One role.create call per role in the ROLES catalog (13 today).
    expect(txMock.role.create).toHaveBeenCalled();
    expect(txMock.role.create.mock.calls.length).toBeGreaterThan(1);
    expect(txMock.user.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ companyId: "co-new", email: "admin@acme.example", passwordHash: "hashed-password" }) })
    );
    expect(txMock.userBranchRole.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: "user-new", branchId: "br-new", roleId: "role-SUPER_ADMIN" }) })
    );
    expect(result.company.id).toBe("co-new");
  });

  it("audit-logs the creation under the new company's own id, not the platform admin's", async () => {
    await createCompany(actor, baseInput);

    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: "co-new", platformUserId: "platform-admin-1", tableName: "companies", action: "CREATE" })
    );
  });
});

describe("listCompanies", () => {
  it("lists every company, newest first", async () => {
    vi.mocked(prisma.company.findMany).mockResolvedValue([{ id: "co-1" }] as never);

    const result = await listCompanies();

    expect(prisma.company.findMany).toHaveBeenCalledWith({ orderBy: { createdAt: "desc" } });
    expect(result).toEqual([{ id: "co-1" }]);
  });
});
