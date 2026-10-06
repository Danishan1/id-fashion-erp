import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const m = vi.hoisted(() => ({
  requireSession: vi.fn(),
  assert: vi.fn(),
  svc: {} as Record<string, ReturnType<typeof vi.fn>>,
  insights: {} as Record<string, ReturnType<typeof vi.fn>>,
  opps: {} as Record<string, ReturnType<typeof vi.fn>>,
}));
const SVC = ["listPipelines", "createPipeline", "getPipeline", "updatePipeline", "archivePipeline", "restorePipeline", "setDefaultPipeline", "pipelineUsage", "listStages", "createStage", "reorderStages", "getStageDetail", "updateStage", "archiveStage", "restoreStage", "setDefaultStage", "stageUsage", "getStageConfig", "updateStageRequiredFields", "getTransitionRules", "updateTransitionRules", "listPipelinesForSettings"];
for (const k of SVC) m.svc[k] = vi.fn();
for (const k of ["getPipelineBoard", "getPipelineReport"]) m.insights[k] = vi.fn();
for (const k of ["validateOpportunityTransition", "transferOpportunityPipeline", "getOpportunityStageHistory", "changeOpportunityStage"]) m.opps[k] = vi.fn();

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
vi.mock("@/modules/crm/pipelines/crm-pipelines.service", () => m.svc);
vi.mock("@/modules/crm/pipelines/crm-pipeline-insights.service", () => m.insights);
vi.mock("@/modules/crm/opportunities/crm-opportunities.service", () => m.opps);

const r = {
  list: await import("./route"),
  detail: await import("./[id]/route"),
  archive: await import("./[id]/archive/route"),
  restore: await import("./[id]/restore/route"),
  def: await import("./[id]/default/route"),
  usage: await import("./[id]/usage/route"),
  board: await import("./[id]/board/route"),
  report: await import("./[id]/report/route"),
  stages: await import("./[id]/stages/route"),
  reorder: await import("./[id]/stages/reorder/route"),
  stage: await import("./[id]/stages/[stageId]/route"),
  stageArchive: await import("./[id]/stages/[stageId]/archive/route"),
  stageRestore: await import("./[id]/stages/[stageId]/restore/route"),
  stageDefault: await import("./[id]/stages/[stageId]/default/route"),
  stageUsage: await import("./[id]/stages/[stageId]/usage/route"),
  config: await import("./[id]/stages/[stageId]/config/route"),
  required: await import("./[id]/stages/[stageId]/required-fields/route"),
  rules: await import("./[id]/stages/[stageId]/transition-rules/route"),
  settings: await import("../settings/pipelines/route"),
  validate: await import("../opportunities/[id]/stage/validate/route"),
  transfer: await import("../opportunities/[id]/transfer/route"),
  history: await import("../opportunities/[id]/stage-history/route"),
};

const ID = "6f1c2f1e-1f2a-4b1a-9d1a-2b3c4d5e6f70";
const S = "7f1c2f1e-1f2a-4b1a-9d1a-2b3c4d5e6f71";
const ACTOR = { companyId: "co-1", userId: "user-1", branchId: null };
const ctx = <P,>(params: P) => ({ params: Promise.resolve(params) });
const body = (method: string, b: unknown) => new NextRequest("http://x", { method, body: JSON.stringify(b) });
const get = (url = "http://x") => new NextRequest(url);
const lastPerm = () => m.assert.mock.calls.at(-1)!.slice(1);

beforeEach(() => {
  m.requireSession.mockReset().mockResolvedValue({ user: { id: "user-1", companyId: "co-1", defaultBranchId: null } });
  m.assert.mockReset().mockResolvedValue(undefined);
  for (const fn of [...Object.values(m.svc), ...Object.values(m.insights), ...Object.values(m.opps)]) fn.mockReset().mockResolvedValue({ ok: true });
});

describe("CRM pipeline & stage routes", () => {
  it("pipeline list is readable with crm.view; configuration needs crm_settings", async () => {
    await r.list.GET(get("http://x/api/v1/crm/pipelines?includeArchived=0"), ctx({}));
    expect(m.svc.listPipelines).toHaveBeenCalledWith("co-1", { includeArchived: false });
    expect(lastPerm()).toEqual(["crm", "view"]);
    const created = await r.list.POST(body("POST", { name: "Export" }), ctx({}));
    expect(created.status).toBe(201);
    expect(lastPerm()).toEqual(["crm_settings", "edit"]);
    await r.settings.GET(get(), ctx({}));
    expect(lastPerm()).toEqual(["crm_settings", "view"]);
    await r.detail.GET(get(), ctx({ id: ID }));
    expect(m.svc.getPipeline).toHaveBeenCalledWith("co-1", ID);
    expect(lastPerm()).toEqual(["crm_settings", "view"]);
  });

  it("every pipeline / stage change goes to the service with crm_settings.edit", async () => {
    const cases: [() => Promise<Response>, string, unknown[]][] = [
      [() => r.detail.PATCH(body("PATCH", { version: 1 }), ctx({ id: ID })), "updatePipeline", [ACTOR, ID, { version: 1 }]],
      [() => r.archive.POST(body("POST", { version: 1 }), ctx({ id: ID })), "archivePipeline", [ACTOR, ID, { version: 1 }]],
      [() => r.restore.POST(body("POST", { version: 2 }), ctx({ id: ID })), "restorePipeline", [ACTOR, ID, { version: 2 }]],
      [() => r.def.POST(body("POST", { version: 1 }), ctx({ id: ID })), "setDefaultPipeline", [ACTOR, ID, { version: 1 }]],
      [() => r.stages.POST(body("POST", { name: "S" }), ctx({ id: ID })), "createStage", [ACTOR, ID, { name: "S" }]],
      [() => r.reorder.POST(body("POST", { ids: [S] }), ctx({ id: ID })), "reorderStages", [ACTOR, ID, { ids: [S] }]],
      [() => r.stage.PATCH(body("PATCH", { version: 1 }), ctx({ id: ID, stageId: S })), "updateStage", [ACTOR, ID, S, { version: 1 }]],
      [() => r.stageArchive.POST(body("POST", { version: 1 }), ctx({ id: ID, stageId: S })), "archiveStage", [ACTOR, ID, S, { version: 1 }]],
      [() => r.stageRestore.POST(body("POST", { version: 1 }), ctx({ id: ID, stageId: S })), "restoreStage", [ACTOR, ID, S, { version: 1 }]],
      [() => r.stageDefault.POST(body("POST", { version: 1 }), ctx({ id: ID, stageId: S })), "setDefaultStage", [ACTOR, ID, S, { version: 1 }]],
      [() => r.required.PUT(body("PUT", { version: 1, requiredFields: [] }), ctx({ id: ID, stageId: S })), "updateStageRequiredFields", [ACTOR, ID, S, { version: 1, requiredFields: [] }]],
      [() => r.rules.PUT(body("PUT", { version: 1 }), ctx({ id: ID, stageId: S })), "updateTransitionRules", [ACTOR, ID, S, { version: 1 }]],
    ];
    for (const [call, fn, args] of cases) {
      await call();
      expect(m.svc[fn]).toHaveBeenCalledWith(...args);
      expect(lastPerm()).toEqual(["crm_settings", "edit"]);
    }
  });

  it("stage reads (list, detail, usage, config, rules) need crm_settings.view", async () => {
    for (const [call, fn] of [
      [() => r.stages.GET(get(), ctx({ id: ID })), "listStages"],
      [() => r.usage.GET(get(), ctx({ id: ID })), "pipelineUsage"],
      [() => r.stage.GET(get(), ctx({ id: ID, stageId: S })), "getStageDetail"],
      [() => r.stageUsage.GET(get(), ctx({ id: ID, stageId: S })), "stageUsage"],
      [() => r.config.GET(get(), ctx({ id: ID, stageId: S })), "getStageConfig"],
      [() => r.rules.GET(get(), ctx({ id: ID, stageId: S })), "getTransitionRules"],
    ] as const) {
      await call();
      expect(m.svc[fn]).toHaveBeenCalled();
      expect(lastPerm()).toEqual(["crm_settings", "view"]);
    }
  });

  it("board and report use crm.view (visibility is applied by the service) and validate the date range", async () => {
    await r.board.GET(get(`http://x/api/v1/crm/pipelines/${ID}/board?perStage=5&status=ALL`), ctx({ id: ID }));
    expect(m.insights.getPipelineBoard).toHaveBeenCalledWith(ACTOR, ID, { perStage: "5", status: "ALL" });
    expect(lastPerm()).toEqual(["crm", "view"]);
    await r.report.GET(get(`http://x/api/v1/crm/pipelines/${ID}/report?from=2026-01-01&to=2026-12-31`), ctx({ id: ID }));
    expect(m.insights.getPipelineReport).toHaveBeenCalledWith(ACTOR, ID, { from: "2026-01-01", to: "2026-12-31" });
    expect((await r.report.GET(get(`http://x/api/v1/crm/pipelines/${ID}/report?from=2026-12-31&to=2026-01-01`), ctx({ id: ID }))).status).toBe(400);
  });

  it("opportunity validate (crm.view), transfer (crm.edit) and stage history (crm.view)", async () => {
    await r.validate.POST(body("POST", { stageId: S }), ctx({ id: ID }));
    expect(m.opps.validateOpportunityTransition).toHaveBeenCalledWith(ACTOR, ID, { stageId: S });
    expect(lastPerm()).toEqual(["crm", "view"]);
    await r.transfer.POST(body("POST", { pipelineId: S }), ctx({ id: ID }));
    expect(m.opps.transferOpportunityPipeline).toHaveBeenCalledWith(ACTOR, ID, { pipelineId: S });
    expect(lastPerm()).toEqual(["crm", "edit"]);
    await r.history.GET(get(), ctx({ id: ID }));
    expect(m.opps.getOpportunityStageHistory).toHaveBeenCalledWith(ACTOR, ID);
    expect(lastPerm()).toEqual(["crm", "view"]);
  });

  it("returns 422 for a refused move and 403 when the permission check fails", async () => {
    const { BusinessRuleError } = await import("@/core/errors/BusinessRuleError");
    m.opps.transferOpportunityPipeline.mockRejectedValueOnce(new BusinessRuleError("CRM_STAGE_TRANSITION_BLOCKED", "Fill in Company", { missingFields: [{ key: "company", label: "Company" }] }));
    const res = await r.transfer.POST(body("POST", { pipelineId: S }), ctx({ id: ID }));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatchObject({ code: "CRM_STAGE_TRANSITION_BLOCKED", details: { missingFields: [{ key: "company" }] } });
    m.assert.mockRejectedValueOnce(new BusinessRuleError("PERMISSION_DENIED", "No"));
    expect((await r.archive.POST(body("POST", { version: 1 }), ctx({ id: ID }))).status).toBe(403);
    expect(m.svc.archivePipeline).not.toHaveBeenCalled();
  });
});
