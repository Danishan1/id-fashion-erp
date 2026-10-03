import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const m = vi.hoisted(() => ({
  requireSession: vi.fn(),
  assert: vi.fn(),
  listCompanies: vi.fn(),
  createCompany: vi.fn(),
  searchCrmCompanies: vi.fn(),
  canLinkCustomers: vi.fn(),
  searchCustomersForLinking: vi.fn(),
  linkErpCustomer: vi.fn(),
  unlinkErpCustomer: vi.fn(),
  mergeCompanies: vi.fn(),
  getCompanyMergePreview: vi.fn(),
  listCompanyContacts: vi.fn(),
  addContactToCompany: vi.fn(),
  getCompanyErpReferences: vi.fn(),
  deleteCrmDocument: vi.fn(),
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
vi.mock("@/core/rbac/PermissionService", () => ({ PermissionService: { assert: m.assert } }));
vi.mock("@/modules/crm/companies/crm-companies.service", () => ({
  listCompanies: m.listCompanies,
  createCompany: m.createCompany,
  searchCrmCompanies: m.searchCrmCompanies,
  canLinkCustomers: m.canLinkCustomers,
  searchCustomersForLinking: m.searchCustomersForLinking,
  linkErpCustomer: m.linkErpCustomer,
  unlinkErpCustomer: m.unlinkErpCustomer,
}));
vi.mock("@/modules/crm/companies/company-merge.service", () => ({ mergeCompanies: m.mergeCompanies, getCompanyMergePreview: m.getCompanyMergePreview }));
vi.mock("@/modules/crm/companies/company-relations.service", async () => {
  const { z } = await import("zod");
  return {
    // Same contract as the real schema (pageSize ≤ 50).
    relatedPageSchema: z.object({
      page: z.coerce.number().int().min(1).max(10_000).default(1),
      pageSize: z.coerce.number().int().min(1).max(50).default(10),
      includeArchived: z.enum(["true", "false"]).optional().transform((v) => v === "true"),
    }),
    listCompanyContacts: m.listCompanyContacts,
    addContactToCompany: m.addContactToCompany,
    getCompanyErpReferences: m.getCompanyErpReferences,
  };
});
vi.mock("@/modules/crm/documents/crm-documents.service", () => ({ deleteCrmDocument: m.deleteCrmDocument, downloadCrmDocument: vi.fn() }));

const list = await import("./route");
const lookup = await import("./lookup/route");
const customers = await import("./customers/route");
const erpCustomer = await import("./[id]/erp-customer/route");
const mergeRoute = await import("./merge/route");
const preview = await import("./merge/preview/route");
const contactsRoute = await import("./[id]/contacts/route");
const docs = await import("../documents/[attachmentId]/route");

const ID = "6f1c2f1e-1f2a-4b1a-9d1a-2b3c4d5e6f70";
const ID2 = "7f1c2f1e-1f2a-4b1a-9d1a-2b3c4d5e6f71";
const ACTOR = { companyId: "co-1", userId: "user-1", branchId: null };
const ctx = <P,>(params: P) => ({ params: Promise.resolve(params) });

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset();
  m.requireSession.mockResolvedValue({ user: { id: "user-1", companyId: "co-1", defaultBranchId: null } });
  m.assert.mockResolvedValue(undefined);
  m.listCompanies.mockResolvedValue({ data: [{ id: "c-1" }], totalCount: 1 });
  m.createCompany.mockResolvedValue({ id: "c-2" });
  m.searchCrmCompanies.mockResolvedValue([]);
  m.canLinkCustomers.mockResolvedValue(true);
  m.searchCustomersForLinking.mockResolvedValue([]);
  m.listCompanyContacts.mockResolvedValue({ data: [], meta: { page: 1, pageSize: 10, totalCount: 0, totalPages: 1 } });
});

describe("CRM company routes", () => {
  it("GET /companies needs crm.view and parses filters, sort and paging", async () => {
    const res = await list.GET(new NextRequest(`http://x/api/v1/crm/companies?page=2&pageSize=10&sortBy=name&sortOrder=asc&erpCustomer=linked&statusIds=${ID}`), ctx({}));
    expect(m.assert).toHaveBeenCalledWith("user-1", "crm", "view");
    expect(m.listCompanies).toHaveBeenCalledWith(ACTOR, expect.objectContaining({ erpCustomer: "linked", statusIds: [ID], archived: "exclude" }), { sortBy: "name", sortOrder: "asc" }, expect.objectContaining({ skip: 10, take: 10 }));
    expect((await res.json()).meta).toMatchObject({ page: 2, totalCount: 1 });
  });

  it("rejects an unknown sort field or filter value with 400", async () => {
    expect((await list.GET(new NextRequest("http://x/api/v1/crm/companies?sortBy=creditLimit"), ctx({}))).status).toBe(400);
    expect((await list.GET(new NextRequest("http://x/api/v1/crm/companies?erpCustomer=maybe"), ctx({}))).status).toBe(400);
    expect(m.listCompanies).not.toHaveBeenCalled();
  });

  it("POST /companies needs crm.create, returns 201, and passes duplicate warnings through as 409", async () => {
    const res = await list.POST(new NextRequest("http://x", { method: "POST", body: JSON.stringify({ name: "ABC" }) }), ctx({}));
    expect(m.assert).toHaveBeenCalledWith("user-1", "crm", "create");
    expect(res.status).toBe(201);
    const { BusinessRuleError } = await import("@/core/errors/BusinessRuleError");
    m.createCompany.mockRejectedValueOnce(new BusinessRuleError("CRM_POSSIBLE_DUPLICATE", "Possible duplicate company found.", { entityType: "COMPANY", matches: [] }));
    const dup = await list.POST(new NextRequest("http://x", { method: "POST", body: JSON.stringify({ name: "ABC" }) }), ctx({}));
    expect(dup.status).toBe(409);
  });

  it("caps the lookup limit at 200", async () => {
    await lookup.GET(new NextRequest("http://x/api/v1/crm/companies/lookup?limit=5000&search=ab"), ctx({}));
    expect(m.searchCrmCompanies).toHaveBeenCalledWith(ACTOR, "ab", 200);
  });

  it("only lists ERP customers to users who can view customers (403 otherwise), capped at 50", async () => {
    await customers.GET(new NextRequest("http://x/api/v1/crm/companies/customers?limit=999"), ctx({}));
    expect(m.searchCustomersForLinking).toHaveBeenCalledWith(ACTOR, undefined, 50);
    m.canLinkCustomers.mockResolvedValue(false);
    const res = await customers.GET(new NextRequest("http://x/api/v1/crm/companies/customers"), ctx({}));
    expect(res.status).toBe(403);
  });

  it("ERP customer link/unlink, merge and contact changes need crm.edit", async () => {
    await erpCustomer.POST(new NextRequest("http://x", { method: "POST", body: JSON.stringify({ customerId: ID2 }) }), ctx({ id: ID }));
    expect(m.assert).toHaveBeenLastCalledWith("user-1", "crm", "edit");
    expect(m.linkErpCustomer).toHaveBeenCalledWith(ACTOR, ID, { customerId: ID2 });
    await erpCustomer.DELETE(new NextRequest("http://x", { method: "DELETE" }), ctx({ id: ID }));
    expect(m.unlinkErpCustomer).toHaveBeenCalledWith(ACTOR, ID);
    await mergeRoute.POST(new NextRequest("http://x", { method: "POST", body: "{}" }), ctx({}));
    expect(m.assert).toHaveBeenLastCalledWith("user-1", "crm", "edit");
    await contactsRoute.POST(new NextRequest("http://x", { method: "POST", body: JSON.stringify({ contactId: ID2 }) }), ctx({ id: ID }));
    expect(m.assert).toHaveBeenLastCalledWith("user-1", "crm", "edit");
  });

  it("validates the merge preview query", async () => {
    expect((await preview.GET(new NextRequest("http://x/api/v1/crm/companies/merge/preview?survivorId=x"), ctx({}))).status).toBe(400);
    await preview.GET(new NextRequest(`http://x/api/v1/crm/companies/merge/preview?survivorId=${ID}&mergedId=${ID2}`), ctx({}));
    expect(m.getCompanyMergePreview).toHaveBeenCalledWith(ACTOR, ID, ID2);
  });

  it("pages related contacts with a bounded page size", async () => {
    await contactsRoute.GET(new NextRequest("http://x/api/v1/crm/companies/x/contacts?page=3&pageSize=5"), ctx({ id: ID }));
    expect(m.listCompanyContacts).toHaveBeenCalledWith(ACTOR, ID, expect.objectContaining({ page: 3, pageSize: 5 }));
    expect((await contactsRoute.GET(new NextRequest("http://x/api/v1/crm/companies/x/contacts?pageSize=500"), ctx({ id: ID }))).status).toBe(400);
  });

  it("deletes CRM documents through the shared document route (crm.edit)", async () => {
    const res = await docs.DELETE(new NextRequest("http://x", { method: "DELETE" }), ctx({ attachmentId: ID }));
    expect(m.assert).toHaveBeenLastCalledWith("user-1", "crm", "edit");
    expect(m.deleteCrmDocument).toHaveBeenCalledWith(ACTOR, ID);
    expect(res.status).toBe(200);
  });
});
