import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/core/numbering/DocumentNumberingService", () => ({ generateDocumentNumber: vi.fn() }));
vi.mock("@/core/rbac/PermissionService", () => ({ PermissionService: { assert: vi.fn() } }));
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
const { createSalesInvoice, postSalesInvoice, cancelSalesInvoice, updateSalesInvoice } = await import(
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
  vi.mocked(SalesOrderRepository.findByIdWithDetails).mockReset();
  vi.mocked(SalesInvoiceRepository.findByIdWithDetails).mockReset();
  vi.mocked(SalesInvoiceRepository.findAnyById).mockReset();
  vi.mocked(SalesInvoiceRepository.findActiveByOrderId).mockReset().mockResolvedValue(null);
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
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "test" })
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
