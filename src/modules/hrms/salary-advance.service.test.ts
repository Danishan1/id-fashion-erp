import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  salaryAdvance: { count: vi.fn(), create: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), findUniqueOrThrow: vi.fn() },
}));
const pr = vi.hoisted(() => ({ createPaymentRequest: vi.fn(), cancelPaymentRequest: vi.fn() }));
const perm = vi.hoisted(() => ({ can: vi.fn() }));
vi.mock("@/core/db/client", () => ({ prisma: db }));
vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/core/rbac/PermissionService", () => ({ PermissionService: perm }));
vi.mock("@/modules/accounts/payment-requests/payment-request.service", () => pr);

const svc = await import("./salary-advance.service");
const actor = { companyId: "c1", userId: "u1", branchId: null };
const input = { amount: 10000, installments: 3, reason: "family function", requestKey: "key-12345678" };

const row = (patch: Record<string, unknown> = {}) => ({
  id: "a1",
  employee: { id: "e1", employeeCode: "E1", fullName: "Ravi" },
  amount: 10000,
  installments: 3,
  installmentAmount: 3333.34,
  reason: "x",
  createdAt: new Date(),
  paymentRequest: { id: "pr1", requestNumber: "PR-1", status: "PAID", paidAmount: 10000, rejectionReason: null },
  recoveries: [],
  ...patch,
});

beforeEach(() => {
  vi.clearAllMocks();
  db.user.findUnique.mockResolvedValue({ employeeId: "e1" });
  db.salaryAdvance.count.mockResolvedValue(0);
  pr.createPaymentRequest.mockResolvedValue({ id: "pr1" });
  db.salaryAdvance.create.mockResolvedValue(row({ paymentRequest: { id: "pr1", requestNumber: "PR-1", status: "PENDING_APPROVAL", paidAmount: 0, rejectionReason: null } }));
});

describe("deriveAdvanceStatus", () => {
  it("follows the payment request, then the recoveries", () => {
    expect(svc.deriveAdvanceStatus("PENDING_APPROVAL", 100, 0)).toBe("PENDING_APPROVAL");
    expect(svc.deriveAdvanceStatus("APPROVED", 100, 0)).toBe("APPROVED");
    expect(svc.deriveAdvanceStatus("PARTIALLY_PAID", 100, 0)).toBe("APPROVED");
    expect(svc.deriveAdvanceStatus("REJECTED", 100, 0)).toBe("REJECTED");
    expect(svc.deriveAdvanceStatus("CANCELLED", 100, 0)).toBe("CANCELLED");
    expect(svc.deriveAdvanceStatus("PAID", 100, 40)).toBe("RECOVERING");
    expect(svc.deriveAdvanceStatus("PAID", 100, 100)).toBe("RECOVERED");
  });
});

describe("requestSalaryAdvance", () => {
  it("raises a SALARY_ADVANCE payment request for the caller's own employee", async () => {
    const v = await svc.requestSalaryAdvance(actor, input);
    expect(pr.createPaymentRequest).toHaveBeenCalledWith(
      { companyId: "c1", userId: "u1", branchId: null },
      expect.objectContaining({ requestType: "SALARY_ADVANCE", amount: 10000, employeeId: "e1", idempotencyKey: "salary-advance:key-12345678" }),
      { fromSource: true }
    );
    expect(db.salaryAdvance.create.mock.calls[0][0].data).toMatchObject({ employeeId: "e1", paymentRequestId: "pr1", installments: 3, installmentAmount: 3333.34 });
    expect(v.status).toBe("PENDING_APPROVAL");
  });

  it("refuses a login without an employee and a second open request", async () => {
    db.user.findUnique.mockResolvedValueOnce({ employeeId: null });
    await expect(svc.requestSalaryAdvance(actor, input)).rejects.toThrow(/not linked to an employee/);
    db.salaryAdvance.count.mockResolvedValueOnce(1);
    await expect(svc.requestSalaryAdvance(actor, input)).rejects.toThrow(/already have an advance/);
    expect(pr.createPaymentRequest).not.toHaveBeenCalled();
  });

  it("a retry reuses the advance already linked to the payment request", async () => {
    db.salaryAdvance.create.mockRejectedValueOnce(Object.assign(new Error("dup"), { code: "P2002" }));
    db.salaryAdvance.findUniqueOrThrow.mockResolvedValueOnce(row());
    const v = await svc.requestSalaryAdvance(actor, input);
    expect(v.id).toBe("a1");
  });
});

describe("listSalaryAdvances", () => {
  it("without view_all only your own", async () => {
    perm.can.mockResolvedValue(false);
    db.salaryAdvance.findMany.mockResolvedValue([row({ recoveries: [{ amount: 3333.34, createdAt: new Date(), runLine: { run: { year: 2026, month: 9 } } }] })]);
    const r = await svc.listSalaryAdvances(actor);
    expect(db.salaryAdvance.findMany.mock.calls[0][0].where).toEqual({ companyId: "c1", employeeId: "e1" });
    expect(r.advances[0]).toMatchObject({ status: "RECOVERING", recovered: 3333.34, remaining: 6666.66 });
  });
});

describe("advanceInstallmentsFor", () => {
  it("takes the smaller of the installment and what is left, per paid advance", async () => {
    db.salaryAdvance.findMany.mockResolvedValue([
      { id: "a1", employeeId: "e1", amount: 10000, installmentAmount: 3333.34, recoveries: [{ amount: 3333.34 }, { amount: 3333.34 }] },
      { id: "a2", employeeId: "e1", amount: 2000, installmentAmount: 1000, recoveries: [] },
      { id: "a3", employeeId: "e2", amount: 500, installmentAmount: 500, recoveries: [{ amount: 500 }] },
    ]);
    const m = await svc.advanceInstallmentsFor("c1", ["e1", "e2"]);
    expect(m.get("e1")).toEqual({ total: 4333.32, items: [{ advanceId: "a1", amount: 3333.32 }, { advanceId: "a2", amount: 1000 }] });
    expect(m.has("e2")).toBe(false);
    expect(db.salaryAdvance.findMany.mock.calls[0][0].where).toEqual({ companyId: "c1", employeeId: { in: ["e1", "e2"] }, paymentRequest: { status: "PAID" } });
  });
});
