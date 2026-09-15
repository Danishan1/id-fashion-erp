import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/core/numbering/DocumentNumberingService", () => ({ generateDocumentNumber: vi.fn() }));
vi.mock("@/core/rbac/PermissionService", () => ({ PermissionService: { assert: vi.fn(), getAllowedBranchIds: vi.fn() } }));
vi.mock("@/modules/sales-orders/sales-order.repository", () => ({
  SalesOrderRepository: { findByIdWithDetails: vi.fn() },
}));
vi.mock("./sales-invoice.repository", () => ({
  SalesInvoiceRepository: {
    findMany: vi.fn(),
    count: vi.fn(),
    findAnyById: vi.fn(),
    findByIdWithDetails: vi.fn(),
    findActiveByOrderId: vi.fn(),
    findByIdempotencyKey: vi.fn(),
    createWithItems: vi.fn(),
    replaceItems: vi.fn(),
    updateStatusConditional: vi.fn(),
  },
}));
vi.mock("./chart-of-account.repository", () => ({
  ChartOfAccountRepository: { findByCode: vi.fn() },
}));
vi.mock("./tax-config.repository", () => ({
  TaxRateRepository: { findAnyById: vi.fn() },
}));
vi.mock("./journal.service", () => ({ postJournalCore: vi.fn() }));

function makeFakeTx() {
  return {
    journal: { create: vi.fn().mockResolvedValue({ id: "jrn-1" }), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    salesInvoice: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    salesOrder: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
  };
}

vi.mock("@/core/db/client", () => ({ prisma: { $transaction: vi.fn() } }));

const { prisma } = await import("@/core/db/client");
const { PermissionService } = await import("@/core/rbac/PermissionService");
const { SalesOrderRepository } = await import("@/modules/sales-orders/sales-order.repository");
const { SalesInvoiceRepository } = await import("./sales-invoice.repository");
const { ChartOfAccountRepository } = await import("./chart-of-account.repository");
const { TaxRateRepository } = await import("./tax-config.repository");
const { postJournalCore } = await import("./journal.service");
const { createSalesInvoice, postSalesInvoice, cancelSalesInvoice, updateSalesInvoice, listSalesInvoices, getSalesInvoiceById } = await import(
  "./sales-invoice.service"
);

const actor = { companyId: "co-1", userId: "user-1", branchId: null };

function orderItem(id: string, unitPrice: string, quantities: number[]) {
  return {
    id,
    productId: `prod-${id}`,
    unitPrice,
    breakdown: quantities.map((q) => ({ orderedQuantity: q })),
  };
}

beforeEach(() => {
  vi.mocked(PermissionService.assert).mockReset().mockResolvedValue(undefined);
  vi.mocked(PermissionService.getAllowedBranchIds).mockReset().mockResolvedValue(null);
  vi.mocked(SalesOrderRepository.findByIdWithDetails).mockReset();
  vi.mocked(SalesInvoiceRepository.findByIdWithDetails).mockReset();
  vi.mocked(SalesInvoiceRepository.findAnyById).mockReset();
  vi.mocked(SalesInvoiceRepository.findActiveByOrderId).mockReset().mockResolvedValue(null);
  vi.mocked(SalesInvoiceRepository.findByIdempotencyKey).mockReset().mockResolvedValue(null);
  vi.mocked(SalesInvoiceRepository.createWithItems).mockReset();
  vi.mocked(SalesInvoiceRepository.replaceItems).mockReset();
  vi.mocked(SalesInvoiceRepository.updateStatusConditional).mockReset();
  vi.mocked(TaxRateRepository.findAnyById).mockReset();
  vi.mocked(ChartOfAccountRepository.findByCode).mockReset();
  vi.mocked(postJournalCore).mockReset().mockResolvedValue(undefined);
  vi.mocked(prisma.$transaction).mockReset();
});

describe("createSalesInvoice", () => {
  it("rejects an order that isn't CONFIRMED or IN_PRODUCTION", async () => {
    vi.mocked(SalesOrderRepository.findByIdWithDetails).mockResolvedValue({
      id: "so-1",
      status: "DRAFT",
      items: [],
    } as never);

    await expect(
      createSalesInvoice(actor, { salesOrderId: "so-1", invoiceDate: "2026-08-24", lines: [] })
    ).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  });

  it.each(["PARTIALLY_DISPATCHED", "DISPATCHED"] as const)(
    "regression (Phase 8): accepts an order in %s status — a partially/fully dispatched order must still be invoiceable",
    async (status) => {
      vi.mocked(SalesOrderRepository.findByIdWithDetails).mockResolvedValue({
        id: "so-1",
        status,
        customerId: "cust-1",
        customer: { paymentTermsDays: 30 },
        currencyCode: "INR",
        exchangeRate: 1,
        baseCurrencyCode: "INR",
        items: [orderItem("item-1", "100.00", [10])],
      } as never);
      vi.mocked(SalesInvoiceRepository.createWithItems).mockResolvedValue({ id: "inv-1" } as never);

      await expect(
        createSalesInvoice(actor, { salesOrderId: "so-1", invoiceDate: "2026-08-24", lines: [{ salesOrderItemId: "item-1", taxRateId: "" }] })
      ).resolves.toBeDefined();
    }
  );

  it("rejects when the order already has an active invoice (the friendly pre-check)", async () => {
    vi.mocked(SalesOrderRepository.findByIdWithDetails).mockResolvedValue({
      id: "so-1",
      status: "CONFIRMED",
      items: [orderItem("item-1", "100.00", [10])],
    } as never);
    vi.mocked(SalesInvoiceRepository.findActiveByOrderId).mockResolvedValue({
      id: "inv-existing",
      invoiceNumber: "INV-2026-00001",
    } as never);

    await expect(
      createSalesInvoice(actor, {
        salesOrderId: "so-1",
        invoiceDate: "2026-08-24",
        lines: [{ salesOrderItemId: "item-1", taxRateId: "" }],
      })
    ).rejects.toMatchObject({ code: "REFERENCED_RECORD_IN_USE" });
  });

  it("translates a P2002 (the DB-level race guard) into REFERENCED_RECORD_IN_USE", async () => {
    vi.mocked(SalesOrderRepository.findByIdWithDetails).mockResolvedValue({
      id: "so-1",
      status: "CONFIRMED",
      customerId: "cust-1",
      customer: { paymentTermsDays: 30 },
      currencyCode: "INR",
      exchangeRate: 1,
      baseCurrencyCode: "INR",
      items: [orderItem("item-1", "100.00", [10])],
    } as never);

    vi.mocked(SalesInvoiceRepository.createWithItems).mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "test",
        // Realistic shape for the sales_invoices_one_active_per_order
        // collision — confirmed live against this project's own dev DB (see
        // BusinessRuleError.test.ts). Distinct from an idempotencyKey
        // collision, which the P2002 handler must not conflate with this one.
        meta: { driverAdapterError: { cause: { constraint: { fields: ["sales_order_id"] } } } },
      })
    );

    await expect(
      createSalesInvoice(actor, {
        salesOrderId: "so-1",
        invoiceDate: "2026-08-24",
        lines: [{ salesOrderItemId: "item-1", taxRateId: "" }],
      })
    ).rejects.toMatchObject({ code: "REFERENCED_RECORD_IN_USE" });
  });

  it("rejects a line set that doesn't exactly match the order's own items", async () => {
    vi.mocked(SalesOrderRepository.findByIdWithDetails).mockResolvedValue({
      id: "so-1",
      status: "CONFIRMED",
      customer: { paymentTermsDays: 0 },
      items: [orderItem("item-1", "100.00", [10]), orderItem("item-2", "50.00", [5])],
    } as never);

    await expect(
      createSalesInvoice(actor, {
        salesOrderId: "so-1",
        invoiceDate: "2026-08-24",
        lines: [{ salesOrderItemId: "item-1", taxRateId: "" }], // missing item-2
      })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("computes subtotal/tax/total correctly and defaults dueDate from customer.paymentTermsDays", async () => {
    vi.mocked(SalesOrderRepository.findByIdWithDetails).mockResolvedValue({
      id: "so-1",
      status: "CONFIRMED",
      customerId: "cust-1",
      customer: { paymentTermsDays: 15 },
      currencyCode: "INR",
      exchangeRate: 1,
      baseCurrencyCode: "INR",
      items: [orderItem("item-1", "100.00", [10])], // 10 units @ 100 = 1000
    } as never);
    vi.mocked(TaxRateRepository.findAnyById).mockResolvedValue({ id: "tax-18", ratePercentage: "18.00" } as never);
    vi.mocked(SalesInvoiceRepository.createWithItems).mockResolvedValue({ id: "inv-1" } as never);

    await createSalesInvoice(actor, {
      salesOrderId: "so-1",
      invoiceDate: "2026-08-24",
      lines: [{ salesOrderItemId: "item-1", taxRateId: "tax-18" }],
    });

    const [headerData] = vi.mocked(SalesInvoiceRepository.createWithItems).mock.calls[0];
    expect(headerData.subtotalAmount).toBe(1000);
    expect(headerData.taxAmount).toBe(180);
    expect(headerData.totalAmount).toBe(1180);
    // 2026-08-24 + 15 days
    expect((headerData.dueDate as Date).toISOString().slice(0, 10)).toBe("2026-09-08");
  });
});

describe("createSalesInvoice — idempotency (CF-5), distinguished from the pre-existing one_active_per_order guard", () => {
  const existingInvoice = { id: "inv-existing", invoiceNumber: "INV-2026-00001" };
  const validOrder = {
    id: "so-1",
    status: "CONFIRMED",
    customerId: "cust-1",
    customer: { paymentTermsDays: 30 },
    currencyCode: "INR",
    exchangeRate: 1,
    baseCurrencyCode: "INR",
    items: [orderItem("item-1", "100.00", [10])],
  };
  const validInput = {
    salesOrderId: "so-1",
    invoiceDate: "2026-08-24",
    lines: [{ salesOrderItemId: "item-1", taxRateId: "" }],
  };

  beforeEach(() => {
    vi.mocked(SalesOrderRepository.findByIdWithDetails).mockResolvedValue(validOrder as never);
  });

  it("returns the original invoice unchanged when the same idempotencyKey is replayed, without even checking for an active invoice", async () => {
    vi.mocked(SalesInvoiceRepository.findByIdempotencyKey).mockResolvedValue(existingInvoice as never);

    const result = await createSalesInvoice(actor, { ...validInput, idempotencyKey: "retry-key-1" });

    expect(result).toBe(existingInvoice);
    expect(SalesOrderRepository.findByIdWithDetails).not.toHaveBeenCalled();
    expect(SalesInvoiceRepository.createWithItems).not.toHaveBeenCalled();
  });

  it("proceeds normally the first time a key is used", async () => {
    vi.mocked(SalesInvoiceRepository.createWithItems).mockResolvedValue({ id: "inv-1" } as never);

    const result = await createSalesInvoice(actor, { ...validInput, idempotencyKey: "fresh-key-1" });

    expect(SalesInvoiceRepository.findByIdempotencyKey).toHaveBeenCalledWith("co-1", "fresh-key-1");
    expect(SalesInvoiceRepository.createWithItems).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: "fresh-key-1" }),
      expect.anything()
    );
    expect((result as { id: string }).id).toBe("inv-1");
  });

  it("does not check idempotency at all when no key is supplied", async () => {
    vi.mocked(SalesInvoiceRepository.createWithItems).mockResolvedValue({ id: "inv-1" } as never);

    await createSalesInvoice(actor, validInput);

    expect(SalesInvoiceRepository.findByIdempotencyKey).not.toHaveBeenCalled();
    expect(SalesInvoiceRepository.createWithItems).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: null }),
      expect.anything()
    );
  });

  it("regression: a genuine concurrent replay on the idempotencyKey constraint transparently returns the winner's invoice, not a REFERENCED_RECORD_IN_USE error", async () => {
    const idempotencyKeyCollision = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "test",
      meta: { driverAdapterError: { cause: { constraint: { fields: ["company_id", "idempotency_key"] } } } },
    });
    vi.mocked(SalesInvoiceRepository.createWithItems).mockRejectedValue(idempotencyKeyCollision);
    vi.mocked(SalesInvoiceRepository.findByIdempotencyKey)
      .mockResolvedValueOnce(null) // pre-check, before the race is lost
      .mockResolvedValueOnce(existingInvoice as never); // post-catch re-fetch, after losing the race

    const result = await createSalesInvoice(actor, { ...validInput, idempotencyKey: "racing-key" });

    expect(result).toBe(existingInvoice);
  });

  it("a one_active_per_order collision with an idempotencyKey ALSO supplied still reports REFERENCED_RECORD_IN_USE, not misattributed to the idempotency key", async () => {
    const activePerOrderCollision = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "test",
      meta: { driverAdapterError: { cause: { constraint: { fields: ["sales_order_id"] } } } },
    });
    vi.mocked(SalesInvoiceRepository.createWithItems).mockRejectedValue(activePerOrderCollision);

    await expect(createSalesInvoice(actor, { ...validInput, idempotencyKey: "some-key" })).rejects.toMatchObject({
      code: "REFERENCED_RECORD_IN_USE",
    });
    // findByIdempotencyKey is called exactly once — the initial pre-check
    // (returns null, so creation proceeds) — and NOT a second time from
    // inside the catch block, confirming the active-per-order collision was
    // correctly routed away from the idempotency-replay branch.
    expect(SalesInvoiceRepository.findByIdempotencyKey).toHaveBeenCalledTimes(1);
  });
});

describe("updateSalesInvoice / cancelSalesInvoice — POSTED_INVOICE_LOCKED, not the generic transition error", () => {
  it("blocks editing a non-DRAFT invoice with POSTED_INVOICE_LOCKED", async () => {
    vi.mocked(SalesInvoiceRepository.findByIdWithDetails).mockResolvedValue({
      id: "inv-1",
      status: "POSTED",
      salesOrderId: "so-1",
    } as never);

    await expect(
      updateSalesInvoice(actor, "inv-1", { salesOrderId: "so-1", invoiceDate: "2026-08-24", lines: [] })
    ).rejects.toMatchObject({ code: "POSTED_INVOICE_LOCKED" });
  });

  it("blocks cancelling a non-DRAFT invoice with POSTED_INVOICE_LOCKED (guarded conditional update lost)", async () => {
    vi.mocked(SalesInvoiceRepository.findAnyById).mockResolvedValue({ id: "inv-1", status: "POSTED" } as never);
    vi.mocked(SalesInvoiceRepository.updateStatusConditional).mockResolvedValue({ count: 0 } as never);

    await expect(cancelSalesInvoice(actor, "inv-1")).rejects.toMatchObject({ code: "POSTED_INVOICE_LOCKED" });
  });
});

describe("postSalesInvoice — self-approval guard + one-transaction settlement journal", () => {
  it("asserts the self-approval-guarded 'post' action with resourceContext.createdBy", async () => {
    vi.mocked(SalesInvoiceRepository.findByIdWithDetails)
      .mockResolvedValueOnce({
        id: "inv-1",
        status: "DRAFT",
        createdByUserId: "user-1",
        totalAmount: "1180",
        subtotalAmount: "1000",
        taxAmount: "180",
        invoiceNumber: "INV-2026-00001",
        invoiceDate: new Date("2026-08-24"),
        salesOrderId: "so-1",
      } as never)
      .mockResolvedValueOnce({ id: "inv-1", status: "POSTED" } as never);
    vi.mocked(ChartOfAccountRepository.findByCode).mockImplementation(
      ((_c: string, code: string) => Promise.resolve({ id: `acct-${code}`, code })) as never
    );
    const fakeTx = makeFakeTx();
    vi.mocked(prisma.$transaction).mockImplementation((cb: unknown) => (cb as (tx: unknown) => Promise<unknown>)(fakeTx));

    await postSalesInvoice(actor, "inv-1");

    expect(PermissionService.assert).toHaveBeenCalledWith("user-1", "invoices", "post", { createdBy: "user-1" });
  });

  it("creates Dr AR / Cr Sales Revenue / Cr GST Payable lines matching the invoice totals, and auto-posts via postJournalCore without a second permission check", async () => {
    vi.mocked(SalesInvoiceRepository.findByIdWithDetails)
      .mockResolvedValueOnce({
        id: "inv-1",
        status: "DRAFT",
        createdByUserId: "user-1",
        totalAmount: "1180",
        subtotalAmount: "1000",
        taxAmount: "180",
        invoiceNumber: "INV-2026-00001",
        invoiceDate: new Date("2026-08-24"),
        salesOrderId: "so-1",
      } as never)
      .mockResolvedValueOnce({ id: "inv-1", status: "POSTED" } as never);
    vi.mocked(ChartOfAccountRepository.findByCode).mockImplementation(
      ((_c: string, code: string) => Promise.resolve({ id: `acct-${code}`, code })) as never
    );
    const fakeTx = makeFakeTx();
    vi.mocked(prisma.$transaction).mockImplementation((cb: unknown) => (cb as (tx: unknown) => Promise<unknown>)(fakeTx));

    await postSalesInvoice(actor, "inv-1");

    const createArgs = fakeTx.journal.create.mock.calls[0][0];
    expect(createArgs.data.sourceModule).toBe("SALES_INVOICE");
    expect(createArgs.data.sourceRecordId).toBe("inv-1");
    expect(createArgs.data.lines.create).toEqual([
      { accountId: "acct-AR", lineNumber: 1, debitAmount: 1180, creditAmount: 0, description: "Invoice INV-2026-00001" },
      { accountId: "acct-SALES-REV", lineNumber: 2, debitAmount: 0, creditAmount: 1000, description: "Invoice INV-2026-00001" },
      {
        accountId: "acct-GST-PAY",
        lineNumber: 3,
        debitAmount: 0,
        creditAmount: 180,
        description: "Invoice INV-2026-00001 — GST",
      },
    ]);
    // postJournalCore called exactly once — its own doc comment establishes
    // this is the trusted, non-permission-checked internal auto-post path.
    expect(postJournalCore).toHaveBeenCalledTimes(1);
    expect(postJournalCore).toHaveBeenCalledWith(fakeTx, "jrn-1", "DRAFT", "user-1");
  });

  it("omits the GST line entirely when taxAmount is 0", async () => {
    vi.mocked(SalesInvoiceRepository.findByIdWithDetails)
      .mockResolvedValueOnce({
        id: "inv-1",
        status: "DRAFT",
        createdByUserId: "user-1",
        totalAmount: "1000",
        subtotalAmount: "1000",
        taxAmount: "0",
        invoiceNumber: "INV-2026-00002",
        invoiceDate: new Date("2026-08-24"),
        salesOrderId: "so-1",
      } as never)
      .mockResolvedValueOnce({ id: "inv-1", status: "POSTED" } as never);
    vi.mocked(ChartOfAccountRepository.findByCode).mockImplementation(
      ((_c: string, code: string) => Promise.resolve({ id: `acct-${code}`, code })) as never
    );
    const fakeTx = makeFakeTx();
    vi.mocked(prisma.$transaction).mockImplementation((cb: unknown) => (cb as (tx: unknown) => Promise<unknown>)(fakeTx));

    await postSalesInvoice(actor, "inv-1");

    const createArgs = fakeTx.journal.create.mock.calls[0][0];
    expect(createArgs.data.lines.create).toHaveLength(2);
  });

  it("rejects posting a non-DRAFT invoice with POSTED_INVOICE_LOCKED, never touching the transaction", async () => {
    vi.mocked(SalesInvoiceRepository.findByIdWithDetails).mockResolvedValue({
      id: "inv-1",
      status: "POSTED",
      createdByUserId: "user-1",
    } as never);

    await expect(postSalesInvoice(actor, "inv-1")).rejects.toMatchObject({ code: "POSTED_INVOICE_LOCKED" });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe("branch access enforcement (2026-09-15)", () => {
  const listQuery = { search: "", sortBy: "createdAt", sortOrder: "desc" as const, page: 1, pageSize: 20, skip: 0, take: 20 };

  beforeEach(() => {
    vi.mocked(SalesInvoiceRepository.findMany).mockReset().mockResolvedValue([]);
    vi.mocked(SalesInvoiceRepository.count).mockReset().mockResolvedValue(0);
  });

  it("listSalesInvoices adds no branch filter for an unrestricted user", async () => {
    vi.mocked(PermissionService.getAllowedBranchIds).mockResolvedValue(null);

    await listSalesInvoices(actor, listQuery);

    const whereArg = vi.mocked(SalesInvoiceRepository.findMany).mock.calls[0][0];
    expect(whereArg).not.toHaveProperty("branchId");
  });

  it("listSalesInvoices adds a branchId IN filter for a branch-restricted user", async () => {
    vi.mocked(PermissionService.getAllowedBranchIds).mockResolvedValue(new Set(["branch-1"]));

    await listSalesInvoices(actor, listQuery);

    expect(SalesInvoiceRepository.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ branchId: { in: ["branch-1"] } }),
      expect.anything()
    );
  });

  it("getSalesInvoiceById succeeds for an invoice inside the user's allowed branches", async () => {
    vi.mocked(SalesInvoiceRepository.findByIdWithDetails).mockResolvedValue({ id: "inv-1", branchId: "branch-1" } as never);
    vi.mocked(PermissionService.getAllowedBranchIds).mockResolvedValue(new Set(["branch-1"]));

    const invoice = await getSalesInvoiceById(actor, "inv-1");
    expect(invoice.id).toBe("inv-1");
  });

  it("getSalesInvoiceById throws NOT_FOUND for an invoice outside the user's allowed branches", async () => {
    vi.mocked(SalesInvoiceRepository.findByIdWithDetails).mockResolvedValue({ id: "inv-1", branchId: "branch-2" } as never);
    vi.mocked(PermissionService.getAllowedBranchIds).mockResolvedValue(new Set(["branch-1"]));

    await expect(getSalesInvoiceById(actor, "inv-1")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
