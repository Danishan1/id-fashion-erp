import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";

const m = vi.hoisted(() => ({
  requireSession: vi.fn(),
  assert: vi.fn(),
  getDispatchById: vi.fn(),
  getCompanyHeaderLines: vi.fn(),
  renderBusinessDocumentPdf: vi.fn(),
}));

vi.mock("@/lib/api-route", async () => {
  const { toErrorResponse } = await import("@/core/errors/BusinessRuleError");
  return {
    requireSession: m.requireSession,
    handleApiError: (error: unknown) => {
      const { status, body } = toErrorResponse(error);
      return Response.json(body, { status });
    },
  };
});

vi.mock("@/core/rbac/PermissionService", () => ({
  PermissionService: { assert: m.assert },
}));

vi.mock("@/modules/dispatch/dispatch.service", () => ({
  getDispatchById: m.getDispatchById,
}));

vi.mock("@/core/documents/company-header", () => ({
  getCompanyHeaderLines: m.getCompanyHeaderLines,
  formatDocDate: (d: string | Date) => String(d).slice(0, 10),
}));

vi.mock("@/core/documents/document-pdf", () => ({
  renderBusinessDocumentPdf: m.renderBusinessDocumentPdf,
  businessDocumentPdfHeaders: (fileName: string) => ({
    "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename="${fileName}"`,
  }),
}));

const route = await import("./route");
const ctx = <P,>(params: P) => ({ params: Promise.resolve(params) });

const sampleDispatch = {
  id: "disp-1",
  dispatchNumber: "DSP-2026-0001",
  status: "PACKED",
  dispatchDate: "2026-10-15T10:00:00.000Z",
  deliveryAddress: "123 Fashion Ave, Mumbai, India",
  vehicleNumber: "MH-01-AB-1234",
  lrNumber: "LR-9876",
  awbNumber: null,
  trackingNumber: "TRK-5555",
  driverDetails: "Ramesh Kumar (9876543210)",
  transporterName: "SafeExpress",
  forwarder: { code: "TRN-001", name: "SafeExpress Logistics", contactPerson: "Suresh", phone: "9876500000" },
  customer: { id: "cust-1", name: "Zara Retail" },
  salesOrder: { id: "so-1", orderNumber: "ORD-2026-0001" },
  warehouse: { id: "wh-1", code: "WH-MUM", name: "Mumbai Central Warehouse" },
  items: [
    {
      id: "di-1",
      productId: "prod-1",
      dispatchedQuantity: 30,
      regularDispatchQuantity: 25,
      extraDispatchQuantity: 5,
      product: { styleName: "Slim Denim Jeans", styleCode: "STY-DNM-01" },
    },
  ],
  cartons: [
    {
      id: "carton-1",
      cartonNumber: 1,
      totalQuantity: 30,
      items: [
        {
          id: "ci-1",
          dispatchItem: { id: "di-1", productId: "prod-1" },
          productVariantId: "var-1",
          quantity: 30,
          productVariant: { color: { name: "Dark Blue" }, size: { name: "32" } },
        },
      ],
    },
  ],
};

beforeEach(() => {
  m.requireSession.mockReset().mockResolvedValue({
    user: { id: "user-1", name: "Dispatcher Joe", companyId: "co-1" },
  });
  m.assert.mockReset().mockResolvedValue(undefined);
  m.getDispatchById.mockReset().mockResolvedValue(sampleDispatch);
  m.getCompanyHeaderLines.mockReset().mockResolvedValue({
    companyName: "Acme Apparels Pvt Ltd",
    companyDetailLines: ["GSTIN: 27AAAAA0000A1Z5", "Mumbai, Maharashtra"],
  });
  m.renderBusinessDocumentPdf.mockReset().mockResolvedValue(Buffer.from("%PDF-1.4 Mock"));
});

describe("Dispatch PDF Route (GET /api/v1/dispatches/[id]/pdf)", () => {
  it("generates a Delivery Challan PDF by default with correct metadata and headers", async () => {
    const req = new NextRequest("http://localhost/api/v1/dispatches/disp-1/pdf");
    const res = await route.GET(req, ctx({ id: "disp-1" }));

    expect(m.assert).toHaveBeenCalledWith("user-1", "dispatch", "export");
    expect(m.getDispatchById).toHaveBeenCalledWith({ companyId: "co-1", userId: "user-1" }, "disp-1");
    expect(m.renderBusinessDocumentPdf).toHaveBeenCalledWith(
      expect.objectContaining({
        docTitle: "Delivery Challan",
        docNumber: "DSP-2026-0001",
        partyName: "Zara Retail",
        partyDetailLines: expect.arrayContaining([
          "Delivery Address: 123 Fashion Ave, Mumbai, India",
          "Sales Order: ORD-2026-0001",
          "Transporter: SafeExpress Logistics (TRN-001)",
          "Driver: Ramesh Kumar (9876543210)",
        ]),
        rows: [
          {
            style: "Slim Denim Jeans (STY-DNM-01)",
            regularQty: "25",
            extraQty: "5",
            totalQty: "30",
          },
        ],
        totalsLines: [
          { label: "Total Cartons", value: "1" },
          { label: "Total Pieces", value: "30", final: true },
        ],
      })
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Content-Disposition")).toContain("DSP-2026-0001-delivery-challan.pdf");
  });

  it("generates a Packing List PDF when ?type=packing-list is requested", async () => {
    const req = new NextRequest("http://localhost/api/v1/dispatches/disp-1/pdf?type=packing-list");
    const res = await route.GET(req, ctx({ id: "disp-1" }));

    expect(m.renderBusinessDocumentPdf).toHaveBeenCalledWith(
      expect.objectContaining({
        docTitle: "Packing List",
        docNumber: "DSP-2026-0001",
        partyName: "Zara Retail",
        columns: [
          { key: "carton", label: "Carton #" },
          { key: "style", label: "Style" },
          { key: "color", label: "Color" },
          { key: "size", label: "Size" },
          { key: "qty", label: "Qty", align: "right" },
        ],
        rows: [
          {
            carton: "Carton #1",
            style: "Slim Denim Jeans (STY-DNM-01)",
            color: "Dark Blue",
            size: "32",
            qty: "30",
          },
        ],
        totalsLines: [
          { label: "Total Cartons", value: "1" },
          { label: "Total Pieces", value: "30", final: true },
        ],
      })
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toContain("DSP-2026-0001-packing-list.pdf");
  });

  it("blocks export when user lacks dispatch export permission", async () => {
    m.assert.mockRejectedValue(new BusinessRuleError("PERMISSION_DENIED", "Permission denied."));
    const req = new NextRequest("http://localhost/api/v1/dispatches/disp-1/pdf");
    const res = await route.GET(req, ctx({ id: "disp-1" }));

    expect(res.status).toBe(403);
    expect(m.getDispatchById).not.toHaveBeenCalled();
    expect(m.renderBusinessDocumentPdf).not.toHaveBeenCalled();
  });

  it("returns 404 when the dispatch is not found", async () => {
    m.getDispatchById.mockRejectedValue(new BusinessRuleError("NOT_FOUND", "Dispatch not found."));
    const req = new NextRequest("http://localhost/api/v1/dispatches/nonexistent/pdf");
    const res = await route.GET(req, ctx({ id: "nonexistent" }));

    expect(res.status).toBe(404);
  });
});
