import { beforeEach, describe, expect, it, vi } from "vitest";

// Scoped to the cross-tenant taxTypeId guard added to createTaxRate/
// updateTaxRate — this module previously had zero test coverage at all, and
// this file is not intended to be full coverage of tax-config.service.ts;
// it exists to verify the one fix this file's diff introduced.

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("./tax-config.repository", () => ({
  TaxTypeRepository: { findAnyById: vi.fn() },
  TaxRateRepository: {
    findAnyById: vi.fn(),
    findActiveByTaxType: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
}));

const { TaxTypeRepository, TaxRateRepository } = await import("./tax-config.repository");
const { createTaxRate, updateTaxRate } = await import("./tax-config.service");

const actor = { companyId: "co-1", userId: "user-1" };
const rateInput = { taxTypeId: "tt-1", name: "GST 18%", ratePercentage: 18, effectiveFrom: "2026-01-01", effectiveTo: "" };

beforeEach(() => {
  vi.mocked(TaxTypeRepository.findAnyById).mockReset().mockResolvedValue({ id: "tt-1" } as never);
  vi.mocked(TaxRateRepository.findAnyById).mockReset().mockResolvedValue({ id: "rate-1", name: "GST 12%", ratePercentage: "12" } as never);
  vi.mocked(TaxRateRepository.findActiveByTaxType).mockReset().mockResolvedValue([]);
  vi.mocked(TaxRateRepository.create).mockReset().mockResolvedValue({ id: "rate-new" } as never);
  vi.mocked(TaxRateRepository.update).mockReset().mockResolvedValue({ id: "rate-1" } as never);
});

describe("createTaxRate", () => {
  it("rejects a taxTypeId belonging to another company", async () => {
    vi.mocked(TaxTypeRepository.findAnyById).mockResolvedValue(null);
    await expect(createTaxRate(actor, rateInput as never)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(TaxRateRepository.create).not.toHaveBeenCalled();
  });
});

describe("updateTaxRate", () => {
  // taxTypeId was validated on create but not re-validated here on update —
  // a direct API call could swap in another tenant's taxTypeId on an
  // existing rate (confirmed cross-tenant risk, fixed).
  it("rejects a taxTypeId belonging to another company", async () => {
    vi.mocked(TaxTypeRepository.findAnyById).mockResolvedValue(null);
    await expect(updateTaxRate(actor, "rate-1", rateInput as never)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(TaxRateRepository.update).not.toHaveBeenCalled();
  });

  it("succeeds when the taxTypeId belongs to this company", async () => {
    await updateTaxRate(actor, "rate-1", rateInput as never);
    expect(TaxRateRepository.update).toHaveBeenCalledWith("rate-1", expect.objectContaining({ taxTypeId: "tt-1" }));
  });
});
