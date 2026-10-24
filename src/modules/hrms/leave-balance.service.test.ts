import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));

vi.mock("@/core/db/client", () => {
  const p = {
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(p)),
    leaveBalance: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    leaveType: { findFirst: vi.fn(), findMany: vi.fn() },
    leaveDay: { update: vi.fn() },
    employee: { findMany: vi.fn() },
    company: { findMany: vi.fn() },
  };
  return { prisma: p };
});

const { prisma } = await import("@/core/db/client");
const {
  isCreditMonth,
  creditFor,
  ensureBalance,
  deductLeaveDay,
  refundLeaveDay,
} = await import("./leave-balance.service");

beforeEach(() => {
  vi.mocked(prisma.$transaction).mockImplementation(async (fn: unknown) => (fn as (tx: unknown) => Promise<unknown>)(prisma));
  vi.mocked(prisma.leaveBalance.findUnique).mockReset();
  vi.mocked(prisma.leaveBalance.findFirst).mockReset();
  vi.mocked(prisma.leaveBalance.findMany).mockReset();
  vi.mocked(prisma.leaveBalance.upsert).mockReset();
  vi.mocked(prisma.leaveBalance.update).mockReset();
  vi.mocked(prisma.leaveBalance.updateMany).mockReset().mockResolvedValue({ count: 1 });
  vi.mocked(prisma.leaveType.findFirst).mockReset();
  vi.mocked(prisma.leaveDay.update).mockReset();
});

describe("leave-balance.service", () => {
  describe("allocation and credit calculation", () => {
    it("determines credit months correctly for different allocation periods", () => {
      // MONTHLY: every month
      expect(isCreditMonth("MONTHLY", 1)).toBe(true);
      expect(isCreditMonth("MONTHLY", 6)).toBe(true);

      // QUARTERLY: Jan (1), Apr (4), Jul (7), Oct (10)
      expect(isCreditMonth("QUARTERLY", 1)).toBe(true);
      expect(isCreditMonth("QUARTERLY", 2)).toBe(false);
      expect(isCreditMonth("QUARTERLY", 4)).toBe(true);
      expect(isCreditMonth("QUARTERLY", 10)).toBe(true);

      // HALF_YEARLY: Jan (1), Jul (7)
      expect(isCreditMonth("HALF_YEARLY", 1)).toBe(true);
      expect(isCreditMonth("HALF_YEARLY", 6)).toBe(false);
      expect(isCreditMonth("HALF_YEARLY", 7)).toBe(true);

      // YEARLY: Jan (1) only
      expect(isCreditMonth("YEARLY", 1)).toBe(true);
      expect(isCreditMonth("YEARLY", 2)).toBe(false);
    });

    it("calculates credit quota correctly", () => {
      const type = { allocationType: "QUARTERLY" as const, quotaPerPeriod: 3 };
      expect(creditFor(type, 1)).toBe(3);
      expect(creditFor(type, 2)).toBe(0);
      expect(creditFor(type, 4)).toBe(3);
    });
  });

  describe("ensureBalance", () => {
    it("returns existing balance if already present", async () => {
      const existing = { id: "lb-1", year: 2026, month: 10, remaining: 5, carryForward: 2 };
      vi.mocked(prisma.leaveBalance.findUnique).mockResolvedValue(existing as never);

      const res = await ensureBalance(prisma as never, "co-1", "emp-1", "lt-1", 2026, 10);
      expect(res).toEqual(existing);
      expect(prisma.leaveType.findFirst).not.toHaveBeenCalled();
    });

    it("builds missing month and carries forward previous remaining + carryForward (F3)", async () => {
      vi.mocked(prisma.leaveBalance.findUnique).mockResolvedValue(null);
      vi.mocked(prisma.leaveType.findFirst).mockResolvedValue({
        id: "lt-1",
        allocationType: "MONTHLY",
        quotaPerPeriod: 1.5,
      } as never);
      // Previous month had remaining: 1, carryForward: 2 -> total available: 3
      vi.mocked(prisma.leaveBalance.findFirst).mockResolvedValue({
        year: 2026,
        month: 9,
        remaining: 1,
        carryForward: 2,
      } as never);
      vi.mocked(prisma.leaveBalance.upsert).mockImplementation(((args: { create: Record<string, unknown> }) =>
        Promise.resolve({
          id: "lb-new",
          ...args.create,
        })) as never);

      const res = await ensureBalance(prisma as never, "co-1", "emp-1", "lt-1", 2026, 10);
      expect(prisma.leaveBalance.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            year: 2026,
            month: 10,
            allocated: 1.5,
            remaining: 1.5,
            carryForward: 3, // 1 + 2
          }),
        })
      );
      expect(res.carryForward).toBe(3);
    });
  });

  describe("deductLeaveDay", () => {
    it("deducts from remaining first, then carryForward, returning PAID", async () => {
      // 1 day requested, remaining = 0.5, carryForward = 2 -> 0.5 from remaining, 0.5 from carry
      vi.mocked(prisma.leaveBalance.findUnique).mockResolvedValue({
        id: "lb-1",
        year: 2026,
        month: 10,
        remaining: 0.5,
        carryForward: 2,
        used: 0,
      } as never);
      vi.mocked(prisma.leaveBalance.findMany).mockResolvedValue([]); // for cascadeAvailability

      const day = { id: "ld-1", employeeId: "emp-1", leaveDate: new Date("2026-10-24T00:00:00Z"), fraction: 1 };
      const plan = await deductLeaveDay(prisma as never, "co-1", day, "lt-1");

      expect(plan.paymentType).toBe("PAID");
      expect(plan.fromRemaining).toBe(0.5);
      expect(plan.fromCarry).toBe(0.5);
      expect(prisma.leaveBalance.updateMany).toHaveBeenCalledWith({
        where: { id: "lb-1", remaining: { gte: 0.5 }, carryForward: { gte: 0.5 } },
        data: { remaining: { decrement: 0.5 }, carryForward: { decrement: 0.5 }, used: { increment: 1 } },
      });
      expect(prisma.leaveDay.update).toHaveBeenCalledWith({
        where: { id: "ld-1" },
        data: expect.objectContaining({
          paymentType: "PAID",
          paidFromRemaining: 0.5,
          paidFromCarry: 0.5,
        }),
      });
    });

    it("marks leave as NOT_PAID when remaining + carryForward is less than requested fraction", async () => {
      // 1 day requested, remaining = 0.25, carryForward = 0.25 (total 0.5 < 1)
      vi.mocked(prisma.leaveBalance.findUnique).mockResolvedValue({
        id: "lb-1",
        year: 2026,
        month: 10,
        remaining: 0.25,
        carryForward: 0.25,
        used: 0,
      } as never);

      const day = { id: "ld-1", employeeId: "emp-1", leaveDate: new Date("2026-10-24T00:00:00Z"), fraction: 1 };
      const plan = await deductLeaveDay(prisma as never, "co-1", day, "lt-1");

      expect(plan.paymentType).toBe("NOT_PAID");
      expect(prisma.leaveBalance.update).toHaveBeenCalledWith({
        where: { id: "lb-1" },
        data: { used: { increment: 1 } },
      });
      expect(prisma.leaveDay.update).toHaveBeenCalledWith({
        where: { id: "ld-1" },
        data: expect.objectContaining({
          paymentType: "NOT_PAID",
          paidFromRemaining: 0,
          paidFromCarry: 0,
        }),
      });
    });
  });

  describe("refundLeaveDay and cascadeAvailability", () => {
    it("refunds exact remaining and carry deducted and cascades to later months", async () => {
      vi.mocked(prisma.leaveBalance.findUnique).mockResolvedValue({
        id: "lb-1",
        leaveTypeId: "lt-1",
        year: 2026,
        month: 10,
        remaining: 0,
        carryForward: 1,
        used: 1,
      } as never);
      // Future month Nov 2026
      vi.mocked(prisma.leaveBalance.findMany).mockResolvedValue([
        { id: "lb-future", year: 2026, month: 11, remaining: 1, carryForward: 1 },
      ] as never);

      const day = {
        id: "ld-1",
        employeeId: "emp-1",
        fraction: 1,
        paidFromRemaining: 0.5,
        paidFromCarry: 0.5,
        leaveBalanceId: "lb-1",
      };

      const res = await refundLeaveDay(prisma as never, day);
      expect(res.refunded).toBe(1);

      // Refunded to lb-1
      expect(prisma.leaveBalance.update).toHaveBeenCalledWith({
        where: { id: "lb-1" },
        data: { remaining: { increment: 0.5 }, carryForward: { increment: 0.5 }, used: { decrement: 1 } },
      });

      // Cascaded to future month lb-future (+1 carryForward)
      expect(prisma.leaveBalance.update).toHaveBeenCalledWith({
        where: { id: "lb-future" },
        data: { carryForward: 2, remaining: 1 },
      });

      // Day marked taken: false
      expect(prisma.leaveDay.update).toHaveBeenCalledWith({
        where: { id: "ld-1" },
        data: { taken: false },
      });
    });
  });
});
