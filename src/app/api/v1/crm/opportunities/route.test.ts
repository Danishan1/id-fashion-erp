import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const m = vi.hoisted(() => ({
  requireSession: vi.fn(),
  assert: vi.fn(),
  listOpportunities: vi.fn(),
  createOpportunity: vi.fn(),
  getOpportunity: vi.fn(),
  updateOpportunity: vi.fn(),
  changeOpportunityStage: vi.fn(),
  changeOpportunityStatus: vi.fn(),
  bulkOpportunityAction: vi.fn(),
  linkErpDocument: vi.fn(),
  listOpportunityErpDocuments: vi.fn(),
  searchLinkableErpDocuments: vi.fn(),
  unlinkErpDocument: vi.fn(),
  listPipelines: vi.fn(),
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
vi.mock("@/modules/crm/opportunities/crm-opportunities.service", () => ({
  listOpportunities: m.listOpportunities,
  createOpportunity: m.createOpportunity,
  getOpportunity: m.getOpportunity,
  updateOpportunity: m.updateOpportunity,
  changeOpportunityStage: m.changeOpportunityStage,
  changeOpportunityStatus: m.changeOpportunityStatus,
  bulkOpportunityAction: m.bulkOpportunityAction,
}));
vi.mock("@/modules/crm/opportunities/crm-opportunity-erp.service", () => ({
  linkErpDocument: m.linkErpDocument,
  listOpportunityErpDocuments: m.listOpportunityErpDocuments,
  searchLinkableErpDocuments: m.searchLinkableErpDocuments,
  unlinkErpDocument: m.unlinkErpDocument,
}));
vi.mock("@/modules/crm/pipelines/crm-pipelines.service", () => ({ listPipelines: m.listPipelines }));

const list = await import("./route");
const detail = await import("./[id]/route");
const stage = await import("./[id]/stage/route");
const status = await import("./[id]/status/route");
const bulk = await import("./bulk/route");
const erpDocs = await import("./[id]/erp-documents/route");
const erpSearch = await import("./[id]/erp-documents/search/route");
const erpUnlink = await import("./[id]/erp-documents/[linkId]/route");
const pipelines = await import("../pipelines/route");

const ID = "6f1c2f1e-1f2a-4b1a-9d1a-2b3c4d5e6f70";
const ID2 = "7f1c2f1e-1f2a-4b1a-9d1a-2b3c4d5e6f71";
const ACTOR = { companyId: "co-1", userId: "user-1", branchId: null };
const ctx = <P,>(params: P) => ({ params: Promise.resolve(params) });
const post = (body: unknown) => new NextRequest("http://x", { method: "POST", body: JSON.stringify(body) });

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset();
  m.requireSession.mockResolvedValue({ user: { id: "user-1", companyId: "co-1", defaultBranchId: null } });
  m.assert.mockResolvedValue(undefined);
  m.listOpportunities.mockResolvedValue({ data: [{ id: "o-1" }], totalCount: 1 });
  m.createOpportunity.mockResolvedValue({ id: "o-2" });
  m.listPipelines.mockResolvedValue([]);
});

describe("CRM opportunity routes", () => {
  it("GET /opportunities needs crm.view and parses filters, sort and paging", async () => {
    const res = await list.GET(new NextRequest(`http://x/api/v1/crm/opportunities?page=2&pageSize=10&sortBy=expectedCloseDate&sortOrder=asc&statuses=OPEN&stageIds=${ID}&amountMin=1000`), ctx({}));
    expect(m.assert).toHaveBeenCalledWith("user-1", "crm", "view");
    expect(m.listOpportunities).toHaveBeenCalledWith(ACTOR, expect.objectContaining({ statuses: ["OPEN"], stageIds: [ID], amount: { min: 1000 }, archived: "exclude" }), { sortBy: "expectedCloseDate", sortOrder: "asc" }, expect.objectContaining({ skip: 10, take: 10 }));
    expect((await res.json()).meta).toMatchObject({ page: 2, totalCount: 1 });
  });

  it("rejects unknown sort fields and invalid filters with 400", async () => {
    expect((await list.GET(new NextRequest("http://x/api/v1/crm/opportunities?sortBy=password"), ctx({}))).status).toBe(400);
    expect((await list.GET(new NextRequest("http://x/api/v1/crm/opportunities?probabilityMax=150"), ctx({}))).status).toBe(400);
    expect(m.listOpportunities).not.toHaveBeenCalled();
  });

  it("POST /opportunities needs crm.create, returns 201 and passes duplicate warnings through as 409", async () => {
    const res = await list.POST(post({ name: "Deal" }), ctx({}));
    expect(m.assert).toHaveBeenCalledWith("user-1", "crm", "create");
    expect(res.status).toBe(201);
    const { BusinessRuleError } = await import("@/core/errors/BusinessRuleError");
    m.createOpportunity.mockRejectedValueOnce(new BusinessRuleError("CRM_POSSIBLE_DUPLICATE", "Possible duplicate", { entityType: "OPPORTUNITY", matches: [] }));
    expect((await list.POST(post({ name: "Deal" }), ctx({}))).status).toBe(409);
  });

  it("detail needs crm.view; edit, stage, status, bulk and ERP linking need crm.edit", async () => {
    await detail.GET(new NextRequest("http://x"), ctx({ id: ID }));
    expect(m.assert).toHaveBeenLastCalledWith("user-1", "crm", "view");
    await detail.PATCH(new NextRequest("http://x", { method: "PATCH", body: JSON.stringify({ version: 1 }) }), ctx({ id: ID }));
    expect(m.assert).toHaveBeenLastCalledWith("user-1", "crm", "edit");
    await stage.POST(post({ stageId: ID2 }), ctx({ id: ID }));
    expect(m.changeOpportunityStage).toHaveBeenCalledWith(ACTOR, ID, { stageId: ID2 });
    expect(m.assert).toHaveBeenLastCalledWith("user-1", "crm", "edit");
    await status.POST(post({ status: "WON" }), ctx({ id: ID }));
    expect(m.changeOpportunityStatus).toHaveBeenCalledWith(ACTOR, ID, { status: "WON" });
    await bulk.POST(post({ action: "archive", ids: [ID] }), ctx({}));
    expect(m.assert).toHaveBeenLastCalledWith("user-1", "crm", "edit");
    const linked = await erpDocs.POST(post({ docType: "SALES_ORDER", docId: ID2 }), ctx({ id: ID }));
    expect(linked.status).toBe(201);
    expect(m.assert).toHaveBeenLastCalledWith("user-1", "crm", "edit");
    await erpUnlink.DELETE(new NextRequest("http://x", { method: "DELETE" }), ctx({ id: ID, linkId: ID2 }));
    expect(m.unlinkErpDocument).toHaveBeenCalledWith(ACTOR, ID, ID2);
  });

  it("returns 403 / 404 from the service unchanged", async () => {
    const { BusinessRuleError } = await import("@/core/errors/BusinessRuleError");
    m.linkErpDocument.mockRejectedValueOnce(new BusinessRuleError("PERMISSION_DENIED", "No access to sales orders"));
    expect((await erpDocs.POST(post({ docType: "SALES_ORDER", docId: ID2 }), ctx({ id: ID }))).status).toBe(403);
    m.getOpportunity.mockRejectedValueOnce(new BusinessRuleError("NOT_FOUND", "Opportunity not found."));
    expect((await detail.GET(new NextRequest("http://x"), ctx({ id: ID }))).status).toBe(404);
  });

  it("passes ERP document search params and lists pipelines read-only", async () => {
    await erpSearch.GET(new NextRequest(`http://x/api/v1/crm/opportunities/${ID}/erp-documents/search?docType=SALES_ORDER&search=SO-1`), ctx({ id: ID }));
    expect(m.searchLinkableErpDocuments).toHaveBeenCalledWith(ACTOR, ID, { docType: "SALES_ORDER", search: "SO-1" });
    await pipelines.GET(new NextRequest("http://x/api/v1/crm/pipelines"), ctx({}));
    expect(m.listPipelines).toHaveBeenCalledWith("co-1", { includeArchived: true });
    expect(m.assert).toHaveBeenLastCalledWith("user-1", "crm", "view");
  });
});
