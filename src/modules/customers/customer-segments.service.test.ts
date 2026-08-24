import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/db/client", () => ({
  prisma: {
    customer: { findMany: vi.fn() },
    salesOrder: { findMany: vi.fn() },
    salesOrderItem: { findMany: vi.fn() },
    crmFollowup: { findFirst: vi.fn(), create: vi.fn() },
  },
}));

const { prisma } = await import("@/core/db/client");
const { getCustomerSegments, getCategoryPurchaseBreakdown, generateReengagementFollowups } = await import("./customer-segments.service");

beforeEach(() => {
  vi.mocked(prisma.customer.findMany).mockReset();
  vi.mocked(prisma.salesOrder.findMany).mockReset().mockResolvedValue([]);
  vi.mocked(prisma.salesOrderItem.findMany).mockReset();
  vi.mocked(prisma.crmFollowup.findFirst).mockReset().mockResolvedValue(null);
  vi.mocked(prisma.crmFollowup.create).mockReset().mockResolvedValue({} as never);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("getCustomerSegments", () => {
  it("flags a recently-created customer with no orders as NEW, not INACTIVE", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-24"));
    vi.mocked(prisma.customer.findMany).mockResolvedValue([
      { id: "c1", code: "CUST-1", name: "Fresh Co", type: "CUSTOMER", country: "India", createdAt: new Date("2026-08-10") },
    ] as never);

    const result = await getCustomerSegments("co-1");

    expect(result[0].segments).toContain("NEW");
    expect(result[0].segments).not.toContain("INACTIVE");
  });

  it("flags a long-standing customer with zero orders as INACTIVE", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-24"));
    vi.mocked(prisma.customer.findMany).mockResolvedValue([
      { id: "c1", code: "CUST-1", name: "Old Co", type: "CUSTOMER", country: "India", createdAt: new Date("2025-01-01") },
    ] as never);

    const result = await getCustomerSegments("co-1");

    expect(result[0].segments).toEqual(["INACTIVE"]);
  });

  it("flags 2+ confirmed orders as REPEAT, and a stale last-order date as DORMANT", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-24"));
    vi.mocked(prisma.customer.findMany).mockResolvedValue([
      { id: "c1", code: "CUST-1", name: "Regular Co", type: "CUSTOMER", country: "India", createdAt: new Date("2025-01-01") },
    ] as never);
    vi.mocked(prisma.salesOrder.findMany).mockResolvedValue([
      { customerId: "c1", totalAmount: "1000", orderDate: new Date("2026-01-01") },
      { customerId: "c1", totalAmount: "1000", orderDate: new Date("2026-02-01") }, // last order > 90 days before "now"
    ] as never);

    const result = await getCustomerSegments("co-1");

    expect(result[0].segments).toContain("REPEAT");
    expect(result[0].segments).toContain("DORMANT");
    expect(result[0].orderCount).toBe(2);
    expect(result[0].totalOrderValue).toBe(2000);
  });

  it("ranks HIGH_VALUE and VIP by percentile of total order value among customers who have ordered", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-24"));
    const base = { code: "X", type: "CUSTOMER", country: null, createdAt: new Date("2025-01-01") };
    const tenCustomers = Array.from({ length: 10 }, (_, i) => ({ id: `c${i}`, name: `Customer ${i}`, ...base }));
    vi.mocked(prisma.customer.findMany).mockResolvedValue(tenCustomers as never);
    // 10 customers, one order each, values 100..1000 — c9 (1000) is the top performer.
    const tenOrders = Array.from({ length: 10 }, (_, i) => ({ customerId: `c${i}`, totalAmount: String((i + 1) * 100), orderDate: new Date("2026-08-20") }));
    vi.mocked(prisma.salesOrder.findMany).mockResolvedValue(tenOrders as never);

    const result = await getCustomerSegments("co-1");
    const top = result.find((r) => r.id === "c9")!;
    const bottom = result.find((r) => r.id === "c0")!;

    expect(top.segments).toContain("VIP");
    expect(bottom.segments).not.toContain("HIGH_VALUE");
    expect(bottom.segments).not.toContain("VIP");
  });
});

describe("getCategoryPurchaseBreakdown", () => {
  it("counts distinct customers and orders per category, not raw line-item counts", async () => {
    vi.mocked(prisma.salesOrderItem.findMany).mockResolvedValue([
      { salesOrderId: "so-1", salesOrder: { customerId: "c1" }, product: { categoryId: "cat-shirts", category: { name: "Shirts" } } },
      { salesOrderId: "so-1", salesOrder: { customerId: "c1" }, product: { categoryId: "cat-shirts", category: { name: "Shirts" } } }, // same order, same category — should not double-count
      { salesOrderId: "so-2", salesOrder: { customerId: "c2" }, product: { categoryId: "cat-shirts", category: { name: "Shirts" } } },
      { salesOrderId: "so-3", salesOrder: { customerId: "c1" }, product: { categoryId: "cat-jeans", category: { name: "Jeans" } } },
    ] as never);

    const result = await getCategoryPurchaseBreakdown("co-1");
    const shirts = result.find((r) => r.categoryId === "cat-shirts")!;
    const jeans = result.find((r) => r.categoryId === "cat-jeans")!;

    expect(shirts).toMatchObject({ customerCount: 2, orderCount: 2 });
    expect(jeans).toMatchObject({ customerCount: 1, orderCount: 1 });
  });

  it("skips items whose product has no category", async () => {
    vi.mocked(prisma.salesOrderItem.findMany).mockResolvedValue([
      { salesOrderId: "so-1", salesOrder: { customerId: "c1" }, product: { categoryId: null, category: null } },
    ] as never);

    const result = await getCategoryPurchaseBreakdown("co-1");

    expect(result).toEqual([]);
  });
});

describe("generateReengagementFollowups", () => {
  it("creates a follow-up only for customers inactive 60+ days who don't already have an open one", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-24"));
    vi.mocked(prisma.customer.findMany).mockResolvedValue([
      { id: "c-stale", code: "C1", name: "Stale Co", type: "CUSTOMER", country: null, createdAt: new Date("2025-01-01") },
      { id: "c-recent", code: "C2", name: "Recent Co", type: "CUSTOMER", country: null, createdAt: new Date("2025-01-01") },
      { id: "c-already-flagged", code: "C3", name: "Already Flagged Co", type: "CUSTOMER", country: null, createdAt: new Date("2025-01-01") },
    ] as never);
    vi.mocked(prisma.salesOrder.findMany).mockResolvedValue([
      { customerId: "c-stale", totalAmount: "1000", orderDate: new Date("2026-05-01") }, // ~115 days ago
      { customerId: "c-recent", totalAmount: "1000", orderDate: new Date("2026-08-10") }, // ~14 days ago
      { customerId: "c-already-flagged", totalAmount: "1000", orderDate: new Date("2026-04-01") }, // ~145 days ago
    ] as never);
    vi.mocked(prisma.crmFollowup.findFirst).mockImplementation(((args: { where: { relatedRecordId: string } }) =>
      Promise.resolve(args.where.relatedRecordId === "c-already-flagged" ? ({ id: "existing-followup" } as never) : null)) as never);

    const result = await generateReengagementFollowups("co-1", "user-1");

    expect(result).toEqual({ checked: 2, created: 1 });
    expect(prisma.crmFollowup.create).toHaveBeenCalledTimes(1);
    expect(prisma.crmFollowup.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ relatedModule: "CUSTOMER", relatedRecordId: "c-stale", createdByUserId: "user-1" }) })
    );
    vi.useRealTimers();
  });
});
