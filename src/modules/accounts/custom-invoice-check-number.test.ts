import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { COMMON_FASHION_SERVICES } from "@/app/(dashboard)/accounts/custom-invoices/new/CustomInvoiceForm";

vi.mock("@/lib/api-route", () => ({
  requireSession: vi.fn(),
  handleApiError: vi.fn((err) => new Response(JSON.stringify({ error: { message: err?.message || "Error" } }), { status: 400 })),
}));

vi.mock("@/core/rbac/PermissionService", () => ({
  PermissionService: { assert: vi.fn() },
}));

vi.mock("./custom-invoice.repository", () => ({
  CustomInvoiceRepository: {
    findByInvoiceNumber: vi.fn(),
  },
}));

const { requireSession } = await import("@/lib/api-route");
const { CustomInvoiceRepository } = await import("./custom-invoice.repository");
const { GET } = await import("@/app/api/v1/custom-invoices/check-number/route");

describe("GET /api/v1/custom-invoices/check-number (P2-1)", () => {
  beforeEach(() => {
    vi.mocked(requireSession).mockReset().mockResolvedValue({
      user: { id: "user-1", companyId: "co-1" },
    } as never);
    vi.mocked(CustomInvoiceRepository.findByInvoiceNumber).mockReset();
  });

  it("returns available: false when number parameter is missing", async () => {
    const req = new NextRequest("http://localhost:3000/api/v1/custom-invoices/check-number");
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.available).toBe(false);
    expect(body.data.message).toContain("required");
  });

  it("returns available: false when invoice number already exists in company", async () => {
    vi.mocked(CustomInvoiceRepository.findByInvoiceNumber).mockResolvedValue({
      id: "inv-existing",
      invoiceNumber: "INV-2026-001",
    } as never);

    const req = new NextRequest("http://localhost:3000/api/v1/custom-invoices/check-number?number=INV-2026-001");
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.available).toBe(false);
    expect(body.data.message).toContain("already in use");
    expect(CustomInvoiceRepository.findByInvoiceNumber).toHaveBeenCalledWith("co-1", "INV-2026-001", undefined);
  });

  it("returns available: true when invoice number is unused", async () => {
    vi.mocked(CustomInvoiceRepository.findByInvoiceNumber).mockResolvedValue(null);

    const req = new NextRequest("http://localhost:3000/api/v1/custom-invoices/check-number?number=INV-2026-002");
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.available).toBe(true);
    expect(body.data.message).toContain("is available");
  });

  it("passes excludeId when editing an existing invoice", async () => {
    vi.mocked(CustomInvoiceRepository.findByInvoiceNumber).mockResolvedValue(null);

    const req = new NextRequest(
      "http://localhost:3000/api/v1/custom-invoices/check-number?number=INV-2026-001&excludeId=inv-current"
    );
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.available).toBe(true);
    expect(CustomInvoiceRepository.findByInvoiceNumber).toHaveBeenCalledWith("co-1", "INV-2026-001", "inv-current");
  });
});

describe("COMMON_FASHION_SERVICES Presets (P2-3)", () => {
  it("provides valid presets for garment and fashion services", () => {
    expect(COMMON_FASHION_SERVICES.length).toBeGreaterThan(0);
    for (const service of COMMON_FASHION_SERVICES) {
      expect(service.id).toMatch(/^srv-/);
      expect(service.name.length).toBeGreaterThan(0);
      expect(service.sacCode).toMatch(/^99/); // Standard SAC Chapter 99
      expect(["5", "12", "18", "28"]).toContain(service.defaultGst);
    }
  });

  it("includes essential fashion industry services: stitching, embroidery, printing, sampling", () => {
    const serviceIds = COMMON_FASHION_SERVICES.map((s) => s.id);
    expect(serviceIds).toContain("srv-stitching");
    expect(serviceIds).toContain("srv-embroidery");
    expect(serviceIds).toContain("srv-printing");
    expect(serviceIds).toContain("srv-pattern");
    expect(serviceIds).toContain("srv-freight");
  });
});
