import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/db/client", () => ({ prisma: { employee: { findUnique: vi.fn() } } }));
vi.mock("./production.repository", () => ({
  PieceRateCardRepository: { findActiveForResolution: vi.fn() },
}));

const { prisma } = await import("@/core/db/client");
const { PieceRateCardRepository } = await import("./production.repository");
const { resolvePieceRate, resolveSupplierPieceRate } = await import("./piece-rate-resolution.service");

const asOf = new Date("2026-09-18");
const params = { companyId: "co-1", productId: "prod-1", productionOperationId: "op-1", employeeId: "emp-1", asOfDate: asOf };

function card(overrides: Record<string, unknown> = {}) {
  return { id: "card-1", rate: 5, effectiveFrom: new Date("2026-01-01"), effectiveTo: null, productId: null, ...overrides };
}

beforeEach(() => {
  vi.mocked(prisma.employee.findUnique).mockReset().mockResolvedValue(null as never);
  vi.mocked(PieceRateCardRepository.findActiveForResolution).mockReset().mockResolvedValue([]);
});

describe("resolvePieceRate — priority order", () => {
  it("prefers worker-specific over every other tier", async () => {
    vi.mocked(prisma.employee.findUnique).mockResolvedValue({ employeeCategoryId: "cat-1", pieceRatePerUnit: "9" } as never);
    // First call is the worker-specific lookup — return a match there.
    vi.mocked(PieceRateCardRepository.findActiveForResolution).mockResolvedValueOnce([card({ rate: 2.5 })] as never);

    const result = await resolvePieceRate(params);
    expect(result).toEqual({ resolved: true, rate: 2.5, source: "WORKER_SPECIFIC", rateCardId: "card-1" });
  });

  it("falls through to worker grade when no worker-specific row matches", async () => {
    vi.mocked(prisma.employee.findUnique).mockResolvedValue({ employeeCategoryId: "cat-1", pieceRatePerUnit: null } as never);
    vi.mocked(PieceRateCardRepository.findActiveForResolution)
      .mockResolvedValueOnce([]) // worker-specific: none
      .mockResolvedValueOnce([card({ rate: 3 })] as never); // worker grade: match

    const result = await resolvePieceRate(params);
    expect(result).toEqual({ resolved: true, rate: 3, source: "WORKER_GRADE", rateCardId: "card-1" });
  });

  it("falls through to Style+Operation default when no worker/grade row matches", async () => {
    vi.mocked(prisma.employee.findUnique).mockResolvedValue({ employeeCategoryId: null, pieceRatePerUnit: null } as never);
    vi.mocked(PieceRateCardRepository.findActiveForResolution)
      .mockResolvedValueOnce([]) // worker-specific
      .mockResolvedValueOnce([card({ rate: 4 })] as never); // style+operation default (no grade tier queried since employeeCategoryId is null)

    const result = await resolvePieceRate(params);
    expect(result).toEqual({ resolved: true, rate: 4, source: "STYLE_OPERATION_DEFAULT", rateCardId: "card-1" });
  });

  it("falls through to Operation-level fallback when no style-scoped row matches", async () => {
    vi.mocked(prisma.employee.findUnique).mockResolvedValue({ employeeCategoryId: null, pieceRatePerUnit: null } as never);
    vi.mocked(PieceRateCardRepository.findActiveForResolution)
      .mockResolvedValueOnce([]) // worker-specific
      .mockResolvedValueOnce([]) // style+operation default
      .mockResolvedValueOnce([card({ rate: 1.5 })] as never); // operation default

    const result = await resolvePieceRate(params);
    expect(result).toEqual({ resolved: true, rate: 1.5, source: "OPERATION_DEFAULT", rateCardId: "card-1" });
  });

  it("falls through to the legacy Employee.pieceRatePerUnit field when no rate card matches at all", async () => {
    vi.mocked(prisma.employee.findUnique).mockResolvedValue({ employeeCategoryId: null, pieceRatePerUnit: "6.25" } as never);
    vi.mocked(PieceRateCardRepository.findActiveForResolution).mockResolvedValue([]);

    const result = await resolvePieceRate(params);
    expect(result).toEqual({ resolved: true, rate: 6.25, source: "EMPLOYEE_LEGACY", rateCardId: null });
  });

  it("returns resolved:false — never a silent 0 — when nothing resolves anywhere", async () => {
    vi.mocked(prisma.employee.findUnique).mockResolvedValue({ employeeCategoryId: null, pieceRatePerUnit: null } as never);
    vi.mocked(PieceRateCardRepository.findActiveForResolution).mockResolvedValue([]);

    const result = await resolvePieceRate(params);
    expect(result).toEqual({ resolved: false });
  });

  it("prefers a style-scoped worker-specific row over a style-agnostic one for the same worker", async () => {
    vi.mocked(prisma.employee.findUnique).mockResolvedValue({ employeeCategoryId: null, pieceRatePerUnit: null } as never);
    vi.mocked(PieceRateCardRepository.findActiveForResolution).mockResolvedValueOnce([
      card({ id: "generic", rate: 2, productId: null }),
      card({ id: "specific", rate: 3, productId: "prod-1" }),
    ] as never);

    const result = await resolvePieceRate(params);
    expect(result).toMatchObject({ resolved: true, rate: 3, rateCardId: "specific" });
  });
});

describe("resolveSupplierPieceRate", () => {
  const supplierParams = { companyId: "co-1", productId: "prod-1", productionOperationId: "op-1", supplierId: "sup-1", asOfDate: asOf };

  it("prefers a supplier-specific rate over the operation default", async () => {
    vi.mocked(PieceRateCardRepository.findActiveForResolution).mockResolvedValueOnce([card({ rate: 6, id: "sup-card" })] as never);

    const result = await resolveSupplierPieceRate(supplierParams);
    expect(result).toEqual({ resolved: true, rate: 6, source: "SUPPLIER_SPECIFIC", rateCardId: "sup-card" });
  });

  it("falls through to the operation default when no supplier-specific row matches", async () => {
    vi.mocked(PieceRateCardRepository.findActiveForResolution)
      .mockResolvedValueOnce([]) // supplier-specific
      .mockResolvedValueOnce([card({ rate: 4, id: "op-card" })] as never); // operation default

    const result = await resolveSupplierPieceRate(supplierParams);
    expect(result).toEqual({ resolved: true, rate: 4, source: "OPERATION_DEFAULT", rateCardId: "op-card" });
  });

  it("returns resolved:false when neither tier matches", async () => {
    vi.mocked(PieceRateCardRepository.findActiveForResolution).mockResolvedValue([]);
    const result = await resolveSupplierPieceRate(supplierParams);
    expect(result).toEqual({ resolved: false });
  });
});

describe("effective-date windowing", () => {
  it("ignores a card whose effective window has not yet started or has already ended", async () => {
    vi.mocked(prisma.employee.findUnique).mockResolvedValue({ employeeCategoryId: null, pieceRatePerUnit: null } as never);
    vi.mocked(PieceRateCardRepository.findActiveForResolution)
      .mockResolvedValueOnce([card({ effectiveFrom: new Date("2027-01-01") })] as never) // worker-specific: not yet active
      .mockResolvedValueOnce([]) // style default
      .mockResolvedValueOnce([card({ effectiveFrom: new Date("2020-01-01"), effectiveTo: new Date("2021-01-01") })] as never); // operation default: expired

    const result = await resolvePieceRate(params);
    expect(result).toEqual({ resolved: false });
  });
});
