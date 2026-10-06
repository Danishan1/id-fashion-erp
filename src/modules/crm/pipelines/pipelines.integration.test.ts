/**
 * CRM Pipelines & Stages (Phase 07) against a real, migrated + seeded
 * Postgres database.
 *
 * Skipped unless CRM_IT_DATABASE_URL points at a DISPOSABLE database (it
 * writes pipelines, stages, rules, opportunities, companies and users):
 *   CRM_IT_DATABASE_URL=postgresql://…/crm_it npx vitest run src/modules/crm/pipelines/pipelines.integration.test.ts
 *
 * Every test works in pipelines it creates itself (unique names per run);
 * the company's default pipeline is put back after the default-pipeline test.
 * Only permissions are mocked: `crm.view_all` is granted to "manager".
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const DB_URL = process.env.CRM_IT_DATABASE_URL;
if (DB_URL) process.env.DATABASE_URL = DB_URL;

const viewAllUsers = new Set<string>();
vi.mock("@/core/rbac/PermissionService", () => ({
  PermissionService: {
    can: vi.fn(async (userId: string, _module: string, action: string) => (action === "view_all" ? viewAllUsers.has(userId) : true)),
    assert: vi.fn(async () => undefined),
    getAllowedBranchIds: vi.fn(async () => null),
    invalidate: vi.fn(),
  },
}));

type Actor = { companyId: string; userId: string; branchId: string | null };

describe.skipIf(!DB_URL)("CRM pipelines & stages (database integration)", async () => {
  const { prisma } = await import("@/core/db/client");
  const svc = await import("./crm-pipelines.service");
  const insights = await import("./crm-pipeline-insights.service");
  const opps = await import("../opportunities/crm-opportunities.service");
  const companies = await import("../companies/crm-companies.service");

  const run = `p${Date.now().toString(36)}`;
  let manager: Actor;
  let rep: Actor;
  let otherRep: Actor;
  const expectCode = (p: Promise<unknown>, code: string) => expect(p).rejects.toMatchObject({ code });
  const name = (n: string) => `${n} ${run}`;
  const raw = (id: string) => prisma.crmOpportunity.findUniqueOrThrow({ where: { id } });
  const history = (id: string) => prisma.crmOpportunityStageHistory.findMany({ where: { opportunityId: id }, orderBy: { changedAt: "asc" } });
  const eventTypes = async (id: string) => (await prisma.crmEvent.findMany({ where: { entityId: id }, orderBy: { occurredAt: "asc" } })).map((e) => e.eventType);
  const stagesOf = async (pipelineId: string) => (await svc.getPipeline(manager.companyId, pipelineId)).stages;
  const stageByName = async (pipelineId: string, n: string) => (await stagesOf(pipelineId)).find((s) => s.name === n)!;
  let n = 0;
  const mkPipeline = (label: string, extra: Record<string, unknown> = {}) =>
    svc.createPipeline(manager, {
      name: name(`${label} ${++n}`),
      stages: [
        { name: "Enquiry", probability: 10 },
        { name: "Sampling", probability: 30 },
        { name: "Costing", probability: 60 },
        { name: "Order", probability: 90 },
      ],
      ...extra,
    }) as Promise<{ id: string; name: string; version: number }>;

  beforeAll(async () => {
    const company = await prisma.company.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
    const mk = (u: string) => prisma.user.create({ data: { companyId: company.id, email: `${u}.${run}@crm-it.local`, passwordHash: "x", fullName: `${u} ${run}` } });
    const [m, r, o] = await Promise.all([mk("pmanager"), mk("prep"), mk("pother")]);
    manager = { companyId: company.id, userId: m.id, branchId: null };
    rep = { companyId: company.id, userId: r.id, branchId: null };
    otherRep = { companyId: company.id, userId: o.id, branchId: null };
    viewAllUsers.add(m.id);
    await svc.ensureDefaultPipeline(company.id);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // ── Pipelines ──

  it("creates a pipeline with ordered stages, a default stage, a unique key and an audit row; rejects duplicate names", async () => {
    const p = await mkPipeline("Export");
    const detail = await svc.getPipeline(manager.companyId, p.id);
    expect(detail.status).toBe("ACTIVE");
    expect(detail.stages.map((s) => s.name)).toEqual(["Enquiry", "Sampling", "Costing", "Order"]);
    expect(detail.stages.filter((s) => s.isDefault).map((s) => s.name)).toEqual(["Enquiry"]);
    expect(detail.requirementOptions.map((o) => o.key)).toEqual(expect.arrayContaining(["company", "contact", "amount", "expectedCloseDate", "requirement", "erp:SALES_ORDER"]));
    expect(detail.unavailableRequirements[0].key).toBe("quotation");
    await expectCode(svc.createPipeline(manager, { name: `  ${p.name.toUpperCase()} ` }), "VALIDATION_ERROR");
    await expectCode(svc.createPipeline(manager, { name: name("Dup stages"), stages: [{ name: "A" }, { name: "a " }] }), "VALIDATION_ERROR");
    expect(await prisma.auditLog.count({ where: { tableName: "crm_pipelines", recordId: p.id, action: "CREATE" } })).toBe(1);
    // Edit with optimistic locking
    const edited = await svc.updatePipeline(manager, p.id, { version: p.version, description: "Overseas buyers" });
    expect(edited!.description).toBe("Overseas buyers");
    await expectCode(svc.updatePipeline(manager, p.id, { version: p.version, name: name("Stale") }), "RECORD_VERSION_CONFLICT");
  });

  it("keeps exactly one default pipeline (audited), never archives the default and uses it for new opportunities", async () => {
    const original = (await prisma.crmPipeline.findFirstOrThrow({ where: { companyId: manager.companyId, isDefault: true } }))!;
    const p = await mkPipeline("Domestic");
    try {
      await svc.setDefaultPipeline(manager, p.id, { version: p.version });
      expect(await prisma.crmPipeline.count({ where: { companyId: manager.companyId, isDefault: true } })).toBe(1);
      expect((await prisma.crmPipeline.findUniqueOrThrow({ where: { id: original.id } })).isDefault).toBe(false);
      expect(await prisma.auditLog.count({ where: { tableName: "crm_pipelines", recordId: original.id, newValues: { path: ["replacedBy"], equals: p.id } } })).toBe(1);
      const o = await opps.createOpportunity(rep, { name: name("Default pipeline deal") });
      const r = await raw(o.id);
      expect(r.pipelineId).toBe(p.id);
      expect(r.stageId).toBe((await stageByName(p.id, "Enquiry")).id);
      const cur = await prisma.crmPipeline.findUniqueOrThrow({ where: { id: p.id } });
      await expectCode(svc.archivePipeline(manager, p.id, { version: cur.version }), "VALIDATION_ERROR");
    } finally {
      const o = await prisma.crmPipeline.findUniqueOrThrow({ where: { id: original.id } });
      await svc.setDefaultPipeline(manager, original.id, { version: o.version });
    }
    expect((await prisma.crmPipeline.findUniqueOrThrow({ where: { id: original.id } })).isDefault).toBe(true);
  });

  // ── Stages ──

  it("adds, edits, reorders and defaults stages without touching opportunities", async () => {
    const p = await mkPipeline("Stages");
    const enquiry = await stageByName(p.id, "Enquiry");
    const o = await opps.createOpportunity(rep, { name: name("Stage config deal"), pipelineId: p.id, stageId: enquiry.id });
    const added = await svc.createStage(manager, p.id, { name: "Lab dip", probability: 20 });
    expect((await stagesOf(p.id)).at(-1)!.name).toBe("Lab dip");
    await expectCode(svc.createStage(manager, p.id, { name: "lab  DIP" }), "VALIDATION_ERROR");
    await expectCode(svc.createStage(manager, p.id, { name: "X", requiredFields: ["not-a-field"] }), "VALIDATION_ERROR");

    // Probability change applies to future entries only
    await svc.updateStage(manager, p.id, enquiry.id, { version: enquiry.version, probability: 15 });
    expect((await raw(o.id)).probability).toBe(10);
    await expectCode(svc.updateStage(manager, p.id, enquiry.id, { version: enquiry.version, name: "Stale" }), "RECORD_VERSION_CONFLICT");

    // Reorder: display order only
    const ids = (await stagesOf(p.id)).map((s) => s.id);
    const reordered = await svc.reorderStages(manager, p.id, { ids: [added!.id, ...ids.filter((x) => x !== added!.id)] });
    expect(reordered.map((s) => s.name)).toEqual(["Lab dip", "Enquiry", "Sampling", "Costing", "Order"]);
    expect((await raw(o.id)).stageId).toBe(enquiry.id);
    await expectCode(svc.reorderStages(manager, p.id, { ids: ids.slice(1) }), "RECORD_VERSION_CONFLICT");

    // Default stage: one per pipeline, can't archive it
    const lab = await stageByName(p.id, "Lab dip");
    await svc.setDefaultStage(manager, p.id, lab.id, { version: lab.version });
    expect((await stagesOf(p.id)).filter((s) => s.isDefault).map((s) => s.name)).toEqual(["Lab dip"]);
    const lab2 = await stageByName(p.id, "Lab dip");
    await expectCode(svc.archiveStage(manager, p.id, lab2.id, { version: lab2.version }), "VALIDATION_ERROR");
  });

  // ── Probability ──

  it("tracks whether the probability follows the stage or was set by hand, and records it in history", async () => {
    const p = await mkPipeline("Probability");
    const [enq, smp, cst, ord] = await stagesOf(p.id);
    const o = await opps.createOpportunity(rep, { name: name("Prob deal"), pipelineId: p.id, stageId: enq.id });
    expect(await raw(o.id)).toMatchObject({ probability: 10, probabilitySource: "STAGE" });
    await opps.changeOpportunityStage(rep, o.id, { stageId: smp.id });
    expect(await raw(o.id)).toMatchObject({ probability: 30, probabilitySource: "STAGE" });
    await opps.changeOpportunityStage(rep, o.id, { stageId: smp.id, probability: 45 }); // same stage → manual
    expect(await raw(o.id)).toMatchObject({ probability: 45, probabilitySource: "MANUAL" });
    await opps.changeOpportunityStage(rep, o.id, { stageId: cst.id });
    expect(await raw(o.id)).toMatchObject({ probability: 45, probabilitySource: "MANUAL", stageId: cst.id });
    await opps.changeOpportunityStage(rep, o.id, { stageId: ord.id, useStageProbability: true });
    expect(await raw(o.id)).toMatchObject({ probability: 90, probabilitySource: "STAGE" });
    const h = await history(o.id);
    expect(h.map((x) => [x.changeType, x.source, x.toStageName, x.fromProbability, x.toProbability, x.probabilitySource])).toEqual([
      ["INITIAL", "CREATE", "Enquiry", null, 10, "STAGE"],
      ["STAGE_CHANGE", "STAGE_ACTION", "Sampling", 10, 30, "STAGE"],
      ["STAGE_CHANGE", "STAGE_ACTION", "Costing", 45, 45, "MANUAL"],
      ["STAGE_CHANGE", "STAGE_ACTION", "Order", 45, 90, "STAGE"],
    ]);
    expect(h.every((x) => x.changedByUserId === rep.userId && x.result === "APPLIED")).toBe(true);
    const detailHistory = await opps.getOpportunityStageHistory(rep, o.id);
    expect(detailHistory[0]).toMatchObject({ toStage: { name: "Order" }, changedBy: { id: rep.userId } });
  });

  // ── Required fields & rules ──

  it("blocks a move until the destination stage's required fields are filled — and writes nothing when blocked", async () => {
    const p = await mkPipeline("Required");
    const [enq, smp] = await stagesOf(p.id);
    await svc.updateStageRequiredFields(manager, p.id, smp.id, { version: smp.version, requiredFields: ["company", "amount", "expectedCloseDate", "erp:SALES_ORDER"] });
    const o = await opps.createOpportunity(rep, { name: name("Required deal"), pipelineId: p.id, stageId: enq.id });
    const before = await raw(o.id);

    const dry = await opps.validateOpportunityTransition(rep, o.id, { stageId: smp.id });
    expect(dry.allowed).toBe(false);
    expect(dry.missingFields.map((m) => m.key)).toEqual(["company", "amount", "expectedCloseDate", "erp:SALES_ORDER"]);

    const err = await opps.changeOpportunityStage(rep, o.id, { stageId: smp.id }).catch((e) => e);
    expect(err).toMatchObject({ code: "CRM_STAGE_TRANSITION_BLOCKED", httpStatus: 422 });
    expect(err.details.missingFields.map((m: { label: string }) => m.label)).toContain("Company");
    expect(err.details.fieldErrors).toMatchObject({ crmCompanyId: expect.any(String), amount: expect.any(String) });
    const after = await raw(o.id);
    expect(after).toMatchObject({ stageId: enq.id, version: before.version });
    expect((await history(o.id)).length).toBe(1);
    expect(await eventTypes(o.id)).not.toContain("opportunity.stage_changed");

    // The edit form can fill the fields and move in the same save (sales order still missing → blocked)
    const co = await companies.createCompany(rep, { name: name("Required Co") });
    await expectCode(opps.updateOpportunity(rep, o.id, { version: after.version, crmCompanyId: co.id, amount: "1000", expectedCloseDate: "2026-12-01", stageId: smp.id }), "CRM_STAGE_TRANSITION_BLOCKED");
    const smp2 = await stageByName(p.id, "Sampling");
    await svc.updateStageRequiredFields(manager, p.id, smp.id, { version: smp2.version, requiredFields: ["company", "amount", "expectedCloseDate"] });
    await opps.updateOpportunity(rep, o.id, { version: after.version, crmCompanyId: co.id, amount: "1000", expectedCloseDate: "2026-12-01", stageId: smp.id });
    expect((await raw(o.id)).stageId).toBe(smp.id);
    expect((await history(o.id)).at(-1)).toMatchObject({ source: "FORM", changeType: "STAGE_CHANGE" });

    // Starting directly in a stage with requirements is checked too
    await expectCode(opps.createOpportunity(rep, { name: name("Starts late"), pipelineId: p.id, stageId: smp.id }), "CRM_STAGE_TRANSITION_BLOCKED");
  });

  it("applies transition rules: blocked moves, 'only listed' stages and rule-specific requirements", async () => {
    const p = await mkPipeline("Rules");
    const [enq, smp, cst, ord] = await stagesOf(p.id);
    await svc.updateTransitionRules(manager, p.id, enq.id, {
      version: enq.version,
      transitionMode: "ONLY_LISTED",
      rules: [
        { toStageId: smp.id, allowed: true, requiredFields: ["requirement"] },
        { toStageId: ord.id, allowed: false, message: "Orders need sampling first." },
      ],
    });
    await expectCode(svc.updateTransitionRules(manager, p.id, enq.id, { version: enq.version, transitionMode: "ANY", rules: [] }), "RECORD_VERSION_CONFLICT");
    const fresh = await stageByName(p.id, "Enquiry");
    await expectCode(svc.updateTransitionRules(manager, p.id, enq.id, { version: fresh.version, transitionMode: "ANY", rules: [{ toStageId: enq.id, allowed: true }] }), "VALIDATION_ERROR");
    expect((await svc.getTransitionRules(manager.companyId, p.id, enq.id)).rules).toHaveLength(2);

    const o = await opps.createOpportunity(rep, { name: name("Rules deal"), pipelineId: p.id, stageId: enq.id });
    const toOrder = await opps.validateOpportunityTransition(rep, o.id, { stageId: ord.id });
    expect(toOrder.reasons.map((r) => r.message)).toEqual(["Orders need sampling first."]);
    const toCosting = await opps.validateOpportunityTransition(rep, o.id, { stageId: cst.id });
    expect(toCosting.reasons[0].code).toBe("TRANSITION_NOT_ALLOWED");
    const toSampling = await opps.validateOpportunityTransition(rep, o.id, { stageId: smp.id });
    expect(toSampling.missingFields.map((m) => m.key)).toEqual(["requirement"]);
    await expectCode(opps.changeOpportunityStage(rep, o.id, { stageId: ord.id }), "CRM_STAGE_TRANSITION_BLOCKED");
    const r = await raw(o.id);
    await opps.updateOpportunity(rep, o.id, { version: r.version, description: "20k knit polos" });
    await opps.changeOpportunityStage(rep, o.id, { stageId: smp.id });
    expect((await raw(o.id)).stageId).toBe(smp.id);
    // Rules are per source stage: from Sampling everything is allowed (mode ANY)
    await opps.changeOpportunityStage(rep, o.id, { stageId: enq.id });
    expect((await raw(o.id)).stageId).toBe(enq.id);
  });

  it("validates bulk stage changes record by record with a clear result", async () => {
    const p = await mkPipeline("Bulk");
    const [enq, smp] = await stagesOf(p.id);
    await svc.updateStageRequiredFields(manager, p.id, smp.id, { version: smp.version, requiredFields: ["amount"] });
    const ok = await opps.createOpportunity(rep, { name: name("Bulk ok"), pipelineId: p.id, stageId: enq.id, amount: "500" });
    const missing = await opps.createOpportunity(rep, { name: name("Bulk missing"), pipelineId: p.id, stageId: enq.id });
    const closed = await opps.createOpportunity(rep, { name: name("Bulk closed"), pipelineId: p.id, stageId: enq.id, amount: "1" });
    await opps.changeOpportunityStatus(rep, closed.id, { status: "LOST" });
    const elsewhere = await opps.createOpportunity(rep, { name: name("Bulk other pipeline"), amount: "1" });
    const res = (await opps.bulkOpportunityAction(rep, { action: "stage", ids: [ok.id, missing.id, closed.id, elsewhere.id], stageId: smp.id })) as {
      updated: number;
      skipped: { id: string; reason: string }[];
      blocked: { id: string; missingFields: { key: string }[] }[];
    };
    expect(res.updated).toBe(1);
    expect(res.blocked).toEqual([expect.objectContaining({ id: missing.id, missingFields: [expect.objectContaining({ key: "amount" })] })]);
    expect(Object.fromEntries(res.skipped.map((s) => [s.id, s.reason]))).toMatchObject({ [missing.id]: "Missing Estimated value", [closed.id]: "Closed — reopen it first", [elsewhere.id]: "In a different pipeline" });
    expect((await raw(ok.id)).stageId).toBe(smp.id);
    expect((await history(ok.id)).at(-1)).toMatchObject({ source: "BULK" });
    expect((await raw(missing.id)).stageId).toBe(enq.id);
  });

  // ── Pipeline transfer ──

  it("transfers an opportunity to another pipeline's default stage with history and a timeline event", async () => {
    const a = await mkPipeline("From");
    const b = await mkPipeline("To");
    const [, smpA] = await stagesOf(a.id);
    const [enqB, smpB] = await stagesOf(b.id);
    const o = await opps.createOpportunity(rep, { name: name("Transfer deal"), pipelineId: a.id, stageId: smpA.id });
    await expectCode(opps.transferOpportunityPipeline(rep, o.id, { pipelineId: a.id }), "VALIDATION_ERROR");
    await svc.updateStageRequiredFields(manager, b.id, smpB.id, { version: smpB.version, requiredFields: ["contact"] });
    await expectCode(opps.transferOpportunityPipeline(rep, o.id, { pipelineId: b.id, stageId: smpB.id }), "CRM_STAGE_TRANSITION_BLOCKED");
    const moved = await opps.transferOpportunityPipeline(rep, o.id, { pipelineId: b.id, reason: "Buyer moved to domestic" });
    expect(moved).toMatchObject({ pipelineId: b.id, stageId: enqB.id, probability: 10, probabilitySource: "STAGE" });
    expect((await history(o.id)).at(-1)).toMatchObject({ changeType: "PIPELINE_TRANSFER", source: "TRANSFER", fromPipelineId: a.id, toPipelineId: b.id, reason: "Buyer moved to domestic" });
    expect(await eventTypes(o.id)).toContain("opportunity.pipeline_transferred");
    // The stage action rejects a stage of another pipeline when pipelineId says otherwise
    await expectCode(opps.changeOpportunityStage(rep, o.id, { stageId: smpA.id, pipelineId: b.id }), "VALIDATION_ERROR");
  });

  // ── Safe archive ──

  it("archives a used stage only with a reassignment, moving every record (open, closed, archived) with history", async () => {
    const p = await mkPipeline("Archive stage");
    const [enq, smp, cst] = await stagesOf(p.id);
    const open = await opps.createOpportunity(rep, { name: name("Archive open"), pipelineId: p.id, stageId: smp.id });
    const won = await opps.createOpportunity(rep, { name: name("Archive won"), pipelineId: p.id, stageId: smp.id, probability: 70 });
    await opps.changeOpportunityStatus(rep, won.id, { status: "WON" });
    const archivedOpp = await opps.createOpportunity(rep, { name: name("Archive archived"), pipelineId: p.id, stageId: smp.id });
    await opps.archiveOpportunity(rep, archivedOpp.id);

    expect(await svc.stageUsage(manager.companyId, p.id, smp.id)).toEqual({ total: 3, open: 1 });
    await expectCode(svc.archiveStage(manager, p.id, smp.id, { version: smp.version }), "VALIDATION_ERROR");
    await expectCode(svc.archiveStage(manager, p.id, smp.id, { version: smp.version, reassignToStageId: cst.id }), "VALIDATION_ERROR"); // not confirmed
    await expectCode(svc.archiveStage(manager, p.id, smp.id, { version: smp.version, reassignToStageId: smp.id, confirm: true }), "VALIDATION_ERROR");
    const res = await svc.archiveStage(manager, p.id, smp.id, { version: smp.version, reassignToStageId: cst.id, confirm: true });
    expect(res.movedOpportunities).toBe(3);
    for (const id of [open.id, won.id, archivedOpp.id]) {
      const r = await raw(id);
      expect(r.stageId).toBe(cst.id);
      expect((await history(id)).at(-1)).toMatchObject({ changeType: "STAGE_REASSIGNED", source: "STAGE_ARCHIVE", fromStageName: "Sampling", toStageName: "Costing" });
    }
    expect(await raw(open.id)).toMatchObject({ probability: 60, probabilitySource: "STAGE" });
    expect(await raw(won.id)).toMatchObject({ probability: 70, status: "WON" }); // closed deals keep their probability
    expect(await prisma.crmOpportunity.count({ where: { pipelineId: p.id, stageId: null } })).toBe(0);
    // Archived stage can't be chosen; restore puts it back at the end
    await expectCode(opps.changeOpportunityStage(rep, open.id, { stageId: smp.id }), "VALIDATION_ERROR");
    const archived = await stageByName(p.id, "Sampling");
    expect(archived.status).toBe("ARCHIVED");
    await svc.restoreStage(manager, p.id, smp.id, { version: archived.version });
    expect((await stagesOf(p.id)).filter((s) => s.status === "ACTIVE").map((s) => s.name)).toEqual(["Enquiry", "Costing", "Order", "Sampling"]);
    // Unused stage archives without a destination
    const order = await stageByName(p.id, "Order");
    await svc.archiveStage(manager, p.id, order.id, { version: order.version });
    expect(enq.isDefault).toBe(true);
  });

  it("archives a pipeline only after moving its opportunities, and restores it", async () => {
    const a = await mkPipeline("Retire");
    const b = await mkPipeline("Keep");
    const [, smpA, cstA] = await stagesOf(a.id);
    const [enqB, , cstB] = await stagesOf(b.id);
    const o1 = await opps.createOpportunity(rep, { name: name("Retire one"), pipelineId: a.id, stageId: smpA.id });
    const o2 = await opps.createOpportunity(rep, { name: name("Retire two"), pipelineId: a.id, stageId: cstA.id });
    const pa = await prisma.crmPipeline.findUniqueOrThrow({ where: { id: a.id } });
    await expectCode(svc.archivePipeline(manager, a.id, { version: pa.version }), "VALIDATION_ERROR");
    const res = await svc.archivePipeline(manager, a.id, { version: pa.version, targetPipelineId: b.id, stageMap: { [cstA.id]: cstB.id }, confirm: true });
    expect(res.movedOpportunities).toBe(2);
    expect(await raw(o1.id)).toMatchObject({ pipelineId: b.id, stageId: enqB.id });
    expect(await raw(o2.id)).toMatchObject({ pipelineId: b.id, stageId: cstB.id });
    expect((await history(o2.id)).at(-1)).toMatchObject({ changeType: "PIPELINE_TRANSFER", source: "PIPELINE_ARCHIVE" });
    expect(await prisma.crmOpportunity.count({ where: { pipelineId: a.id } })).toBe(0);
    const archived = await prisma.crmPipeline.findUniqueOrThrow({ where: { id: a.id } });
    expect(archived).toMatchObject({ isActive: false });
    expect(archived.archivedAt).not.toBeNull();
    await expectCode(opps.transferOpportunityPipeline(rep, o1.id, { pipelineId: a.id }), "VALIDATION_ERROR");
    await expectCode(svc.setDefaultPipeline(manager, a.id, { version: archived.version }), "VALIDATION_ERROR");
    await svc.restorePipeline(manager, a.id, { version: archived.version });
    expect((await prisma.crmPipeline.findUniqueOrThrow({ where: { id: a.id } })).archivedAt).toBeNull();
  });

  // ── Board & reporting ──

  it("aggregates board and report data per stage and currency, respecting visibility", async () => {
    const p = await mkPipeline("Insights");
    const [enq, smp, cst] = await stagesOf(p.id);
    const mine1 = await opps.createOpportunity(rep, { name: name("Ins 1"), pipelineId: p.id, stageId: enq.id, amount: "1000", currencyCode: "INR" });
    await opps.createOpportunity(rep, { name: name("Ins 2"), pipelineId: p.id, stageId: enq.id, amount: "500", currencyCode: "USD" });
    const mine3 = await opps.createOpportunity(rep, { name: name("Ins 3"), pipelineId: p.id, stageId: enq.id, amount: "3000", currencyCode: "INR" });
    await opps.changeOpportunityStage(rep, mine3.id, { stageId: cst.id });
    await opps.changeOpportunityStatus(rep, mine3.id, { status: "WON" });
    await opps.changeOpportunityStage(rep, mine1.id, { stageId: smp.id });
    await opps.createOpportunity(otherRep, { name: name("Ins other"), pipelineId: p.id, stageId: enq.id, amount: "999", currencyCode: "INR" });

    const board = await insights.getPipelineBoard(manager, p.id, { perStage: "1" });
    const col = (n: string) => board.stages.find((s) => s.name === n)!;
    expect(col("Enquiry")).toMatchObject({ count: 2, hasMore: true });
    expect(col("Enquiry").records).toHaveLength(1);
    expect(col("Enquiry").values).toEqual(expect.arrayContaining([{ currencyCode: "USD", total: 500 }, { currencyCode: "INR", total: 999 }]));
    expect(col("Sampling")).toMatchObject({ count: 1, values: [{ currencyCode: "INR", total: 1000 }] });
    expect(col("Costing").count).toBe(0); // won deal is not open
    expect((await insights.getPipelineBoard(manager, p.id, { status: "ALL" })).stages.find((s) => s.name === "Costing")!.count).toBe(1);
    const repBoard = await insights.getPipelineBoard(rep, p.id, {});
    expect(repBoard.stages.find((s) => s.name === "Enquiry")!.count).toBe(1);

    const report = await insights.getPipelineReport(manager, p.id);
    expect(report.totals.count).toBe(4);
    expect(report.statuses).toMatchObject({ open: { count: 3 }, won: { count: 1, values: [{ currencyCode: "INR", total: 3000 }] }, lost: { count: 0 }, winRate: 100 });
    expect(report.totals.values.find((v) => v.currencyCode === "INR")).toMatchObject({ total: 4999, count: 3 });
    const st = (n: string) => report.stages.find((s) => s.name === n)!;
    expect(st("Enquiry")).toMatchObject({ openCount: 2, reached: 4 });
    expect(st("Sampling")).toMatchObject({ openCount: 1, reached: 2 }); // mine1 + mine3 (went past it)
    expect(st("Costing")).toMatchObject({ reached: 1 });
    expect(st("Enquiry").conversionToNext).toBe(50);
    expect(st("Order")).toMatchObject({ reached: 0, conversionToNext: null, nextLabel: "Won" });
    const repReport = await insights.getPipelineReport(rep, p.id);
    expect(repReport.totals.count).toBe(3);
  });

  // ── Concurrency ──

  it("rejects a stage change made from a stale version", async () => {
    const p = await mkPipeline("Locking");
    const [enq, smp, cst] = await stagesOf(p.id);
    const o = await opps.createOpportunity(rep, { name: name("Lock deal"), pipelineId: p.id, stageId: enq.id });
    const v = (await raw(o.id)).version;
    await opps.changeOpportunityStage(rep, o.id, { stageId: smp.id, version: v });
    await expectCode(opps.changeOpportunityStage(rep, o.id, { stageId: cst.id, version: v }), "RECORD_VERSION_CONFLICT");
    expect((await raw(o.id)).stageId).toBe(smp.id);
    expect((await history(o.id)).length).toBe(2);
  });
});
