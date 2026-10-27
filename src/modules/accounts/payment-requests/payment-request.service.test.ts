import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPaymentRequestSchema } from "./payment-request.schema";

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/core/numbering/DocumentNumberingService", () => ({ generateDocumentNumber: vi.fn() }));
vi.mock("@/core/rbac/PermissionService", () => ({
  PermissionService: { assert: vi.fn(), can: vi.fn(), getAllowedBranchIds: vi.fn() },
}));
vi.mock("./payment-request.repository", () => ({
  PaymentRequestRepository: {
    findMany: vi.fn(),
    count: vi.fn(),
    findByIdWithDetails: vi.fn(),
    findByIdempotencyKey: vi.fn(),
    create: vi.fn(),
    updateIfStatus: vi.fn(),
    countByGroupAndStatus: vi.fn(),
    findBaseCurrencyCode: vi.fn(),
    findActiveSupplier: vi.fn(),
    findActiveEmployee: vi.fn(),
  },
}));

const { PermissionService } = await import("@/core/rbac/PermissionService");
const { generateDocumentNumber } = await import("@/core/numbering/DocumentNumberingService");
const { PaymentRequestRepository } = await import("./payment-request.repository");
const {
  createPaymentRequest,
  updatePaymentRequest,
  approvePaymentRequest,
  rejectPaymentRequest,
  cancelPaymentRequest,
  listPaymentRequests,
  getPaymentRequestById,
} = await import("./payment-request.service");

const actor = { companyId: "co-1", userId: "user-1", branchId: "br-1" };
const listQuery = { page: 1, pageSize: 20, skip: 0, take: 20, sortBy: "createdAt", sortOrder: "desc" as const };

function storedRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: "pr-1",
    companyId: "co-1",
    branchId: "br-1",
    requestNumber: "PRQ-2026-00001",
    requestType: "CASH_WITHDRAWAL",
    requestGroup: "INTERNAL_TRANSFER",
    status: "PENDING_APPROVAL",
    routing: "APPROVAL_THEN_PAY",
    amount: "1000.00",
    paidAmount: "0",
    payToName: "Petty cash",
    supplierId: null,
    employeeId: null,
    paymentDueDate: new Date("2026-10-27"),
    remark: null,
    createdByUserId: "user-1",
    ...overrides,
  };
}

/** Grants the listed actions on payment_requests; everything else is denied. */
function grant(...actions: string[]) {
  vi.mocked(PermissionService.can).mockImplementation(async (_u, _m, action) => actions.includes(action));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(PermissionService.assert).mockResolvedValue(undefined);
  vi.mocked(PermissionService.getAllowedBranchIds).mockResolvedValue(null);
  grant();
  vi.mocked(generateDocumentNumber).mockResolvedValue("PRQ-2026-00001");
  vi.mocked(PaymentRequestRepository.findBaseCurrencyCode).mockResolvedValue({ baseCurrencyCode: "INR" } as never);
  vi.mocked(PaymentRequestRepository.findByIdempotencyKey).mockResolvedValue(null);
  vi.mocked(PaymentRequestRepository.create).mockResolvedValue(storedRequest() as never);
  vi.mocked(PaymentRequestRepository.findByIdWithDetails).mockResolvedValue(storedRequest() as never);
  vi.mocked(PaymentRequestRepository.updateIfStatus).mockResolvedValue({ count: 1 });
});

describe("schema", () => {
  it("refuses more than 2 decimal places and accepts 1 or 2", () => {
    const base = { requestType: "CASH_WITHDRAWAL", payToName: "x" };
    expect(createPaymentRequestSchema.safeParse({ ...base, amount: 10.123 }).success).toBe(false);
    expect(createPaymentRequestSchema.safeParse({ ...base, amount: 10.1 }).success).toBe(true);
    expect(createPaymentRequestSchema.safeParse({ ...base, amount: 10.12 }).success).toBe(true);
    expect(createPaymentRequestSchema.safeParse({ ...base, amount: 0 }).success).toBe(false);
  });
});

describe("createPaymentRequest", () => {
  it("creates a pending request with a company-wide number and today's due date by default", async () => {
    await createPaymentRequest(actor, { requestType: "CASH_WITHDRAWAL", amount: 1000, payToName: "  Petty cash  " });

    expect(generateDocumentNumber).toHaveBeenCalledWith({ companyId: "co-1", branchId: null, documentType: "PAYMENT_REQUEST" });
    const data = vi.mocked(PaymentRequestRepository.create).mock.calls[0][0];
    expect(data).toMatchObject({
      status: "PENDING_APPROVAL",
      routing: "APPROVAL_THEN_PAY",
      requestGroup: "INTERNAL_TRANSFER",
      payToName: "Petty cash",
      currencyCode: "INR",
      createdByUserId: "user-1",
    });
    expect((data.paymentDueDate as Date).toISOString().slice(0, 10)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("refuses a request type that is not built yet", async () => {
    await expect(createPaymentRequest(actor, { requestType: "SALARY", amount: 10, employeeId: "e-1" })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    expect(PaymentRequestRepository.create).not.toHaveBeenCalled();
  });

  it("needs a registered, active supplier for a supplier request and copies its name", async () => {
    await expect(createPaymentRequest(actor, { requestType: "SUPPLIER_ON_ACCOUNT", amount: 10 })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });

    vi.mocked(PaymentRequestRepository.findActiveSupplier).mockResolvedValueOnce(null);
    await expect(
      createPaymentRequest(actor, { requestType: "SUPPLIER_ON_ACCOUNT", amount: 10, supplierId: "11111111-1111-1111-1111-111111111111" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    vi.mocked(PaymentRequestRepository.findActiveSupplier).mockResolvedValueOnce({ id: "sup-1", name: "HP Cotton" } as never);
    await createPaymentRequest(actor, { requestType: "SUPPLIER_ON_ACCOUNT", amount: 10, supplierId: "sup-1", payToName: "ignored" });
    expect(vi.mocked(PaymentRequestRepository.create).mock.calls[0][0]).toMatchObject({ supplierId: "sup-1", payToName: "HP Cotton" });
  });

  it("returns the existing request when the same idempotency key is replayed", async () => {
    vi.mocked(PaymentRequestRepository.findByIdempotencyKey).mockResolvedValueOnce(storedRequest() as never);
    const result = await createPaymentRequest(actor, { requestType: "CASH_WITHDRAWAL", amount: 1000, payToName: "x", idempotencyKey: "k1" });
    expect(result.id).toBe("pr-1");
    expect(PaymentRequestRepository.create).not.toHaveBeenCalled();
  });

  it("drops mode of transfer for a type that does not use it", async () => {
    await createPaymentRequest(actor, { requestType: "CASH_WITHDRAWAL", amount: 5, payToName: "x", modeOfTransfer: "NEFT" });
    expect(vi.mocked(PaymentRequestRepository.create).mock.calls[0][0]).toMatchObject({ modeOfTransfer: null });
  });
});

describe("visibility", () => {
  it("hides another user's request (as not found) without view_all/approve/post", async () => {
    vi.mocked(PaymentRequestRepository.findByIdWithDetails).mockResolvedValue(storedRequest({ createdByUserId: "other" }) as never);
    await expect(getPaymentRequestById(actor, "pr-1")).rejects.toMatchObject({ code: "NOT_FOUND" });

    grant("approve");
    await expect(getPaymentRequestById(actor, "pr-1")).resolves.toMatchObject({ id: "pr-1" });
  });

  it("hides a request outside the actor's branches", async () => {
    vi.mocked(PermissionService.getAllowedBranchIds).mockResolvedValue(new Set(["br-2"]));
    await expect(getPaymentRequestById(actor, "pr-1")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("lists only own requests without view_all, everything with it", async () => {
    vi.mocked(PaymentRequestRepository.findMany).mockResolvedValue([]);
    vi.mocked(PaymentRequestRepository.count).mockResolvedValue(0);

    await listPaymentRequests(actor, listQuery, {});
    expect(vi.mocked(PaymentRequestRepository.findMany).mock.calls[0][0]).toMatchObject({ createdByUserId: "user-1" });

    grant("view_all");
    await listPaymentRequests(actor, listQuery, { view: "pay" });
    const where = vi.mocked(PaymentRequestRepository.findMany).mock.calls[1][0];
    expect(where.createdByUserId).toBeUndefined();
    expect(where.status).toEqual({ in: ["APPROVED", "PARTIALLY_PAID"] });
  });

  it("marks an approved request past its due date as overdue", async () => {
    vi.mocked(PaymentRequestRepository.findByIdWithDetails).mockResolvedValue(
      storedRequest({ status: "APPROVED", paymentDueDate: new Date("2020-01-01") }) as never
    );
    await expect(getPaymentRequestById(actor, "pr-1")).resolves.toMatchObject({ isOverdue: true });
  });
});

describe("approve / reject / edit / cancel", () => {
  it("approves with the self-approval guard (createdBy passed to PermissionService)", async () => {
    grant("approve");
    await approvePaymentRequest({ companyId: "co-1", userId: "approver" }, "pr-1");
    expect(PermissionService.assert).toHaveBeenCalledWith("approver", "payment_requests", "approve", { createdBy: "user-1" });
    expect(vi.mocked(PaymentRequestRepository.updateIfStatus).mock.calls[0][1]).toEqual(["PENDING_APPROVAL"]);
  });

  it("refuses to approve when the request already moved on", async () => {
    grant("approve");
    vi.mocked(PaymentRequestRepository.updateIfStatus).mockResolvedValueOnce({ count: 0 });
    await expect(approvePaymentRequest(actor, "pr-1")).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  });

  it("stores the rejection reason", async () => {
    grant("reject");
    await rejectPaymentRequest(actor, "pr-1", "Not needed");
    expect(vi.mocked(PaymentRequestRepository.updateIfStatus).mock.calls[0][2]).toMatchObject({
      status: "REJECTED",
      rejectionReason: "Not needed",
    });
  });

  it("lets the raiser edit their own pending request without the edit permission", async () => {
    await updatePaymentRequest(actor, "pr-1", { amount: 250.5, payToName: "Cash box" });
    expect(PermissionService.assert).not.toHaveBeenCalled();
    expect(vi.mocked(PaymentRequestRepository.updateIfStatus).mock.calls[0][2]).toMatchObject({
      amount: 250.5,
      payToName: "Cash box",
      // Omitted due date keeps the stored one rather than resetting to today.
      paymentDueDate: new Date("2026-10-27"),
    });
  });

  it("requires the edit permission to change someone else's request, and refuses after approval", async () => {
    grant("view_all");
    vi.mocked(PaymentRequestRepository.findByIdWithDetails).mockResolvedValue(storedRequest({ createdByUserId: "other" }) as never);
    await updatePaymentRequest(actor, "pr-1", { amount: 1, payToName: "x" });
    expect(PermissionService.assert).toHaveBeenCalledWith("user-1", "payment_requests", "edit");

    vi.mocked(PaymentRequestRepository.updateIfStatus).mockResolvedValueOnce({ count: 0 });
    await expect(updatePaymentRequest(actor, "pr-1", { amount: 1, payToName: "x" })).rejects.toMatchObject({
      code: "INVALID_STATE_TRANSITION",
    });
  });

  it("cancels only while pending or approved and unpaid", async () => {
    await cancelPaymentRequest(actor, "pr-1");
    expect(vi.mocked(PaymentRequestRepository.updateIfStatus).mock.calls[0][1]).toEqual(["PENDING_APPROVAL", "APPROVED"]);

    vi.mocked(PaymentRequestRepository.updateIfStatus).mockResolvedValueOnce({ count: 0 });
    await expect(cancelPaymentRequest(actor, "pr-1")).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  });
});
