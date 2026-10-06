import { describe, expect, it, vi } from "vitest";

vi.mock("@/core/db/client", () => ({ prisma: {} }));
vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/core/rbac/PermissionService", () => ({ PermissionService: { can: vi.fn(async () => true) } }));

const { resolveStageProbability, probabilitySourceFor, assertTransitionAllowed, presentEvaluation } = await import("./crm-stage-transition.service");
const req = await import("./stage-requirements");
const schema = await import("./pipeline.schema");
const { CRM_EVENT_TYPES } = await import("../core/crm-event-types");

const A = "6f1c2f1e-1f2a-4b1a-9d1a-2b3c4d5e6f70";
const B = "7f1c2f1e-1f2a-4b1a-9d1a-2b3c4d5e6f71";

const snap = (over: Partial<import("./stage-requirements").RequirementSnapshot> = {}) => ({
  crmCompanyId: null,
  crmContactId: null,
  amount: null,
  currencyCode: null,
  expectedCloseDate: null,
  description: null,
  ownerUserId: null,
  sourceId: null,
  probability: null,
  customFields: {},
  erpLinkTypes: [],
  ...over,
});

describe("stage probability", () => {
  const base = { oldStageProbability: 10, newStageProbability: 30 };
  it("follows the new stage when it came from the stage (or was never set)", () => {
    expect(resolveStageProbability({ ...base, current: 10, currentSource: "STAGE" })).toEqual({ value: 30, source: "STAGE" });
    expect(resolveStageProbability({ ...base, current: null, currentSource: null })).toEqual({ value: 30, source: "STAGE" });
  });
  it("keeps a hand-set probability unless asked to use the stage default", () => {
    expect(resolveStageProbability({ ...base, current: 45, currentSource: "MANUAL" })).toEqual({ value: 45, source: "MANUAL" });
    expect(resolveStageProbability({ ...base, current: 45, currentSource: "MANUAL", useStageProbability: true })).toEqual({ value: 30, source: "STAGE" });
  });
  it("treats pre-Phase 07 values without a source the Phase 06 way", () => {
    expect(resolveStageProbability({ ...base, current: 10, currentSource: null })).toEqual({ value: 30, source: "STAGE" });
    expect(resolveStageProbability({ ...base, current: 45, currentSource: null })).toEqual({ value: 45, source: "MANUAL" });
  });
  it("uses an explicit value: MANUAL unless it equals the stage default; null clears", () => {
    expect(resolveStageProbability({ ...base, current: 10, currentSource: "STAGE", explicit: 55 })).toEqual({ value: 55, source: "MANUAL" });
    expect(resolveStageProbability({ ...base, current: 10, currentSource: "STAGE", explicit: 30 })).toEqual({ value: 30, source: "STAGE" });
    expect(resolveStageProbability({ ...base, current: 10, currentSource: "STAGE", explicit: null })).toEqual({ value: null, source: null });
  });
  it("keeps the current value when the new stage has no default", () => {
    expect(resolveStageProbability({ current: 20, currentSource: "STAGE", oldStageProbability: 20, newStageProbability: null })).toEqual({ value: 20, source: "STAGE" });
    expect(probabilitySourceFor(25, 25)).toBe("STAGE");
    expect(probabilitySourceFor(26, 25)).toBe("MANUAL");
    expect(probabilitySourceFor(null, 25)).toBeNull();
  });
});

describe("stage requirements registry", () => {
  const custom = [{ key: "fabric", label: "Fabric", isActive: true }];
  it("offers built-in fields, ERP documents and custom fields — never a quotation", () => {
    const keys = req.requirementOptions(custom).map((o) => o.key);
    expect(keys).toEqual(expect.arrayContaining(["company", "contact", "amount", "expectedCloseDate", "requirement", "erp:any", "erp:SALES_ORDER", "custom:fabric"]));
    expect(keys).not.toContain("quotation");
    expect(req.UNAVAILABLE_REQUIREMENTS[0].key).toBe("quotation");
    expect(req.isKnownRequirement("erp:QUOTATION", ["fabric"])).toBe(false);
    expect(req.isKnownRequirement("custom:other", ["fabric"])).toBe(false);
    expect(req.isKnownRequirement("custom:fabric", ["fabric"])).toBe(true);
  });
  it("reports what is missing, in order and without duplicates, with the form field to highlight", () => {
    const missing = req.missingRequirements(["company", "amount", "company", "erp:SALES_ORDER", "custom:fabric"], snap({ amount: "0", erpLinkTypes: ["BUYER_ENQUIRY"] }), custom);
    expect(missing).toEqual([
      { key: "company", label: "Company", field: "crmCompanyId" },
      { key: "erp:SALES_ORDER", label: "A linked sales order", field: null },
      { key: "custom:fabric", label: "Fabric", field: "customFields.fabric" },
    ]);
    expect(req.missingRequirements(["erp:any", "requirement"], snap({ erpLinkTypes: ["SAMPLE_REQUEST"], description: "  " }))).toEqual([{ key: "requirement", label: "Requirement summary", field: "description" }]);
    expect(req.missingRequirements(["custom:gone"], snap(), custom)).toEqual([]);
    expect(req.isRequirementMet("unknown-key", snap())).toBe(true);
  });
});

describe("pipeline / stage schemas", () => {
  it("validates names, probabilities and required-field lists", () => {
    expect(schema.createStageSchema.safeParse({ name: " " }).success).toBe(false);
    expect(schema.createStageSchema.parse({ name: "Sampling", probability: "40" }).probability).toBe(40);
    for (const bad of [-1, 101, 2.5, "x"]) expect(schema.createStageSchema.safeParse({ name: "S", probability: bad }).success).toBe(false);
    expect(schema.updateStageSchema.safeParse({ name: "S" }).success).toBe(false); // version required
    expect(schema.updateStageSchema.safeParse({ version: 1, isDefault: true }).success).toBe(false); // default has its own action
    expect(schema.createPipelineSchema.safeParse({ name: "P", stages: [] }).success).toBe(false);
  });
  it("requires every reorder id to be a uuid and rules to name a destination", () => {
    expect(schema.reorderStagesSchema.safeParse({ ids: [A, "nope"] }).success).toBe(false);
    expect(schema.updateTransitionRulesSchema.safeParse({ version: 1, transitionMode: "ONLY_LISTED", rules: [{ toStageId: A, allowed: true, requiredFields: ["company"] }] }).success).toBe(true);
    expect(schema.updateTransitionRulesSchema.safeParse({ version: 1, transitionMode: "SOME", rules: [] }).success).toBe(false);
    expect(schema.archiveStageSchema.safeParse({ version: 1, reassignToStageId: B, confirm: true }).success).toBe(true);
    expect(schema.archiveStageSchema.safeParse({ version: 1, confirm: false }).success).toBe(false);
    expect(schema.boardQuerySchema.parse({ perStage: "5" })).toEqual({ perStage: 5, status: "OPEN" });
  });
  it("registers the transfer timeline event", () => {
    expect(CRM_EVENT_TYPES["opportunity.pipeline_transferred"].entityType).toBe("OPPORTUNITY");
  });
});

describe("transition errors", () => {
  const ev = (issues: { code: string; message: string }[], missing: { key: string; label: string; field: string | null }[] = []) =>
    ({ allowed: false, noop: false, changeType: "STAGE_CHANGE", from: { pipeline: null, stage: null }, to: { pipeline: null, stage: { id: B, name: "Costing", probability: 60 } }, issues, missingFields: missing, probability: { from: 10, to: 60, source: "STAGE" } }) as never;
  it("refused moves become 422 CRM_STAGE_TRANSITION_BLOCKED with field errors", () => {
    try {
      assertTransitionAllowed(ev([{ code: "REQUIRED_FIELDS_MISSING", message: "fill in" }], [{ key: "amount", label: "Estimated value", field: "amount" }]));
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toMatchObject({ code: "CRM_STAGE_TRANSITION_BLOCKED", httpStatus: 422, details: { fieldErrors: { amount: 'Required for "Costing"' } } });
    }
  });
  it("closed/archived records and bad targets keep their usual codes", () => {
    expect(() => assertTransitionAllowed(ev([{ code: "OPPORTUNITY_CLOSED", message: "closed" }]))).toThrow(expect.objectContaining({ code: "INVALID_STATE_TRANSITION" }));
    expect(() => assertTransitionAllowed(ev([{ code: "STAGE_ARCHIVED", message: "archived" }]))).toThrow(expect.objectContaining({ code: "VALIDATION_ERROR" }));
    expect(() => assertTransitionAllowed(ev([{ code: "TRANSITION_NOT_ALLOWED", message: "no" }]))).toThrow(expect.objectContaining({ code: "CRM_STAGE_TRANSITION_BLOCKED" }));
    expect(presentEvaluation(ev([])).to.stage).toEqual({ id: B, name: "Costing", probability: 60 });
  });
});
