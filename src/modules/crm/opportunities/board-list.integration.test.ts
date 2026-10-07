/**
 * Opportunity Board + List (Phase 08) against a real, migrated + seeded
 * Postgres database: per-user preferences, the filtered board (totals,
 * weighted values, per-column paging, visibility), the stage-change path
 * drag and drop uses, bulk field updates with per-record results and the
 * bulk audit summary, and owner search / sort on the list.
 *
 * Skipped unless CRM_IT_DATABASE_URL points at a DISPOSABLE database:
 *   CRM_IT_DATABASE_URL=postgresql://…/crm_it npx vitest run src/modules/crm/opportunities/board-list.integration.test.ts
 *
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

describe.skipIf(!DB_URL)("CRM opportunity board + list (database integration)", async () => {
  const { prisma } = await import("@/core/db/client");
  const pipelines = await import("../pipelines/crm-pipelines.service");
  const insights = await import("../pipelines/crm-pipeline-insights.service");
  const opps = await import("./crm-opportunities.service");
  const prefs = await import("../preferences/crm-preferences.service");
  const customFields = await import("../custom-fields/crm-custom-fields.service");
  const { parseOpportunityFilterParams } = await import("./opportunity.schema");

  const run = `b${Date.now().toString(36)}`;
  let manager: Actor;
  let rep: Actor;
  let otherRep: Actor;
  const expectCode = (p: Promise<unknown>, code: string) => expect(p).rejects.toMatchObject({ code });
  /** Input rejected by schema validation (the API answers 400 VALIDATION_ERROR). */
  const expectInvalid = (p: Promise<unknown>) => expect(p).rejects.toMatchObject({ name: "ZodError" });
  const name = (n: string) => `${n} ${run}`;
  const raw = (id: string) => prisma.crmOpportunity.findUniqueOrThrow({ where: { id } });
  let n = 0;
  const mkPipeline = async (label: string) => {
    const p = (await pipelines.createPipeline(manager, {
      name: name(`${label} ${++n}`),
      stages: [
        { name: "Enquiry", probability: 10 },
        { name: "Sampling", probability: 30 },
        { name: "Costing", probability: 60 },
      ],
    })) as { id: string };
    return { id: p.id, stages: (await pipelines.getPipeline(manager.companyId, p.id)).stages };
  };

  beforeAll(async () => {
    const company = await prisma.company.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
    const mk = (u: string, full: string) => prisma.user.create({ data: { companyId: company.id, email: `${u}.${run}@crm-it.local`, passwordHash: "x", fullName: `${full} ${run}` } });
    const [m, r, o] = await Promise.all([mk("bmanager", "Meera Manager"), mk("brep", "Ravi Rep"), mk("bother", "Zoya Other")]);
    manager = { companyId: company.id, userId: m.id, branchId: null };
    rep = { companyId: company.id, userId: r.id, branchId: null };
    otherRep = { companyId: company.id, userId: o.id, branchId: null };
    viewAllUsers.add(m.id);
    await pipelines.ensureDefaultPipeline(company.id);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // ── Preferences ──

  it("stores preferences per user, validates keys and values, and ignores stale stored values", async () => {
    await prefs.setPreference(rep, "opportunities.board.cardFields", ["company", "amount", "cf:fabric"]);
    await prefs.setPreference(rep, "opportunities.mode", "board");
    await prefs.setPreference(rep, "opportunities.mode", "list"); // upsert, not a second row
    await prefs.setPreference(otherRep, "opportunities.mode", "board");
    expect(await prefs.getPreferences(rep, "opportunities.")).toEqual({ "opportunities.board.cardFields": ["company", "amount", "cf:fabric"], "opportunities.mode": "list" });
    expect(await prefs.getPreferences(rep, "opportunities.board.")).toEqual({ "opportunities.board.cardFields": ["company", "amount", "cf:fabric"] });
    expect(await prefs.getPreferences(otherRep, "opportunities.")).toEqual({ "opportunities.mode": "board" });
    expect(await prisma.crmUserPreference.count({ where: { userId: rep.userId } })).toBe(2);

    await expectCode(prefs.setPreference(rep, "secrets.apiKey", "x"), "VALIDATION_ERROR");
    await expect(prefs.setPreference(rep, "opportunities.mode", "kanban")).rejects.toThrow();
    await expect(prefs.setPreference(rep, "opportunities.list.defaultViewId", "not-a-uuid")).rejects.toThrow();

    // A value stored under an older shape is ignored, not returned.
    await prisma.crmUserPreference.update({ where: { userId_key: { userId: rep.userId, key: "opportunities.mode" } }, data: { value: { old: true } } });
    expect(await prefs.getPreferences(rep, "opportunities.")).not.toHaveProperty("opportunities.mode");
    await prefs.deletePreference(rep, "opportunities.board.cardFields");
    expect(await prefs.getPreferences(rep, "opportunities.board.")).toEqual({});
  });

  // ── Board ──

  it("builds board columns in stage order with count, value, weighted value and average from the filtered set", async () => {
    const p = await mkPipeline("Board");
    const [enq, smp] = p.stages;
    const a = await opps.createOpportunity(rep, { name: name("Shirts"), pipelineId: p.id, stageId: enq.id, amount: "1000", currencyCode: "INR", probability: 50, tagNames: [`hot-${run}`] });
    await opps.createOpportunity(rep, { name: name("Trousers"), pipelineId: p.id, stageId: enq.id, amount: "3000", currencyCode: "INR" }); // stage probability 10
    await opps.createOpportunity(rep, { name: name("No value"), pipelineId: p.id, stageId: enq.id });
    await opps.createOpportunity(rep, { name: name("Export"), pipelineId: p.id, stageId: smp.id, amount: "200", currencyCode: "USD" });
    await opps.createOpportunity(otherRep, { name: name("Hidden from rep"), pipelineId: p.id, stageId: smp.id, amount: "999", currencyCode: "INR" });

    const board = await insights.getPipelineBoard(manager, p.id, {});
    expect(board.stages.map((s) => s.name)).toEqual(["Enquiry", "Sampling", "Costing"]);
    const col = (b: typeof board, s: string) => b.stages.find((x) => x.name === s)!;
    expect(col(board, "Enquiry")).toMatchObject({ count: 3, hasMore: false, values: [{ currencyCode: "INR", total: 4000, weighted: 800, average: 2000 }] });
    expect(col(board, "Sampling").values).toEqual(expect.arrayContaining([{ currencyCode: "USD", total: 200, weighted: 60, average: 200 }, { currencyCode: "INR", total: 999, weighted: 299.7, average: 999 }]));
    expect(col(board, "Costing")).toMatchObject({ count: 0, values: [], records: [] });
    const card = col(board, "Enquiry").records.find((r) => r.id === a.id)!;
    expect(card).toMatchObject({ name: name("Shirts"), amount: "1000", probability: 50, ownerInactive: false, owner: { id: rep.userId } });
    expect(card.tags.map((t) => t.name)).toEqual([`hot-${run}`]);
    expect(card).toHaveProperty("customFields");

    // Visibility: a rep only sees (and totals) their own deals.
    expect(col(await insights.getPipelineBoard(rep, p.id, {}), "Sampling")).toMatchObject({ count: 1, values: [expect.objectContaining({ currencyCode: "USD", total: 200 })] });
    // Filters are the list's filters, applied server-side to cards and totals alike.
    const tagId = card.tags[0].id;
    expect(col(await insights.getPipelineBoard(manager, p.id, { tagIds: tagId }), "Enquiry")).toMatchObject({ count: 1, values: [expect.objectContaining({ total: 1000 })] });
    expect(col(await insights.getPipelineBoard(manager, p.id, { amountMin: "2000" }), "Enquiry").count).toBe(1);
    expect(col(await insights.getPipelineBoard(manager, p.id, { search: "Ravi Rep" }), "Sampling").count).toBe(1); // owner name search
    expect(col(await insights.getPipelineBoard(manager, p.id, { ownerUserIds: otherRep.userId }), "Enquiry").count).toBe(0);
    expect(col(await insights.getPipelineBoard(manager, p.id, { ownerUserId: otherRep.userId }), "Sampling").count).toBe(1); // legacy param
    // A pipelineIds filter can't widen the board to another pipeline.
    const other = await mkPipeline("Elsewhere");
    expect((await insights.getPipelineBoard(manager, p.id, { pipelineIds: other.id })).stages.reduce((s, c) => s + c.count, 0)).toBe(5);
    await expectInvalid(insights.getPipelineBoard(manager, p.id, { amountMin: "abc" }));
  });

  it("pages one column at a time (stageId + offset) without duplicates", async () => {
    const p = await mkPipeline("Paging");
    const [enq] = p.stages;
    for (let i = 0; i < 5; i++) await opps.createOpportunity(rep, { name: name(`Page ${i}`), pipelineId: p.id, stageId: enq.id });
    const first = await insights.getPipelineBoard(rep, p.id, { perStage: "2" });
    const firstCol = first.stages.find((s) => s.id === enq.id)!;
    expect(firstCol).toMatchObject({ count: 5, hasMore: true });
    const seen = firstCol.records.map((r) => r.id);
    let offset = seen.length;
    for (;;) {
      const next = await insights.getPipelineBoard(rep, p.id, { perStage: "2", stageId: enq.id, offset: String(offset) });
      expect(next.stages.map((s) => s.id)).toEqual([enq.id]); // only the requested column
      seen.push(...next.stages[0].records.map((r) => r.id));
      offset += next.stages[0].records.length;
      if (!next.stages[0].hasMore) break;
    }
    expect(new Set(seen).size).toBe(5);
  });

  // ── Drag and drop path: the Phase 07 stage endpoint decides ──

  it("a drop goes through the transition engine: required fields block it, a stale version conflicts, a valid move records history", async () => {
    const p = await mkPipeline("Drag");
    const [enq, smp, cst] = p.stages;
    await pipelines.updateStageRequiredFields(manager, p.id, cst.id, { version: cst.version, requiredFields: ["amount", "expectedCloseDate"] });
    const o = await opps.createOpportunity(rep, { name: name("Drag deal"), pipelineId: p.id, stageId: enq.id });
    const v1 = (await raw(o.id)).version;

    await expect(opps.changeOpportunityStage(rep, o.id, { stageId: cst.id, pipelineId: p.id, version: v1 })).rejects.toMatchObject({
      code: "CRM_STAGE_TRANSITION_BLOCKED",
      details: { missingFields: [expect.objectContaining({ key: "amount" }), expect.objectContaining({ key: "expectedCloseDate" })] },
    });
    expect((await raw(o.id)).stageId).toBe(enq.id);

    await opps.changeOpportunityStage(rep, o.id, { stageId: smp.id, pipelineId: p.id, version: v1 });
    await expectCode(opps.changeOpportunityStage(rep, o.id, { stageId: enq.id, pipelineId: p.id, version: v1 }), "RECORD_VERSION_CONFLICT");
    const after = await raw(o.id);
    expect(after).toMatchObject({ stageId: smp.id, probability: 30 });
    const hist = await prisma.crmOpportunityStageHistory.findMany({ where: { opportunityId: o.id }, orderBy: { changedAt: "asc" } });
    expect(hist.map((h) => h.toStageId)).toEqual([enq.id, smp.id]);
    const board = await insights.getPipelineBoard(rep, p.id, {});
    expect(board.stages.find((s) => s.id === smp.id)!.records.map((r) => r.id)).toContain(o.id);
  });

  // ── Bulk ──

  it("bulk-updates safe fields record by record, merges custom fields, reports each skip and writes one audit summary", async () => {
    const key = `fabric_${run}`;
    await customFields.createCustomField(manager, "OPPORTUNITY", { label: `Fabric ${run}`, key, fieldType: "TEXT" });
    const source = await prisma.crmLeadSource.findFirst({ where: { companyId: manager.companyId, isActive: true } });
    const a = await opps.createOpportunity(rep, { name: name("Bulk A"), customFields: { [key]: "cotton" } });
    const b = await opps.createOpportunity(rep, { name: name("Bulk B") });
    const archived = await opps.createOpportunity(rep, { name: name("Bulk archived") });
    await opps.archiveOpportunity(rep, archived.id);
    const hidden = await opps.createOpportunity(otherRep, { name: name("Bulk hidden") });

    const res = await opps.bulkOpportunityAction(rep, {
      action: "update",
      ids: [a.id, b.id, archived.id, hidden.id],
      fields: { expectedCloseDate: "2026-12-31", ...(source ? { sourceId: source.id } : {}), customFields: { [key]: "linen" } },
    });
    expect(res).toMatchObject({ requested: 4, updated: 2 });
    const skips = Object.fromEntries(res.skipped.map((s) => [s.id, s]));
    expect(skips[archived.id]).toMatchObject({ reason: "Archived", label: expect.stringContaining(name("Bulk archived")) });
    expect(skips[hidden.id]).toMatchObject({ reason: "Not found or not visible to you", label: null }); // never leaks a hidden record's name
    const ra = await raw(a.id);
    expect(ra.expectedCloseDate?.toISOString().slice(0, 10)).toBe("2026-12-31");
    expect(ra.customFields).toMatchObject({ [key]: "linen" });
    if (source) expect(ra.sourceId).toBe(source.id);
    // Each record keeps its own audit row; the operation adds one summary row.
    expect(await prisma.auditLog.count({ where: { tableName: "crm_opportunities", recordId: a.id, action: "UPDATE" } })).toBeGreaterThan(0);
    const summary = await prisma.auditLog.findFirstOrThrow({ where: { tableName: "crm_opportunities", recordId: res.operationId } });
    expect(summary.userId).toBe(rep.userId);
    expect(summary.newValues).toMatchObject({ bulkOperation: "update", requested: 4, updated: 2, failed: 2, opportunityIds: expect.arrayContaining([a.id, b.id]) });
    expect((summary.newValues as { failures: { id: string; reason: string }[] }).failures).toEqual(expect.arrayContaining([{ id: archived.id, reason: "Archived" }]));

    // Unknown fields are refused outright — only the safe set can be bulk-edited.
    await expectInvalid(opps.bulkOpportunityAction(rep, { action: "update", ids: [a.id], fields: { amount: "5" } }));
    await expectInvalid(opps.bulkOpportunityAction(rep, { action: "update", ids: [a.id], fields: {} }));
    // Same values again: nothing to change.
    const again = await opps.bulkOpportunityAction(rep, { action: "update", ids: [a.id], fields: { expectedCloseDate: "2026-12-31" } });
    expect(again).toMatchObject({ updated: 0, skipped: [expect.objectContaining({ reason: "Nothing to change" })] });

    const arch = await opps.bulkOpportunityAction(rep, { action: "archive", ids: [archived.id, b.id] });
    expect(arch).toMatchObject({ updated: 1, skipped: [expect.objectContaining({ id: archived.id, reason: "Already archived" })] });
  });

  it("bulk stage change validates every record through the transition engine and audits the outcome", async () => {
    const p = await mkPipeline("Bulk stage");
    const [enq, smp] = p.stages;
    await pipelines.updateStageRequiredFields(manager, p.id, smp.id, { version: smp.version, requiredFields: ["amount"] });
    const ok = await opps.createOpportunity(rep, { name: name("BS ok"), pipelineId: p.id, stageId: enq.id, amount: "10" });
    const blocked = await opps.createOpportunity(rep, { name: name("BS blocked"), pipelineId: p.id, stageId: enq.id });
    const res = await opps.bulkOpportunityAction(rep, { action: "stage", ids: [ok.id, blocked.id], stageId: smp.id });
    expect(res).toMatchObject({ requested: 2, updated: 1, skipped: [{ id: blocked.id, reason: "Missing Estimated value", label: expect.stringContaining(name("BS blocked")) }] });
    const summary = await prisma.auditLog.findFirstOrThrow({ where: { tableName: "crm_opportunities", recordId: res.operationId } });
    expect(summary.newValues).toMatchObject({ bulkOperation: "stage", updated: 1, failed: 1 });
  });

  // ── List ──

  it("searches and sorts the list by owner name", async () => {
    await opps.createOpportunity(rep, { name: name("Owner sort R") });
    await opps.createOpportunity(otherRep, { name: name("Owner sort Z") });
    await opps.createOpportunity(manager, { name: name("Owner sort M") });
    const filter = parseOpportunityFilterParams(new URLSearchParams({ search: "Owner sort" }));
    const asc = await opps.listOpportunities(manager, { ...filter, search: `${run}` }, { sortBy: "owner", sortOrder: "asc" }, { skip: 0, take: 200 });
    const owners = asc.data.filter((r) => r.name.startsWith("Owner sort")).map((r) => r.owner?.fullName);
    expect(owners).toEqual([`Meera Manager ${run}`, `Ravi Rep ${run}`, `Zoya Other ${run}`]);
    const byOwner = await opps.listOpportunities(manager, parseOpportunityFilterParams(new URLSearchParams({ search: `Zoya Other ${run}` })), { sortBy: "createdAt", sortOrder: "desc" }, { skip: 0, take: 50 });
    expect(byOwner.data.map((r) => r.name)).toContain(name("Owner sort Z"));
    expect(byOwner.data.every((r) => r.owner?.id === otherRep.userId)).toBe(true);
  });
});
