import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/core/numbering/DocumentNumberingService", () => ({ generateDocumentNumber: vi.fn() }));
vi.mock("@/modules/sampling/sample.service", () => ({ createSampleRequest: vi.fn() }));
vi.mock("@/modules/customers/customer.repository", () => ({
  CustomerRepository: { findByIdWithBuyers: vi.fn() },
}));
vi.mock("@/modules/products/product.repository", () => ({
  ProductRepository: { findAnyById: vi.fn() },
}));
vi.mock("@/modules/lookups/lookup.repository", () => ({
  LookupRepository: { size: { findFirst: vi.fn() } },
}));
vi.mock("./buyer-enquiry.repository", () => ({
  BuyerEnquiryRepository: {
    findMany: vi.fn(),
    count: vi.fn(),
    findByIdWithDetails: vi.fn(),
    findAnyById: vi.fn(),
    createWithLines: vi.fn(),
    update: vi.fn(),
  },
  BuyerEnquiryLineRepository: {
    findAnyById: vi.fn(),
    update: vi.fn(),
    findWithEnquiryOwner: vi.fn(),
    convertGuarded: vi.fn(),
    findByEnquiryId: vi.fn(),
  },
}));

const { generateDocumentNumber } = await import("@/core/numbering/DocumentNumberingService");
const { CustomerRepository } = await import("@/modules/customers/customer.repository");
const { ProductRepository } = await import("@/modules/products/product.repository");
const { LookupRepository } = await import("@/modules/lookups/lookup.repository");
const { createSampleRequest } = await import("@/modules/sampling/sample.service");
const { BuyerEnquiryRepository, BuyerEnquiryLineRepository } = await import("./buyer-enquiry.repository");
const { createBuyerEnquiry, linkCustomerToBuyerEnquiry, convertEnquiryLineToSampleRequest } = await import(
  "./buyer-enquiry.service"
);

const actor = { companyId: "co-1", userId: "user-1", branchId: "br-1" };

const baseInput = {
  customerId: "cust-1",
  buyerId: "buyer-1",
  enquiryDate: "2026-08-25",
  source: "EMAIL",
  lines: [{ productId: "prod-1", styleNameFreeText: "" }],
};

beforeEach(() => {
  vi.mocked(generateDocumentNumber).mockReset().mockResolvedValue("ENQ-2026-00001");
  vi.mocked(CustomerRepository.findByIdWithBuyers).mockReset().mockResolvedValue({ id: "cust-1", buyers: [{ id: "buyer-1" }] } as never);
  vi.mocked(ProductRepository.findAnyById).mockReset().mockResolvedValue({ id: "prod-1" } as never);
  vi.mocked(LookupRepository.size.findFirst).mockReset().mockResolvedValue({ id: "size-1", name: "Medium" } as never);
  vi.mocked(BuyerEnquiryRepository.createWithLines).mockReset().mockResolvedValue({ id: "enq-1", enquiryNumber: "ENQ-2026-00001", lines: [{}] } as never);
  vi.mocked(createSampleRequest).mockReset().mockResolvedValue({ id: "sam-1" } as never);
  vi.mocked(BuyerEnquiryLineRepository.findWithEnquiryOwner).mockReset();
  vi.mocked(BuyerEnquiryLineRepository.convertGuarded).mockReset().mockResolvedValue({ count: 1 } as never);
  // recomputeAndPersistEnquiryStatus()'s own dependencies — a plausible
  // "nothing actually changes" default (status already PARTIALLY_CONVERTED,
  // matching the one CONVERTED line) so it's a harmless no-op unless a test
  // specifically cares about the recompute itself.
  vi.mocked(BuyerEnquiryRepository.findAnyById).mockReset().mockResolvedValue({ id: "enq-1", status: "PARTIALLY_CONVERTED" } as never);
  vi.mocked(BuyerEnquiryLineRepository.findByEnquiryId).mockReset().mockResolvedValue([{ lineStatus: "CONVERTED" }] as never);
  vi.mocked(BuyerEnquiryRepository.update).mockReset().mockResolvedValue({ id: "enq-1" } as never);
});

describe("createBuyerEnquiry", () => {
  it("requires either a real Customer or a prospect name", async () => {
    await expect(
      createBuyerEnquiry(actor, { enquiryDate: "2026-08-25", source: "EMAIL", lines: [] } as never)
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  // customerId/buyerId/line.productId were previously written straight from
  // client input with zero ownership check — a direct API call with
  // another tenant's id would succeed, and findByIdWithDetails's
  // unrestricted `include` would then return that tenant's full
  // Customer/Buyer/Product record on every subsequent read (confirmed
  // cross-tenant disclosure, fixed). These reproduce that exact bug class.
  it("rejects a customerId belonging to another company", async () => {
    vi.mocked(CustomerRepository.findByIdWithBuyers).mockResolvedValue(null);
    await expect(createBuyerEnquiry(actor, baseInput as never)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(BuyerEnquiryRepository.createWithLines).not.toHaveBeenCalled();
  });

  it("rejects a buyerId that doesn't belong to the given customer", async () => {
    vi.mocked(CustomerRepository.findByIdWithBuyers).mockResolvedValue({ id: "cust-1", buyers: [{ id: "buyer-other" }] } as never);
    await expect(createBuyerEnquiry(actor, baseInput as never)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(BuyerEnquiryRepository.createWithLines).not.toHaveBeenCalled();
  });

  it("rejects a line productId belonging to another company", async () => {
    vi.mocked(ProductRepository.findAnyById).mockResolvedValue(null);
    await expect(createBuyerEnquiry(actor, baseInput as never)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(BuyerEnquiryRepository.createWithLines).not.toHaveBeenCalled();
  });

  // Size (2026-09-24) — a real Size master FK on the line, same tenant-scoping
  // discipline as productId above.
  it("rejects a line sizeId belonging to another company", async () => {
    vi.mocked(LookupRepository.size.findFirst).mockResolvedValue(null);
    await expect(
      createBuyerEnquiry(actor, { ...baseInput, lines: [{ productId: "prod-1", sizeId: "size-other-tenant" }] } as never)
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(BuyerEnquiryRepository.createWithLines).not.toHaveBeenCalled();
  });

  it("threads a line's sizeId through to the created line", async () => {
    await createBuyerEnquiry(actor, { ...baseInput, lines: [{ productId: "prod-1", sizeId: "size-1" }] } as never);

    const call = vi.mocked(BuyerEnquiryRepository.createWithLines).mock.calls[0][0];
    const created = (call.lines?.create as Array<{ sizeId?: string }>)[0];
    expect(created).toMatchObject({ sizeId: "size-1" });
  });

  it("allows a prospect enquiry with no customerId at all", async () => {
    await createBuyerEnquiry(actor, {
      prospectName: "Prospective Co",
      enquiryDate: "2026-08-25",
      source: "EMAIL",
      lines: [{ styleNameFreeText: "New style" }],
    } as never);

    expect(CustomerRepository.findByIdWithBuyers).not.toHaveBeenCalled();
    expect(BuyerEnquiryRepository.createWithLines).toHaveBeenCalledWith(expect.objectContaining({ prospectName: "Prospective Co" }));
  });

  it("succeeds when the customer, buyer, and every line's product all belong to this company", async () => {
    await createBuyerEnquiry(actor, baseInput as never);
    expect(BuyerEnquiryRepository.createWithLines).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: "cust-1", buyerId: "buyer-1" })
    );
  });
});

// The action the create form's own "conversion requires a real Customer"
// warning always implied existed but never actually did until 2026-09-04.
describe("linkCustomerToBuyerEnquiry", () => {
  beforeEach(() => {
    vi.mocked(BuyerEnquiryRepository.findAnyById).mockReset();
    vi.mocked(BuyerEnquiryRepository.update).mockReset();
  });

  it("links a real Customer to a still-prospect enquiry and clears the prospect fields", async () => {
    vi.mocked(BuyerEnquiryRepository.findAnyById).mockResolvedValue({
      id: "enq-1",
      status: "OPEN",
      customerId: null,
      prospectName: "Prospective Co",
    } as never);
    vi.mocked(BuyerEnquiryRepository.update).mockResolvedValue({ id: "enq-1", customerId: "cust-1" } as never);

    await linkCustomerToBuyerEnquiry(actor, "enq-1", { customerId: "cust-1", buyerId: "buyer-1" });

    expect(BuyerEnquiryRepository.update).toHaveBeenCalledWith(
      "enq-1",
      expect.objectContaining({ customerId: "cust-1", buyerId: "buyer-1", prospectName: null })
    );
  });

  it("rejects when the enquiry already has a real Customer linked", async () => {
    vi.mocked(BuyerEnquiryRepository.findAnyById).mockResolvedValue({
      id: "enq-1",
      status: "OPEN",
      customerId: "cust-existing",
    } as never);

    await expect(linkCustomerToBuyerEnquiry(actor, "enq-1", { customerId: "cust-1" })).rejects.toMatchObject({
      code: "REFERENCED_RECORD_IN_USE",
    });
    expect(BuyerEnquiryRepository.update).not.toHaveBeenCalled();
  });

  it("rejects a cancelled enquiry", async () => {
    vi.mocked(BuyerEnquiryRepository.findAnyById).mockResolvedValue({
      id: "enq-1",
      status: "CANCELLED",
      customerId: null,
    } as never);

    await expect(linkCustomerToBuyerEnquiry(actor, "enq-1", { customerId: "cust-1" })).rejects.toMatchObject({
      code: "INVALID_STATE_TRANSITION",
    });
  });

  it("rejects a Buyer that doesn't belong to the given Customer", async () => {
    vi.mocked(BuyerEnquiryRepository.findAnyById).mockResolvedValue({
      id: "enq-1",
      status: "OPEN",
      customerId: null,
    } as never);
    vi.mocked(CustomerRepository.findByIdWithBuyers).mockResolvedValue({ id: "cust-1", buyers: [{ id: "buyer-other" }] } as never);

    await expect(linkCustomerToBuyerEnquiry(actor, "enq-1", { customerId: "cust-1", buyerId: "buyer-1" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(BuyerEnquiryRepository.update).not.toHaveBeenCalled();
  });

  it("rejects a Customer id that doesn't belong to this company", async () => {
    vi.mocked(BuyerEnquiryRepository.findAnyById).mockResolvedValue({
      id: "enq-1",
      status: "OPEN",
      customerId: null,
    } as never);
    vi.mocked(CustomerRepository.findByIdWithBuyers).mockResolvedValue(null);

    await expect(linkCustomerToBuyerEnquiry(actor, "enq-1", { customerId: "cust-other-tenant" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

// Size threading at conversion time (2026-09-24) — unlike `color`, which the
// service deliberately drops (see its own code comment), `sizeId` is a real
// FK carried through to the created Sample Request, defaulting to whatever
// was recorded on the enquiry line itself.
describe("convertEnquiryLineToSampleRequest", () => {
  const line = {
    id: "line-1",
    buyerEnquiryId: "enq-1",
    lineStatus: "APPROVED_FOR_SAMPLING",
    sampleRequestId: null,
    productId: null,
    sizeId: "size-from-line",
    buyerEnquiry: { companyId: "co-1", status: "OPEN", customerId: "cust-1", buyerId: null },
  };
  const input = { styleName: "Track Pant", sampleType: "PROTO" };

  it("passes the Convert form's own sizeId to createSampleRequest when supplied", async () => {
    vi.mocked(BuyerEnquiryLineRepository.findWithEnquiryOwner).mockResolvedValue(line as never);

    await convertEnquiryLineToSampleRequest(actor, "line-1", { ...input, sizeId: "size-from-form" } as never);

    expect(createSampleRequest).toHaveBeenCalledWith(actor, expect.objectContaining({ sizeId: "size-from-form" }));
  });

  it("defaults to the enquiry line's own sizeId when the Convert form didn't supply one", async () => {
    vi.mocked(BuyerEnquiryLineRepository.findWithEnquiryOwner).mockResolvedValue(line as never);

    await convertEnquiryLineToSampleRequest(actor, "line-1", input as never);

    expect(createSampleRequest).toHaveBeenCalledWith(actor, expect.objectContaining({ sizeId: "size-from-line" }));
  });

  it("passes undefined when neither the line nor the form has a size", async () => {
    vi.mocked(BuyerEnquiryLineRepository.findWithEnquiryOwner).mockResolvedValue({ ...line, sizeId: null } as never);

    await convertEnquiryLineToSampleRequest(actor, "line-1", input as never);

    expect(createSampleRequest).toHaveBeenCalledWith(actor, expect.objectContaining({ sizeId: undefined }));
  });
});
