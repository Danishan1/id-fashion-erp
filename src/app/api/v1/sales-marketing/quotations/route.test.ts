import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const m = vi.hoisted(() => ({ requireSession: vi.fn(), assert: vi.fn(), list: vi.fn(), create: vi.fn(), update: vi.fn(), cancel: vi.fn(), approve: vi.fn(), prefill: vi.fn(), plan: vi.fn(), convert: vi.fn(), linkCustomer: vi.fn() }));

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
vi.mock("@/core/rbac/PermissionService", () => ({ PermissionService: { assert: m.assert } }));
vi.mock("@/modules/sales-marketing/quotations/quotation.service", () => ({
  listQuotations: m.list,
  createQuotation: m.create,
  updateQuotationDraft: m.update,
  getQuotationPrefillFromEnquiry: m.prefill,
}));
vi.mock("@/modules/sales-marketing/quotations/quotation-lifecycle.service", () => ({
  cancelQuotation: m.cancel,
  approveQuotation: m.approve,
  submitForApproval: vi.fn(),
  returnToDraft: vi.fn(),
  declineApproval: vi.fn(),
  issueQuotation: vi.fn(),
  markQuotationSent: vi.fn(),
  recordAcceptance: vi.fn(),
  recordRejection: vi.fn(),
  reviseQuotation: vi.fn(),
}));

vi.mock("@/modules/sales-marketing/quotations/quotation-conversion.service", () => ({
  getConversionPlan: m.plan,
  convertQuotationToSalesOrder: m.convert,
  linkQuotationCustomer: m.linkCustomer,
}));

const list = await import("./route");
const convert = await import("./[id]/convert/route");
const one = await import("./[id]/route");
const actions = await import("./[id]/actions/[action]/route");
const prefill = await import("./prefill/route");
const ctx = <P,>(params: P) => ({ params: Promise.resolve(params) });
const req = (url: string, init?: RequestInit) => new NextRequest(new URL(url, "http://localhost"), init as never);

beforeEach(() => {
  vi.clearAllMocks();
  m.requireSession.mockResolvedValue({ user: { id: "u1", companyId: "c1", defaultBranchId: null } });
  m.assert.mockResolvedValue(undefined);
  m.list.mockResolvedValue({ data: [], totalCount: 0 });
  m.create.mockResolvedValue({ id: "q1" });
  m.update.mockResolvedValue({ id: "q1" });
  m.cancel.mockResolvedValue({ id: "q1" });
  m.prefill.mockResolvedValue({ buyerEnquiryId: "e1" });
});

describe("Quotation API routes use the sales_quotations permission module", () => {
  it("GET list → view; passes filters", async () => {
    const res = await list.GET(req("/x?view=closed&status=DRAFT&owner=me&junk=1"), ctx({}));
    expect(res.status).toBe(200);
    expect(m.assert).toHaveBeenCalledWith("u1", "sales_quotations", "view");
    expect(m.list.mock.calls[0][1]).toEqual({ view: "closed", status: "DRAFT", owner: "me" });
  });

  it("POST → create, PUT → edit, cancel → cancel", async () => {
    await list.POST(req("/x", { method: "POST", body: "{}" }), ctx({}));
    expect(m.assert).toHaveBeenLastCalledWith("u1", "sales_quotations", "create");
    await one.PUT(req("/x", { method: "PUT", body: "{}" }), ctx({ id: "q1" }));
    expect(m.assert).toHaveBeenLastCalledWith("u1", "sales_quotations", "edit");
    await actions.POST(req("/x", { method: "POST", body: JSON.stringify({ reason: "dup" }) }), ctx({ id: "q1", action: "cancel" }));
    expect(m.assert).toHaveBeenLastCalledWith("u1", "sales_quotations", "cancel");
    expect(m.cancel).toHaveBeenCalledWith(expect.anything(), "q1", { reason: "dup" });
    await actions.POST(req("/x", { method: "POST", body: "{}" }), ctx({ id: "q1", action: "approve" }));
    expect(m.assert).toHaveBeenLastCalledWith("u1", "sales_quotations", "approve");
  });

  it("denied users never reach the service", async () => {
    const { BusinessRuleError } = await import("@/core/errors/BusinessRuleError");
    m.assert.mockRejectedValue(new BusinessRuleError("PERMISSION_DENIED", "No."));
    expect((await one.PUT(req("/x", { method: "PUT", body: "{}" }), ctx({ id: "q1" }))).status).toBe(403);
    expect(m.update).not.toHaveBeenCalled();
  });

  it("unknown actions are 404 and never reach a service", async () => {
    const res = await actions.POST(req("/x", { method: "POST", body: "{}" }), ctx({ id: "q1", action: "delete-everything" }));
    expect(res.status).toBe(404);
    expect(m.cancel).not.toHaveBeenCalled();
  });

  it("prefill needs a valid enquiry id", async () => {
    expect((await prefill.GET(req("/x?enquiryId=nope"), ctx({}))).status).toBe(400);
    const ok = await prefill.GET(req("/x?enquiryId=00000000-0000-4000-8000-000000000001"), ctx({}));
    expect(ok.status).toBe(200);
    expect(m.assert).toHaveBeenCalledWith("u1", "sales_quotations", "create");
  });

  it("convert: GET plan → view; POST → edit (the service also asserts sales_orders.create); 201 new, 200 when it already existed", async () => {
    m.plan.mockResolvedValue({ lines: [] });
    expect((await convert.GET(req("/x"), ctx({ id: "q1" }))).status).toBe(200);
    expect(m.assert).toHaveBeenLastCalledWith("u1", "sales_quotations", "view");
    m.convert.mockResolvedValue({ salesOrderId: "so1", orderNumber: "ORD-1", alreadyConverted: false });
    const created = await convert.POST(req("/x", { method: "POST", body: JSON.stringify({ items: [] }) }), ctx({ id: "q1" }));
    expect(created.status).toBe(201);
    expect(m.assert).toHaveBeenLastCalledWith("u1", "sales_quotations", "edit");
    expect(m.convert).toHaveBeenCalledWith(expect.objectContaining({ companyId: "c1", userId: "u1" }), "q1", { items: [] });
    m.convert.mockResolvedValue({ salesOrderId: "so1", orderNumber: "ORD-1", alreadyConverted: true });
    const again = await convert.POST(req("/x", { method: "POST" }), ctx({ id: "q1" }));
    expect(again.status).toBe(200);
    expect(m.convert).toHaveBeenLastCalledWith(expect.anything(), "q1", {});
  });

  it("link-customer action → edit", async () => {
    await actions.POST(req("/x", { method: "POST", body: JSON.stringify({ customerId: "c9" }) }), ctx({ id: "q1", action: "link-customer" }));
    expect(m.assert).toHaveBeenLastCalledWith("u1", "sales_quotations", "edit");
    expect(m.linkCustomer).toHaveBeenCalledWith(expect.anything(), "q1", { customerId: "c9" });
  });
});
