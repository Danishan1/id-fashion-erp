import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/core/numbering/DocumentNumberingService", () => ({ generateDocumentNumber: vi.fn() }));
vi.mock("@/core/rbac/PermissionService", () => ({ PermissionService: { assert: vi.fn() } }));
vi.mock("@/modules/purchasing/purchase-order.repository", () => ({
  PurchaseOrderRepository: { findByIdWithDetails: vi.fn() },
  PurchaseOrderItemRepository: { guardedIncrementInvoiced: vi.fn(), guardedDecrementReceived: vi.fn() },
}));
vi.mock("./purchase-invoice.repository", () => ({
  PurchaseInvoiceRepository: {
    findMany: vi.fn(),
    count: vi.fn(),
    findAnyById: vi.fn(),
    findByIdWithDetails: vi.fn(),
    findByIdempotencyKey: vi.fn(),
    createWithItems: vi.fn(),
    replaceItems: vi.fn(),
    updateStatusConditional: vi.fn(),
  },
  CompanyRepository: { findBaseCurrencyCode: vi.fn() },
}));
vi.mock("@/modules/suppliers/supplier.repository", () => ({
  SupplierRepository: { findById: vi.fn() },
}));
vi.mock("./chart-of-account.repository", () => ({
  ChartOfAccountRepository: { findByCode: vi.fn(), findAnyById: vi.fn() },
}));
vi.mock("./tax-config.repository", () => ({
  TaxRateRepository: { findAnyById: vi.fn() },
}));
vi.mock("./journal.service", () => ({ postJournalCore: vi.fn() }));

function makeFakeTx(overrides: { incrementResult?: number; freshItem?: { receivedQuantity: number; invoicedQuantity: number } } = {}) {
  const { incrementResult = 1, freshItem = { receivedQuantity: 100, invoicedQuantity: 0 } } = overrides;
  return {
    journal: { create: vi.fn().mockResolvedValue({ id: "jrn-1" }), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    purchaseInvoice: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    purchaseOrderItem: { findUnique: vi.fn().mockResolvedValue(freshItem) },
    $incrementResult: incrementResult,
  };
}

vi.mock("@/core/db/client", () => ({ prisma: { $transaction: vi.fn() } }));

const { prisma } = await import("@/core/db/client");
const { PermissionService } = await import("@/core/rbac/PermissionService");
const { PurchaseOrderRepository, PurchaseOrderItemRepository } = await import("@/modules/purchasing/purchase-order.repository");
const { PurchaseInvoiceRepository, CompanyRepository } = await import("./purchase-invoice.repository");
const { SupplierRepository } = await import("@/modules/suppliers/supplier.repository");
const { ChartOfAccountRepository } = await import("./chart-of-account.repository");
const { TaxRateRepository } = await import("./tax-config.repository");
const { postJournalCore } = await import("./journal.service");
const { createPurchaseInvoice, postPurchaseInvoice, cancelPurchaseInvoice, updatePurchaseInvoice } = await import(
  "./purchase-invoice.service"
);

const actor = { companyId: "co-1", userId: "user-1", branchId: null };

function orderItem(id: string, receivedQuantity: string, invoicedQuantity = "0", productId = `prod-${id}`) {
  return { id, productId, receivedQuantity, invoicedQuantity };
}

beforeEach(() => {
  vi.mocked(PermissionService.assert).mockReset().mockResolvedValue(undefined);
  vi.mocked(PurchaseOrderRepository.findByIdWithDetails).mockReset();
  vi.mocked(PurchaseOrderItemRepository.guardedIncrementInvoiced).mockReset().mockResolvedValue(1);
  vi.mocked(PurchaseOrderItemRepository.guardedDecrementReceived).mockReset().mockResolvedValue(1);
  vi.mocked(PurchaseInvoiceRepository.findByIdWithDetails).mockReset();
  vi.mocked(PurchaseInvoiceRepository.findAnyById).mockReset();
  vi.mocked(PurchaseInvoiceRepository.createWithItems).mockReset();
  vi.mocked(PurchaseInvoiceRepository.findByIdempotencyKey).mockReset().mockResolvedValue(null);
  vi.mocked(PurchaseInvoiceRepository.replaceItems).mockReset();
  vi.mocked(PurchaseInvoiceRepository.updateStatusConditional).mockReset();
  vi.mocked(CompanyRepository.findBaseCurrencyCode).mockReset();
  vi.mocked(SupplierRepository.findById).mockReset();
  vi.mocked(TaxRateRepository.findAnyById).mockReset();
  vi.mocked(ChartOfAccountRepository.findByCode).mockReset();
  vi.mocked(ChartOfAccountRepository.findAnyById).mockReset();
  vi.mocked(postJournalCore).mockReset().mockResolvedValue(undefined);
  vi.mocked(prisma.$transaction).mockReset();
});

describe("createPurchaseInvoice", () => {
  it("rejects a purchase order not in an eligible status", async () => {
    vi.mocked(PurchaseOrderRepository.findByIdWithDetails).mockResolvedValue({
      id: "po-1",
      status: "DRAFT",
      items: [],
    } as never);

    await expect(
      createPurchaseInvoice(actor, { purchaseOrderId: "po-1", invoiceDate: "2026-08-24", lines: [] })
    ).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  });

  it("rejects a line quantity exceeding what's currently available (received - invoiced)", async () => {
    vi.mocked(PurchaseOrderRepository.findByIdWithDetails).mockResolvedValue({
      id: "po-1",
      status: "PARTIALLY_RECEIVED",
      supplier: { paymentTermsDays: 30 },
      items: [orderItem("item-1", "50", "20")], // 30 available
    } as never);

    await expect(
      createPurchaseInvoice(actor, {
        purchaseOrderId: "po-1",
        invoiceDate: "2026-08-24",
        lines: [{ purchaseOrderItemId: "item-1", quantity: 40, unitPrice: 10, taxRateId: "" }],
      })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("accepts a user-entered price different from any PO price (no derivation, unlike Sales Invoice), computes totals, and allows a subset of lines", async () => {
    vi.mocked(PurchaseOrderRepository.findByIdWithDetails).mockResolvedValue({
      id: "po-1",
      status: "FULLY_RECEIVED",
      supplierId: "sup-1",
      currencyCode: "INR",
      exchangeRate: 1,
      baseCurrencyCode: "INR",
      supplier: { paymentTermsDays: 20 },
      items: [orderItem("item-1", "100", "0"), orderItem("item-2", "50", "0")], // item-2 deliberately skipped
    } as never);
    vi.mocked(TaxRateRepository.findAnyById).mockResolvedValue({ id: "tax-12", ratePercentage: "12.00" } as never);
    vi.mocked(PurchaseInvoiceRepository.createWithItems).mockResolvedValue({ id: "pinv-1" } as never);

    await createPurchaseInvoice(actor, {
      purchaseOrderId: "po-1",
      invoiceDate: "2026-08-24",
      supplierInvoiceNumber: "SUP-BILL-001",
      lines: [{ purchaseOrderItemId: "item-1", quantity: 60, unitPrice: 15, taxRateId: "tax-12" }], // 15, not the (nonexistent) PO price
    });

    const [headerData, items] = vi.mocked(PurchaseInvoiceRepository.createWithItems).mock.calls[0];
    expect(items).toHaveLength(1); // only item-1, item-2 correctly omitted
    expect(items[0]).toMatchObject({ quantity: 60, unitPrice: 15, taxAmount: 108, lineTotal: 1008 }); // 60*15=900, *12%=108
    expect(headerData.subtotalAmount).toBe(900);
    expect(headerData.taxAmount).toBe(108);
    expect(headerData.totalAmount).toBe(1008);
    expect((headerData.dueDate as Date).toISOString().slice(0, 10)).toBe("2026-09-13"); // +20 days
  });

  it("translates a P2002 (duplicate supplier invoice number) into REFERENCED_RECORD_IN_USE", async () => {
    vi.mocked(PurchaseOrderRepository.findByIdWithDetails).mockResolvedValue({
      id: "po-1",
      status: "FULLY_RECEIVED",
      supplierId: "sup-1",
      supplier: { paymentTermsDays: 0 },
      items: [orderItem("item-1", "100")],
    } as never);
    vi.mocked(PurchaseInvoiceRepository.createWithItems).mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "test",
        // Realistic shape for the supplier-invoice-number partial unique
        // index collision — confirmed live against this project's own dev
        // DB (see BusinessRuleError.test.ts).
        meta: { driverAdapterError: { cause: { constraint: { fields: ["supplier_id", "supplier_invoice_number"] } } } },
      })
    );

    await expect(
      createPurchaseInvoice(actor, {
        purchaseOrderId: "po-1",
        invoiceDate: "2026-08-24",
        supplierInvoiceNumber: "DUPLICATE-001",
        lines: [{ purchaseOrderItemId: "item-1", quantity: 10, unitPrice: 5, taxRateId: "" }],
      })
    ).rejects.toMatchObject({ code: "REFERENCED_RECORD_IN_USE" });
  });
});

describe("createPurchaseInvoice — idempotency (CF-5), distinguished from the pre-existing supplier-invoice-number guard", () => {
  const existingInvoice = { id: "pinv-existing", invoiceNumber: "PINV-2026-00001" };
  const validOrder = {
    id: "po-1",
    status: "FULLY_RECEIVED",
    supplierId: "sup-1",
    currencyCode: "INR",
    exchangeRate: 1,
    baseCurrencyCode: "INR",
    supplier: { paymentTermsDays: 20 },
    items: [orderItem("item-1", "100", "0")],
  };
  const validInput = {
    purchaseOrderId: "po-1",
    invoiceDate: "2026-08-24",
    lines: [{ purchaseOrderItemId: "item-1", quantity: 10, unitPrice: 5, taxRateId: "" }],
  };

  beforeEach(() => {
    vi.mocked(PurchaseOrderRepository.findByIdWithDetails).mockResolvedValue(validOrder as never);
  });

  it("returns the original invoice unchanged when the same idempotencyKey is replayed", async () => {
    vi.mocked(PurchaseInvoiceRepository.findByIdempotencyKey).mockResolvedValue(existingInvoice as never);

    const result = await createPurchaseInvoice(actor, { ...validInput, idempotencyKey: "retry-key-1" });

    expect(result).toBe(existingInvoice);
    expect(PurchaseOrderRepository.findByIdWithDetails).not.toHaveBeenCalled();
    expect(PurchaseInvoiceRepository.createWithItems).not.toHaveBeenCalled();
  });

  it("proceeds normally the first time a key is used", async () => {
    vi.mocked(PurchaseInvoiceRepository.createWithItems).mockResolvedValue({ id: "pinv-1" } as never);

    const result = await createPurchaseInvoice(actor, { ...validInput, idempotencyKey: "fresh-key-1" });

    expect(PurchaseInvoiceRepository.findByIdempotencyKey).toHaveBeenCalledWith("co-1", "fresh-key-1");
    expect(PurchaseInvoiceRepository.createWithItems).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: "fresh-key-1" }),
      expect.anything()
    );
    expect((result as { id: string }).id).toBe("pinv-1");
  });

  it("does not check idempotency at all when no key is supplied", async () => {
    vi.mocked(PurchaseInvoiceRepository.createWithItems).mockResolvedValue({ id: "pinv-1" } as never);

    await createPurchaseInvoice(actor, validInput);

    expect(PurchaseInvoiceRepository.findByIdempotencyKey).not.toHaveBeenCalled();
    expect(PurchaseInvoiceRepository.createWithItems).toHaveBeenCalledWith(
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
    vi.mocked(PurchaseInvoiceRepository.createWithItems).mockRejectedValue(idempotencyKeyCollision);
    vi.mocked(PurchaseInvoiceRepository.findByIdempotencyKey)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(existingInvoice as never);

    const result = await createPurchaseInvoice(actor, { ...validInput, idempotencyKey: "racing-key" });

    expect(result).toBe(existingInvoice);
  });

  it("a supplier-invoice-number collision with an idempotencyKey ALSO supplied still reports REFERENCED_RECORD_IN_USE, not misattributed to the idempotency key", async () => {
    const supplierInvoiceCollision = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "test",
      meta: { driverAdapterError: { cause: { constraint: { fields: ["supplier_id", "supplier_invoice_number"] } } } },
    });
    vi.mocked(PurchaseInvoiceRepository.createWithItems).mockRejectedValue(supplierInvoiceCollision);

    await expect(createPurchaseInvoice(actor, { ...validInput, idempotencyKey: "some-key" })).rejects.toMatchObject({
      code: "REFERENCED_RECORD_IN_USE",
    });
    // Called exactly once — the initial pre-check — never a second time from
    // inside the catch block for this collision.
    expect(PurchaseInvoiceRepository.findByIdempotencyKey).toHaveBeenCalledTimes(1);
  });
});

describe("updatePurchaseInvoice / cancelPurchaseInvoice — POSTED_INVOICE_LOCKED", () => {
  it("blocks editing a non-DRAFT invoice", async () => {
    vi.mocked(PurchaseInvoiceRepository.findByIdWithDetails).mockResolvedValue({
      id: "pinv-1",
      status: "POSTED",
      purchaseOrderId: "po-1",
    } as never);

    await expect(
      updatePurchaseInvoice(actor, "pinv-1", { purchaseOrderId: "po-1", invoiceDate: "2026-08-24", lines: [] })
    ).rejects.toMatchObject({ code: "POSTED_INVOICE_LOCKED" });
  });

  it("blocks cancelling a non-DRAFT invoice", async () => {
    vi.mocked(PurchaseInvoiceRepository.findAnyById).mockResolvedValue({ id: "pinv-1", status: "POSTED" } as never);
    vi.mocked(PurchaseInvoiceRepository.updateStatusConditional).mockResolvedValue({ count: 0 } as never);

    await expect(cancelPurchaseInvoice(actor, "pinv-1")).rejects.toMatchObject({ code: "POSTED_INVOICE_LOCKED" });
  });
});

describe("postPurchaseInvoice — self-approval, over-invoice guard, no PO status change", () => {
  const draftInvoice = {
    id: "pinv-1",
    status: "DRAFT",
    createdByUserId: "user-1",
    invoiceNumber: "PINV-2026-00001",
    invoiceDate: new Date("2026-08-24"),
    subtotalAmount: "900",
    taxAmount: "108",
    totalAmount: "1008",
    items: [{ purchaseOrderItemId: "item-1", quantity: "60", product: { styleName: "Cotton Fabric" } }],
  };

  it("asserts the self-approval-guarded 'post' action", async () => {
    vi.mocked(PurchaseInvoiceRepository.findByIdWithDetails)
      .mockResolvedValueOnce(draftInvoice as never)
      .mockResolvedValueOnce({ id: "pinv-1", status: "POSTED" } as never);
    vi.mocked(ChartOfAccountRepository.findByCode).mockImplementation(
      ((_c: string, code: string) => Promise.resolve({ id: `acct-${code}`, code })) as never
    );
    const fakeTx = makeFakeTx();
    vi.mocked(prisma.$transaction).mockImplementation((cb: unknown) => (cb as (tx: unknown) => Promise<unknown>)(fakeTx));

    await postPurchaseInvoice(actor, "pinv-1");

    expect(PermissionService.assert).toHaveBeenCalledWith("user-1", "invoices", "post", { createdBy: "user-1" });
  });

  it("creates Dr Purchases/COGS + Dr GST Input Tax Credit / Cr Accounts Payable, never touching PurchaseOrder.status", async () => {
    vi.mocked(PurchaseInvoiceRepository.findByIdWithDetails)
      .mockResolvedValueOnce(draftInvoice as never)
      .mockResolvedValueOnce({ id: "pinv-1", status: "POSTED" } as never);
    vi.mocked(ChartOfAccountRepository.findByCode).mockImplementation(
      ((_c: string, code: string) => Promise.resolve({ id: `acct-${code}`, code })) as never
    );
    const fakeTx = makeFakeTx();
    vi.mocked(prisma.$transaction).mockImplementation((cb: unknown) => (cb as (tx: unknown) => Promise<unknown>)(fakeTx));

    await postPurchaseInvoice(actor, "pinv-1");

    const createArgs = fakeTx.journal.create.mock.calls[0][0];
    expect(createArgs.data.sourceModule).toBe("PURCHASE_INVOICE");
    expect(createArgs.data.lines.create).toEqual([
      { accountId: "acct-COGS", lineNumber: 1, debitAmount: 900, creditAmount: 0, description: "Purchase Invoice PINV-2026-00001" },
      {
        accountId: "acct-GST-ITC",
        lineNumber: 2,
        debitAmount: 108,
        creditAmount: 0,
        description: "Purchase Invoice PINV-2026-00001 — GST Input",
      },
      { accountId: "acct-AP", lineNumber: 3, debitAmount: 0, creditAmount: 1008, description: "Purchase Invoice PINV-2026-00001" },
    ]);
    expect(postJournalCore).toHaveBeenCalledWith(fakeTx, "jrn-1", "DRAFT", "user-1");
    // The defining Divergence-3 behavior: no purchaseOrder.updateMany call anywhere on the fake tx.
    expect((fakeTx as Record<string, unknown>).purchaseOrder).toBeUndefined();
  });

  it("omits the GST Input line entirely when taxAmount is 0", async () => {
    vi.mocked(PurchaseInvoiceRepository.findByIdWithDetails)
      .mockResolvedValueOnce({ ...draftInvoice, taxAmount: "0", totalAmount: "900" } as never)
      .mockResolvedValueOnce({ id: "pinv-1", status: "POSTED" } as never);
    vi.mocked(ChartOfAccountRepository.findByCode).mockImplementation(
      ((_c: string, code: string) => Promise.resolve({ id: `acct-${code}`, code })) as never
    );
    const fakeTx = makeFakeTx();
    vi.mocked(prisma.$transaction).mockImplementation((cb: unknown) => (cb as (tx: unknown) => Promise<unknown>)(fakeTx));

    await postPurchaseInvoice(actor, "pinv-1");

    expect(fakeTx.journal.create.mock.calls[0][0].data.lines.create).toHaveLength(2);
  });

  it("throws OVER_INVOICE_NOT_ALLOWED with the current availability when the raw-SQL guard fails", async () => {
    vi.mocked(PurchaseInvoiceRepository.findByIdWithDetails).mockResolvedValueOnce(draftInvoice as never);
    vi.mocked(ChartOfAccountRepository.findByCode).mockImplementation(
      ((_c: string, code: string) => Promise.resolve({ id: `acct-${code}`, code })) as never
    );
    const fakeTx = makeFakeTx({ freshItem: { receivedQuantity: 60, invoicedQuantity: 50 } }); // only 10 left, invoice wants 60
    fakeTx.journal.create = vi.fn(); // should never be reached
    vi.mocked(PurchaseOrderItemRepository.guardedIncrementInvoiced).mockResolvedValue(0); // guard fails
    vi.mocked(prisma.$transaction).mockImplementation(async (cb: unknown) => {
      try {
        return await (cb as (tx: unknown) => Promise<unknown>)(fakeTx);
      } catch (e) {
        throw e; // mirror real Prisma: an error inside the callback rejects $transaction
      }
    });

    await expect(postPurchaseInvoice(actor, "pinv-1")).rejects.toMatchObject({
      code: "OVER_INVOICE_NOT_ALLOWED",
      details: expect.objectContaining({ availableQuantityAtCheckTime: 10 }),
    });
    expect(fakeTx.journal.create).not.toHaveBeenCalled();
  });

  it("rejects posting a non-DRAFT invoice with POSTED_INVOICE_LOCKED, never touching the transaction", async () => {
    vi.mocked(PurchaseInvoiceRepository.findByIdWithDetails).mockResolvedValue({
      id: "pinv-1",
      status: "POSTED",
      createdByUserId: "user-1",
    } as never);

    await expect(postPurchaseInvoice(actor, "pinv-1")).rejects.toMatchObject({ code: "POSTED_INVOICE_LOCKED" });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe("createPurchaseInvoice - direct/party bill (no Purchase Order)", () => {
  it("resolves supplier + company base currency directly, with no order fetch at all", async () => {
    vi.mocked(SupplierRepository.findById).mockResolvedValue({ id: "sup-9", paymentTermsDays: 15 } as never);
    vi.mocked(CompanyRepository.findBaseCurrencyCode).mockResolvedValue({ baseCurrencyCode: "INR" } as never);
    vi.mocked(ChartOfAccountRepository.findAnyById).mockResolvedValue({
      id: "acct-freight",
      name: "Freight Expense",
      code: "EXP-FREIGHT",
      accountType: "EXPENSE",
      isActive: true,
    } as never);
    vi.mocked(PurchaseInvoiceRepository.createWithItems).mockResolvedValue({ id: "pinv-direct-1" } as never);

    await createPurchaseInvoice(actor, {
      supplierId: "sup-9",
      invoiceDate: "2026-08-27",
      lines: [{ description: "August freight charges", expenseAccountId: "acct-freight", quantity: 1, unitPrice: 2500, taxRateId: "" }],
    } as never);

    expect(PurchaseOrderRepository.findByIdWithDetails).not.toHaveBeenCalled();
    const [headerData, items] = vi.mocked(PurchaseInvoiceRepository.createWithItems).mock.calls[0];
    expect(headerData).toMatchObject({ purchaseOrderId: null, supplierId: "sup-9", currencyCode: "INR", subtotalAmount: 2500, totalAmount: 2500 });
    expect((headerData.dueDate as Date).toISOString().slice(0, 10)).toBe("2026-09-11"); // +15 days
    expect(items[0]).toMatchObject({ purchaseOrderItemId: null, productId: null, description: "August freight charges", expenseAccountId: "acct-freight" });
  });

  it("rejects a direct line whose chosen account is COGS", async () => {
    vi.mocked(SupplierRepository.findById).mockResolvedValue({ id: "sup-9", paymentTermsDays: 0 } as never);
    vi.mocked(CompanyRepository.findBaseCurrencyCode).mockResolvedValue({ baseCurrencyCode: "INR" } as never);
    vi.mocked(ChartOfAccountRepository.findAnyById).mockResolvedValue({
      id: "acct-cogs",
      name: "Cost of Goods Sold",
      code: "COGS",
      accountType: "EXPENSE",
      isActive: true,
    } as never);

    await expect(
      createPurchaseInvoice(actor, {
        supplierId: "sup-9",
        invoiceDate: "2026-08-27",
        lines: [{ description: "x", expenseAccountId: "acct-cogs", quantity: 1, unitPrice: 100, taxRateId: "" }],
      } as never)
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

describe("postPurchaseInvoice - mixed and direct-only lines", () => {
  it("posts a separate Dr line per distinct direct expense account, alongside Dr COGS for the PO-linked portion", async () => {
    vi.mocked(PurchaseInvoiceRepository.findByIdWithDetails)
      .mockResolvedValueOnce({
        id: "pinv-1",
        status: "DRAFT",
        createdByUserId: "user-1",
        invoiceNumber: "PINV-2026-00002",
        invoiceDate: new Date("2026-08-27"),
        subtotalAmount: "1400",
        taxAmount: "0",
        totalAmount: "1400",
        items: [
          { purchaseOrderItemId: "item-1", expenseAccountId: null, quantity: "60", unitPrice: "15", product: { styleName: "Cotton Fabric" }, expenseAccount: null },
          { purchaseOrderItemId: null, expenseAccountId: "acct-freight", quantity: "1", unitPrice: "300", product: null, expenseAccount: { id: "acct-freight", code: "EXP-FREIGHT", name: "Freight Expense", isActive: true } },
          { purchaseOrderItemId: null, expenseAccountId: "acct-consult", quantity: "1", unitPrice: "200", product: null, expenseAccount: { id: "acct-consult", code: "EXP-CONSULT", name: "Consulting Fees", isActive: true } },
        ],
      } as never)
      .mockResolvedValueOnce({ id: "pinv-1", status: "POSTED" } as never);
    vi.mocked(ChartOfAccountRepository.findByCode).mockImplementation(
      ((_c: string, code: string) => Promise.resolve({ id: `acct-${code}`, code })) as never
    );
    const fakeTx = makeFakeTx();
    vi.mocked(prisma.$transaction).mockImplementation((cb: unknown) => (cb as (tx: unknown) => Promise<unknown>)(fakeTx));

    await postPurchaseInvoice(actor, "pinv-1");

    expect(fakeTx.journal.create.mock.calls[0][0].data.lines.create).toEqual([
      { accountId: "acct-COGS", lineNumber: 1, debitAmount: 900, creditAmount: 0, description: "Purchase Invoice PINV-2026-00002" },
      { accountId: "acct-freight", lineNumber: 2, debitAmount: 300, creditAmount: 0, description: "Purchase Invoice PINV-2026-00002 — Freight Expense" },
      { accountId: "acct-consult", lineNumber: 3, debitAmount: 200, creditAmount: 0, description: "Purchase Invoice PINV-2026-00002 — Consulting Fees" },
      { accountId: "acct-AP", lineNumber: 4, debitAmount: 0, creditAmount: 1400, description: "Purchase Invoice PINV-2026-00002" },
    ]);
    // The over-invoice guard only runs for the one PO-linked item, never the two direct lines.
    expect(PurchaseOrderItemRepository.guardedIncrementInvoiced).toHaveBeenCalledTimes(1);
  });

  it("posts with no COGS line at all for a pure direct/party bill (no Purchase Order)", async () => {
    vi.mocked(PurchaseInvoiceRepository.findByIdWithDetails)
      .mockResolvedValueOnce({
        id: "pinv-2",
        status: "DRAFT",
        createdByUserId: "user-1",
        invoiceNumber: "PINV-2026-00003",
        invoiceDate: new Date("2026-08-27"),
        subtotalAmount: "500",
        taxAmount: "90",
        totalAmount: "590",
        items: [
          { purchaseOrderItemId: null, expenseAccountId: "acct-rent", quantity: "1", unitPrice: "500", product: null, expenseAccount: { id: "acct-rent", code: "EXP-RENT", name: "Factory Rent", isActive: true } },
        ],
      } as never)
      .mockResolvedValueOnce({ id: "pinv-2", status: "POSTED" } as never);
    vi.mocked(ChartOfAccountRepository.findByCode).mockImplementation(
      ((_c: string, code: string) => Promise.resolve({ id: `acct-${code}`, code })) as never
    );
    const fakeTx = makeFakeTx();
    vi.mocked(prisma.$transaction).mockImplementation((cb: unknown) => (cb as (tx: unknown) => Promise<unknown>)(fakeTx));

    await postPurchaseInvoice(actor, "pinv-2");

    expect(fakeTx.journal.create.mock.calls[0][0].data.lines.create).toEqual([
      { accountId: "acct-rent", lineNumber: 1, debitAmount: 500, creditAmount: 0, description: "Purchase Invoice PINV-2026-00003 — Factory Rent" },
      { accountId: "acct-GST-ITC", lineNumber: 2, debitAmount: 90, creditAmount: 0, description: "Purchase Invoice PINV-2026-00003 — GST Input" },
      { accountId: "acct-AP", lineNumber: 3, debitAmount: 0, creditAmount: 590, description: "Purchase Invoice PINV-2026-00003" },
    ]);
    expect(PurchaseOrderItemRepository.guardedIncrementInvoiced).not.toHaveBeenCalled();
    // No PO-linked lines at all - COGS should never even be looked up.
    expect(ChartOfAccountRepository.findByCode).not.toHaveBeenCalledWith("co-1", "COGS");
  });

  it("rejects posting when a direct line's chosen account was deactivated since the invoice was drafted", async () => {
    vi.mocked(PurchaseInvoiceRepository.findByIdWithDetails).mockResolvedValueOnce({
      id: "pinv-3",
      status: "DRAFT",
      createdByUserId: "user-1",
      invoiceNumber: "PINV-2026-00004",
      invoiceDate: new Date("2026-08-27"),
      subtotalAmount: "100",
      taxAmount: "0",
      totalAmount: "100",
      items: [
        { purchaseOrderItemId: null, expenseAccountId: "acct-old", quantity: "1", unitPrice: "100", product: null, expenseAccount: { id: "acct-old", code: "EXP-OLD", name: "Old Account", isActive: false } },
      ],
    } as never);

    await expect(postPurchaseInvoice(actor, "pinv-3")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
