import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const m = vi.hoisted(() => ({
  requireSession: vi.fn(),
  assert: vi.fn(),
  listContacts: vi.fn(),
  createContact: vi.fn(),
  mergeContacts: vi.fn(),
  setContactability: vi.fn(),
  deleteContactDocument: vi.fn(),
  getContactDuplicateRules: vi.fn(),
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
vi.mock("@/modules/crm/contacts/crm-contacts.service", () => ({ listContacts: m.listContacts, createContact: m.createContact, setContactability: m.setContactability }));
vi.mock("@/modules/crm/contacts/contact-merge.service", () => ({ mergeContacts: m.mergeContacts }));
vi.mock("@/modules/crm/contacts/contact-related.service", () => ({ deleteContactDocument: m.deleteContactDocument }));
vi.mock("@/modules/crm/settings/crm-settings.service", () => ({ getContactDuplicateRules: m.getContactDuplicateRules, updateContactDuplicateRules: vi.fn() }));

const list = await import("./route");
const mergeRoute = await import("./merge/route");
const consent = await import("./[id]/contactability/route");
const docs = await import("../contact-documents/[attachmentId]/route");
const rules = await import("../settings/contact-duplicate-rules/route");

const ID = "6f1c2f1e-1f2a-4b1a-9d1a-2b3c4d5e6f70";
const ctx = <P,>(params: P) => ({ params: Promise.resolve(params) });

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset();
  m.requireSession.mockResolvedValue({ user: { id: "user-1", companyId: "co-1", defaultBranchId: null } });
  m.assert.mockResolvedValue(undefined);
  m.listContacts.mockResolvedValue({ data: [{ id: "c-1" }], totalCount: 1 });
  m.createContact.mockResolvedValue({ id: "c-2" });
  m.mergeContacts.mockResolvedValue({ survivor: { id: ID } });
  m.setContactability.mockResolvedValue({ id: "x" });
  m.deleteContactDocument.mockResolvedValue(undefined);
  m.getContactDuplicateRules.mockResolvedValue([]);
});

describe("CRM contact routes", () => {
  it("GET /contacts needs crm.view and parses filters, sort and paging", async () => {
    const res = await list.GET(new NextRequest(`http://x/api/v1/crm/contacts?page=2&pageSize=10&sortBy=lastActivityAt&sortOrder=asc&dndChannels=ALL&ownerUserIds=${ID}`), ctx({}));
    expect(m.assert).toHaveBeenCalledWith("user-1", "crm", "view");
    expect(m.listContacts).toHaveBeenCalledWith(
      { companyId: "co-1", userId: "user-1", branchId: null },
      expect.objectContaining({ dndChannels: ["ALL"], ownerUserIds: [ID], archived: "exclude" }),
      { sortBy: "lastActivityAt", sortOrder: "asc" },
      expect.objectContaining({ skip: 10, take: 10 })
    );
    expect((await res.json()).meta).toMatchObject({ page: 2, totalCount: 1 });
  });

  it("rejects an unknown sort field with 400", async () => {
    const res = await list.GET(new NextRequest("http://x/api/v1/crm/contacts?sortBy=password"), ctx({}));
    expect(res.status).toBe(400);
    expect(m.listContacts).not.toHaveBeenCalled();
  });

  it("POST /contacts needs crm.create and returns 201", async () => {
    const res = await list.POST(new NextRequest("http://x/api/v1/crm/contacts", { method: "POST", body: JSON.stringify({ firstName: "Asha" }) }), ctx({}));
    expect(m.assert).toHaveBeenCalledWith("user-1", "crm", "create");
    expect(res.status).toBe(201);
  });

  it("merge and contactability need crm.edit", async () => {
    await mergeRoute.POST(new NextRequest("http://x", { method: "POST", body: "{}" }), ctx({}));
    expect(m.assert).toHaveBeenLastCalledWith("user-1", "crm", "edit");
    await consent.PUT(new NextRequest("http://x", { method: "PUT", body: "{}" }), ctx({ id: ID }));
    expect(m.assert).toHaveBeenLastCalledWith("user-1", "crm", "edit");
    expect(m.setContactability).toHaveBeenCalledWith(expect.objectContaining({ companyId: "co-1" }), ID, {});
  });

  it("denied permission returns 403 without calling the service", async () => {
    const { BusinessRuleError } = await import("@/core/errors/BusinessRuleError");
    m.assert.mockRejectedValueOnce(new BusinessRuleError("PERMISSION_DENIED", "No."));
    const res = await docs.DELETE(new NextRequest("http://x", { method: "DELETE" }), ctx({ attachmentId: ID }));
    expect(res.status).toBe(403);
    expect(m.deleteContactDocument).not.toHaveBeenCalled();
  });

  it("contact duplicate rules are CRM settings", async () => {
    await rules.GET(new NextRequest("http://x"), ctx({}));
    expect(m.assert).toHaveBeenCalledWith("user-1", "crm_settings", "view");
  });
});
