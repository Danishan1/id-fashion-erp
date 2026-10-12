import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const m = vi.hoisted(() => ({
  requireSession: vi.fn(),
  assert: vi.fn(),
  svc: {} as Record<string, ReturnType<typeof vi.fn>>,
}));
for (const k of ["listTemplates", "createTemplate", "templateMeta", "previewDraft", "getTemplate", "updateTemplate", "duplicateTemplate", "changeTemplateStatus", "listTemplateVersions", "getTemplateVersion", "restoreTemplateVersion", "previewTemplate", "validateStoredTemplate", "sendTemplateTest"]) m.svc[k] = vi.fn();

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
vi.mock("@/core/rbac/PermissionService", () => ({ PermissionService: { assert: m.assert, can: vi.fn(async () => true) } }));
vi.mock("@/modules/crm/templates/crm-templates.service", () => m.svc);

const r = {
  list: await import("./route"),
  meta: await import("./meta/route"),
  preview: await import("./preview/route"),
  validate: await import("./validate/route"),
  one: await import("./[id]/route"),
  duplicate: await import("./[id]/duplicate/route"),
  activate: await import("./[id]/activate/route"),
  deactivate: await import("./[id]/deactivate/route"),
  archive: await import("./[id]/archive/route"),
  restore: await import("./[id]/restore/route"),
  versions: await import("./[id]/versions/route"),
  version: await import("./[id]/versions/[versionId]/route"),
  restoreVersion: await import("./[id]/versions/[versionId]/restore/route"),
  previewOne: await import("./[id]/preview/route"),
  validateOne: await import("./[id]/validate/route"),
  testSend: await import("./[id]/test-send/route"),
};
const ID = "6f1c2f1e-1f2a-4b1a-9d1a-2b3c4d5e6f70";
const VID = "7f1c2f1e-1f2a-4b1a-9d1a-2b3c4d5e6f71";
const ACTOR = { companyId: "co-1", userId: "user-1", branchId: null };
const ctx = <P,>(params: P) => ({ params: Promise.resolve(params) });
const post = (b: unknown) => new NextRequest("http://x", { method: "POST", body: JSON.stringify(b) });
const lastPerm = () => m.assert.mock.calls.at(-1)!.slice(1);

beforeEach(() => {
  m.requireSession.mockReset().mockResolvedValue({ user: { id: "user-1", companyId: "co-1", defaultBranchId: null } });
  m.assert.mockReset().mockResolvedValue(undefined);
  for (const fn of Object.values(m.svc)) fn.mockReset().mockResolvedValue({ ok: true, valid: true, errors: [], warnings: [], variables: [] });
  m.svc.listTemplates.mockResolvedValue({ data: [], totalCount: 0 });
});

describe("CRM template routes", () => {
  it("list needs crm.view and passes filters, search, sort and paging", async () => {
    const res = await r.list.GET(new NextRequest("http://x/api/v1/crm/templates?channels=EMAIL,SMS&statuses=ACTIVE&categoryIds=" + ID + "&search=quote&sortBy=name&sortOrder=asc&page=2&pageSize=10"), ctx({}));
    expect(res.status).toBe(200);
    expect(lastPerm()).toEqual(["crm", "view"]);
    const [actor, filter, sort, query] = m.svc.listTemplates.mock.calls[0];
    expect(actor).toEqual(ACTOR);
    expect(filter).toEqual({ channels: ["EMAIL", "SMS"], statuses: ["ACTIVE"], categoryIds: [ID], usable: false });
    expect(sort).toEqual({ sortBy: "name", sortOrder: "asc" });
    expect(query).toMatchObject({ search: "quote", skip: 10, take: 10 });
    expect((await r.list.GET(new NextRequest("http://x/api/v1/crm/templates?channels=FAX"), ctx({}))).status).toBe(400);
    expect((await r.list.GET(new NextRequest("http://x/api/v1/crm/templates?sortBy=body"), ctx({}))).status).toBe(400);
  });

  it("maps every action to the existing ERP permissions (no CRM-specific roles)", async () => {
    const p = { id: ID };
    const pv = { id: ID, versionId: VID };
    const cases: [() => Promise<Response>, [string, string]][] = [
      [() => r.meta.GET(new NextRequest("http://x"), ctx({})), ["crm", "view"]],
      [() => r.list.POST(post({ name: "x" }), ctx({})), ["crm", "create"]],
      [() => r.preview.POST(post({}), ctx({})), ["crm", "view"]],
      [() => r.validate.POST(post({}), ctx({})), ["crm", "view"]],
      [() => r.one.GET(new NextRequest("http://x"), ctx(p)), ["crm", "view"]],
      [() => r.one.PATCH(post({ version: 1 }), ctx(p)), ["crm", "edit"]],
      [() => r.one.PUT(post({ version: 1 }), ctx(p)), ["crm", "edit"]],
      [() => r.duplicate.POST(post({}), ctx(p)), ["crm", "create"]],
      [() => r.activate.POST(post({ version: 1 }), ctx(p)), ["crm", "edit"]],
      [() => r.deactivate.POST(post({ version: 1 }), ctx(p)), ["crm", "edit"]],
      [() => r.archive.POST(post({ version: 1 }), ctx(p)), ["crm", "edit"]],
      [() => r.restore.POST(post({ version: 1 }), ctx(p)), ["crm", "edit"]],
      [() => r.versions.GET(new NextRequest("http://x"), ctx(p)), ["crm", "view"]],
      [() => r.version.GET(new NextRequest("http://x"), ctx(pv)), ["crm", "view"]],
      [() => r.restoreVersion.POST(post({ version: 1 }), ctx(pv)), ["crm", "edit"]],
      [() => r.previewOne.POST(post({}), ctx(p)), ["crm", "view"]],
      [() => r.validateOne.POST(post({}), ctx(p)), ["crm", "view"]],
      [() => r.testSend.POST(post({}), ctx(p)), ["crm", "create"]],
    ];
    for (const [call, perm] of cases) {
      const res = await call();
      expect(res.status, `${perm}`).toBeLessThan(300);
      expect(lastPerm()).toEqual(perm);
    }
    expect(m.svc.changeTemplateStatus.mock.calls.map((c) => c[2])).toEqual(["activate", "deactivate", "archive", "restore"]);
  });

  it("refuses users without the permission before touching the service (server-side)", async () => {
    const { BusinessRuleError } = await import("@/core/errors/BusinessRuleError");
    m.assert.mockRejectedValue(new BusinessRuleError("PERMISSION_DENIED", "No access"));
    for (const call of [() => r.list.POST(post({}), ctx({})), () => r.one.PATCH(post({}), ctx({ id: ID })), () => r.archive.POST(post({}), ctx({ id: ID })), () => r.testSend.POST(post({}), ctx({ id: ID })), () => r.list.GET(new NextRequest("http://x/api/v1/crm/templates"), ctx({}))]) {
      expect((await call()).status).toBe(403);
    }
    for (const fn of Object.values(m.svc)) expect(fn).not.toHaveBeenCalled();
    m.requireSession.mockRejectedValue(new BusinessRuleError("PERMISSION_DENIED", "Sign in"));
    expect((await r.one.GET(new NextRequest("http://x"), ctx({ id: ID }))).status).toBe(403);
  });

  it("passes ids and bodies through; template errors come back as 422 with details", async () => {
    await r.testSend.POST(post({ channelId: ID, to: "a@b.co", confirm: true }), ctx({ id: ID }));
    expect(m.svc.sendTemplateTest).toHaveBeenCalledWith(ACTOR, ID, { channelId: ID, to: "a@b.co", confirm: true });
    await r.restoreVersion.POST(post({ version: 3 }), ctx({ id: ID, versionId: VID }));
    expect(m.svc.restoreTemplateVersion).toHaveBeenCalledWith(ACTOR, ID, VID, { version: 3 });
    const { BusinessRuleError } = await import("@/core/errors/BusinessRuleError");
    m.svc.changeTemplateStatus.mockRejectedValue(new BusinessRuleError("CRM_TEMPLATE_INVALID", "Fix the template's errors before activating it.", { errors: [{ code: "UNKNOWN_VARIABLE", message: "Template contains unsupported variable: {{customer.xyz}}." }] }));
    const res = await r.activate.POST(post({ version: 1 }), ctx({ id: ID }));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(JSON.stringify(body)).toContain("{{customer.xyz}}");
    // validate (draft) returns only the validation fields
    m.svc.previewDraft.mockResolvedValue({ subject: null, body: "x", valid: false, errors: [{ code: "BODY_REQUIRED" }], warnings: [], variables: [] });
    const v = await (await r.validate.POST(post({ channelType: "SMS", body: "" }), ctx({}))).json();
    expect(v.data).toEqual({ valid: false, errors: [{ code: "BODY_REQUIRED" }], warnings: [], variables: [] });
  });
});
