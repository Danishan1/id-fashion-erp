import { describe, expect, it } from "vitest";
import { budgetAlertConditions, computeBudget, NOT_ALLOCATED } from "./budget-math";

const base: Parameters<typeof computeBudget>[0] = {
  approved: 100_000,
  allocations: [
    { id: "media", amount: 60_000 },
    { id: "print", amount: 20_000 },
  ],
  expenses: [] as { amount: number; status: string; allocationId: string | null }[],
  purchaseOrders: [] as { id: string; status: string; baseTotal: number; allocationId: string | null }[],
  invoices: [] as { baseSubtotal: number; status: string; purchaseOrderId: string | null; allocationId: string | null; counts: boolean }[],
  invoicedByPo: {} as Record<string, number>,
};

describe("campaign budget formulas", () => {
  it("actual = approved+ expenses and posted invoices; pending ones only in the pipeline", () => {
    const b = computeBudget({
      ...base,
      expenses: [
        { amount: 10_000, status: "APPROVED", allocationId: "media" },
        { amount: 2_000, status: "PAID", allocationId: null },
        { amount: 5_000, status: "PENDING_APPROVAL", allocationId: "media" },
      ],
      invoices: [
        { baseSubtotal: 8_000, status: "POSTED", purchaseOrderId: null, allocationId: "print", counts: true },
        { baseSubtotal: 1_000, status: "DRAFT", purchaseOrderId: null, allocationId: "print", counts: true },
      ],
    });
    expect([b.actual, b.committed, b.pipeline, b.remaining, b.usedPercent]).toEqual([20_000, 0, 6_000, 80_000, 20]);
    expect(b.byAllocation.media).toMatchObject({ limit: 60_000, actual: 10_000, pipeline: 5_000, remaining: 50_000 });
    expect(b.byAllocation.print).toMatchObject({ actual: 8_000, pipeline: 1_000 });
    expect(b.byAllocation[NOT_ALLOCATED]).toMatchObject({ limit: 20_000, actual: 2_000 });
    expect(b.allocated).toBe(80_000);
  });

  it("an invoice against a PO moves money from committed to actual — never counted twice", () => {
    const po = { id: "po1", status: "PARTIALLY_RECEIVED", baseTotal: 30_000, allocationId: "media" };
    const before = computeBudget({ ...base, purchaseOrders: [po] });
    expect([before.actual, before.committed]).toEqual([0, 30_000]);
    const after = computeBudget({
      ...base,
      purchaseOrders: [po],
      invoices: [{ baseSubtotal: 12_000, status: "POSTED", purchaseOrderId: "po1", allocationId: "media", counts: true }],
      invoicedByPo: { po1: 12_000 },
    });
    expect([after.actual, after.committed, after.actual + after.committed]).toEqual([12_000, 18_000, 30_000]);
  });

  it("committed never goes below zero when invoices exceed the order", () => {
    const b = computeBudget({ ...base, purchaseOrders: [{ id: "po1", status: "FULLY_RECEIVED", baseTotal: 10_000, allocationId: null }], invoicedByPo: { po1: 11_000 } });
    expect(b.committed).toBe(0);
  });

  it("draft POs are pipeline; closed and cancelled POs commit nothing", () => {
    const b = computeBudget({
      ...base,
      purchaseOrders: [
        { id: "a", status: "DRAFT", baseTotal: 4_000, allocationId: null },
        { id: "b", status: "CLOSED", baseTotal: 9_000, allocationId: null },
        { id: "c", status: "CANCELLED", baseTotal: 9_000, allocationId: null },
      ],
    });
    expect([b.committed, b.pipeline]).toEqual([0, 4_000]);
  });

  it("no approved budget: figures still add up, limits and remaining are blank", () => {
    const b = computeBudget({ ...base, approved: null, expenses: [{ amount: 500, status: "APPROVED", allocationId: null }] });
    expect([b.limit, b.remaining, b.usedPercent, b.actual, b.unallocatedLimit]).toEqual([null, null, null, 500, null]);
  });

  it("spend on a removed / unknown line falls into Not allocated", () => {
    const b = computeBudget({ ...base, expenses: [{ amount: 700, status: "APPROVED", allocationId: "gone" }] });
    expect(b.byAllocation[NOT_ALLOCATED].actual).toBe(700);
  });
});

describe("budget alert conditions", () => {
  const allocations = [
    { id: "media", name: "Media" },
    { id: "print", name: "Print" },
  ];
  const at = (expenses: typeof base.expenses, extra: Partial<typeof base> = {}) => computeBudget({ ...base, ...extra, expenses });

  it("warns at the threshold, then over budget replaces the warning (never both for one scope)", () => {
    const warn = budgetAlertConditions({ computation: at([{ amount: 85_000, status: "APPROVED", allocationId: null }]), allocations, warnPercent: 80, ended: false });
    expect(warn.map((c) => `${c.scopeKey}:${c.kind}`)).toEqual(["-:WARN_THRESHOLD"]);
    const over = budgetAlertConditions({ computation: at([{ amount: 100_500, status: "APPROVED", allocationId: null }]), allocations, warnPercent: 80, ended: false });
    expect(over.map((c) => `${c.scopeKey}:${c.kind}`)).toEqual(["-:OVER_BUDGET"]);
  });

  it("each budget line is checked against its own amount", () => {
    const c = budgetAlertConditions({ computation: at([{ amount: 21_000, status: "APPROVED", allocationId: "print" }]), allocations, warnPercent: 80, ended: false });
    expect(c.map((x) => `${x.scopeKey}:${x.kind}`)).toEqual(["print:OVER_BUDGET"]);
    expect(c[0].message).toContain('Budget line "Print"');
  });

  it("the same figures give the same conditions (so a stored alert isn't raised again)", () => {
    const comp = at([{ amount: 90_000, status: "APPROVED", allocationId: null }]);
    const a = budgetAlertConditions({ computation: comp, allocations, warnPercent: 80, ended: false });
    const b = budgetAlertConditions({ computation: comp, allocations, warnPercent: 80, ended: false });
    expect(a).toEqual(b);
  });

  it("lines adding up to more than a reduced approved budget, and an ended campaign with open orders", () => {
    const comp = computeBudget({ ...base, approved: 70_000, purchaseOrders: [{ id: "p", status: "APPROVED", baseTotal: 1_000, allocationId: null }] });
    const c = budgetAlertConditions({ computation: comp, allocations, warnPercent: 80, ended: true });
    expect(c.map((x) => x.kind).sort()).toEqual(["ENDED_WITH_OPEN_COMMITMENTS", "OVER_ALLOCATED"]);
  });

  it("nothing below the threshold, and nothing without an approved budget", () => {
    expect(budgetAlertConditions({ computation: at([{ amount: 10_000, status: "APPROVED", allocationId: null }]), allocations, warnPercent: 80, ended: false })).toEqual([]);
    expect(budgetAlertConditions({ computation: at([{ amount: 999_999, status: "APPROVED", allocationId: null }], { approved: null }), allocations, warnPercent: 80, ended: false })).toEqual([]);
  });
});
