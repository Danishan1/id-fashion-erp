import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  customer: { count: vi.fn() },
  supplier: { count: vi.fn() },
  employee: { count: vi.fn() },
  warehouse: { count: vi.fn() },
  user: { count: vi.fn() },
  company: { findMany: vi.fn() },
}));

vi.mock("@/core/db/client", () => ({ prisma: mockPrisma }));

const { getPlatformOverview } = await import("./platform-overview.service");

beforeEach(() => {
  Object.values(mockPrisma).forEach((model) => Object.values(model).forEach((fn) => fn.mockReset()));
  mockPrisma.customer.count.mockResolvedValue(1);
  mockPrisma.supplier.count.mockResolvedValue(2);
  mockPrisma.employee.count.mockResolvedValue(3);
  mockPrisma.warehouse.count.mockResolvedValue(4);
  mockPrisma.user.count.mockResolvedValue(5);
});

describe("getPlatformOverview", () => {
  it("sums per-company counts and counts active companies, including suspended ones in the list", async () => {
    mockPrisma.company.findMany.mockResolvedValue([
      { id: "co-1", name: "Alpha", isActive: true },
      { id: "co-2", name: "Beta", isActive: false },
    ]);
    mockPrisma.customer.count.mockResolvedValueOnce(1).mockResolvedValueOnce(10);
    mockPrisma.supplier.count.mockResolvedValueOnce(2).mockResolvedValueOnce(20);
    mockPrisma.employee.count.mockResolvedValueOnce(3).mockResolvedValueOnce(30);
    mockPrisma.user.count.mockResolvedValueOnce(5).mockResolvedValueOnce(50);

    const result = await getPlatformOverview();

    expect(result.companies).toHaveLength(2);
    expect(result.companies[1]).toMatchObject({ name: "Beta", isActive: false });
    expect(result.overall).toEqual({ companies: 2, activeCompanies: 1, customers: 11, suppliers: 22, employees: 33, users: 55 });
    // Every company is listed — no isActive filter on the query.
    expect(mockPrisma.company.findMany.mock.calls[0][0]).not.toHaveProperty("where");
  });

  it("returns zeroed totals with no companies at all", async () => {
    mockPrisma.company.findMany.mockResolvedValue([]);
    const result = await getPlatformOverview();
    expect(result.overall).toEqual({ companies: 0, activeCompanies: 0, customers: 0, suppliers: 0, employees: 0, users: 0 });
  });
});
