/**
 * Audience segments (Phase 09) against a real, migrated + seeded Postgres
 * database. Skipped unless CRM_IT_DATABASE_URL points at a DISPOSABLE database.
 *
 * "owner" has view_all and owns everything; "outsider" sees only their own records.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const DB_URL = process.env.CRM_IT_DATABASE_URL;
if (DB_URL) process.env.DATABASE_URL = DB_URL;

const viewAll = new Set<string>();
vi.mock("@/core/rbac/PermissionService", () => ({
  PermissionService: {
    can: vi.fn(async (userId: string, _module: string, action: string, ctx?: { createdBy?: string }) => {
      if (action === "view_all") return viewAll.has(userId);
      if (action === "approve" && ctx?.createdBy === userId) return false;
      return true;
    }),
    assert: vi.fn(async () => undefined),
    assertAny: vi.fn(async () => undefined),
    getAllowedBranchIds: vi.fn(async () => null),
    invalidate: vi.fn(),
  },
}));

type Actor = { companyId: string; userId: string; branchId: string | null };

describe.skipIf(!DB_URL)("Audience segments (database integration)", async () => {
  const { prisma } = await import("@/core/db/client");
  const segs = await import("./segment.service");
  const evals = await import("./segment-evaluation.service");
  const audience = await import("./campaign-audience.service");
  const campaigns = await import("@/modules/sales-marketing/campaigns/campaign.service");
  const lookups = await import("@/modules/sales-marketing/campaigns/campaign-lookup.service");

  const run = `s${Date.now().toString(36)}`;
  let owner: Actor, outsider: Actor;
  const c: Record<"ok" | "noEmail" | "dnc" | "ruleExcl" | "manualExcl" | "other", string> = { ok: "", noEmail: "", dnc: "", ruleExcl: "", manualExcl: "", other: "" };
  let dynamicId = "";
  let staticId = "";
  const crit = (value: string) => ({ match: "ALL", groups: [{ match: "ALL", conditions: [{ field: "fullName", operator: "contains", value }] }] });
  const expectCode = (p: Promise<unknown>, code: string) => expect(p).rejects.toMatchObject({ code });
  const evaluate = async (id: string, actor = owner) => {
    const { evaluation } = await evals.requestSegmentEvaluation(actor, id, {});
    return { id: evaluation.id, ...(await evals.runSegmentEvaluation(evaluation.id)) };
  };

  beforeAll(async () => {
    const company = await prisma.company.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
    const mk = (n: string) => prisma.user.create({ data: { companyId: company.id, email: `${n}.${run}@seg-it.local`, passwordHash: "x", fullName: `${n} ${run}` } });
    const [o, x] = await Promise.all([mk("Owner"), mk("Outsider")]);
    owner = { companyId: company.id, userId: o.id, branchId: null };
    outsider = { companyId: company.id, userId: x.id, branchId: null };
    viewAll.add(o.id);
    const contact = (key: keyof typeof c, name: string, email: string | null) =>
      prisma.crmContact.create({ data: { companyId: company.id, firstName: name, fullName: `${name} ${run}`, email, ownerUserId: o.id, createdByUserId: o.id } }).then((r) => (c[key] = r.id));
    await contact("ok", "Asha", `asha@${run}.it`);
    await contact("noEmail", "Bina", null);
    await contact("dnc", "Chetan", `chetan@${run}.it`);
    await contact("ruleExcl", "Exclude Dev", `dev@${run}.it`);
    await contact("manualExcl", "Esha", `esha@${run}.it`);
    await contact("other", "Farah", `farah@${run}.it`);
    // Owned by the outsider -> they can see it, nobody restricted can see the rest.
    await prisma.crmContact.update({ where: { id: c.other }, data: { ownerUserId: x.id } });
    await prisma.crmContactConsent.create({ data: { companyId: company.id, contactId: c.dnc, channel: "EMAIL", status: "DO_NOT_CONTACT" } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("rejects unsafe definitions and keeps segments private", async () => {
    const base = { code: `dyn-${run}`, name: `Dynamic ${run}`, sourceType: "CONTACT", segmentType: "DYNAMIC", ownerUserId: owner.userId, eligibilityChannel: "EMAIL" };
    await expectCode(segs.createSegment(owner, { ...base, criteria: { match: "ALL", groups: [{ match: "ALL", conditions: [{ field: "passwordHash", operator: "equals", value: "x" }] }] } }), "VALIDATION_ERROR");
    const seg = await segs.createSegment(owner, { ...base, criteria: crit(run), exclusionCriteria: crit("Exclude"), idempotencyKey: `seg-${run}-0001` });
    expect((await segs.createSegment(owner, { ...base, criteria: crit(run), idempotencyKey: `seg-${run}-0001` })).id).toBe(seg.id);
    dynamicId = seg.id;
    await expectCode(segs.getSegment(outsider, dynamicId), "NOT_FOUND");
    expect((await segs.getSegment(owner, dynamicId)).status).toBe("DRAFT");
  });

  it("live preview classifies each record once and writes nothing", async () => {
    await segs.addSegmentMembers(owner, dynamicId, { recordIds: [c.manualExcl], kind: "EXCLUDED", reason: "Asked us to stop" });
    // A dynamic segment can't take hand-picked members.
    await expectCode(segs.addSegmentMembers(owner, dynamicId, { recordIds: [c.ok], kind: "INCLUDED" }), "VALIDATION_ERROR");
    const p = await segs.previewSegment(owner, dynamicId, {});
    expect(p.counts).toEqual({ matched: 6, members: 2, excluded: 2, ineligible: 2 });
    expect(p.consentCheck).toBe("VERIFIED");
    expect(new Set(p.rows.map((r) => r.id))).toEqual(new Set([c.ok, c.other]));
    const ineligible = await segs.previewSegment(owner, dynamicId, { show: "ineligible" });
    expect(Object.fromEntries(ineligible.rows.map((r) => [r.id, r.reason]))).toEqual({ [c.noEmail]: "NO_ADDRESS", [c.dnc]: "CONSENT_RESTRICTED" });
    expect(await prisma.marketingSegmentEvaluation.count({ where: { segmentId: dynamicId } })).toBe(0);
  });

  it("evaluates into a snapshot; one evaluation at a time; a definition change supersedes the queued one", async () => {
    const first = await evaluate(dynamicId);
    expect(first).toMatchObject({ status: "COMPLETED", memberCount: 2 });
    const snap = await evals.getSegmentEvaluation(owner, first.id);
    expect(snap).toMatchObject({ status: "COMPLETED", versionNumber: 1 });
    const entries = await evals.listSnapshotEntries(owner, first.id, "EXCLUDED");
    expect(Object.fromEntries(entries.data.map((r: { id: string; reason: string | null }) => [r.id, r.reason]))).toEqual({ [c.ruleExcl]: "EXCLUSION_RULE", [c.manualExcl]: "MANUAL_EXCLUSION" });
    expect((await prisma.marketingSegment.findUniqueOrThrow({ where: { id: dynamicId } })).memberCount).toBe(2);

    const a = await evals.requestSegmentEvaluation(owner, dynamicId, {});
    const b = await evals.requestSegmentEvaluation(owner, dynamicId, {});
    expect([a.created, b.created, b.evaluation.id]).toEqual([true, false, a.evaluation.id]);
    const seg = await prisma.marketingSegment.findUniqueOrThrow({ where: { id: dynamicId } });
    await segs.saveSegmentDefinition(owner, dynamicId, { criteria: crit(run), exclusionCriteria: crit("Exclude"), eligibilityChannel: null, version: seg.version, changeNote: "Drop the channel check" });
    expect((await prisma.marketingSegmentEvaluation.findUniqueOrThrow({ where: { id: a.evaluation.id } })).status).toBe("SUPERSEDED");
    expect((await evals.runSegmentEvaluation(a.evaluation.id)).status).toBe("SKIPPED");
    // The older snapshot keeps its own entries and version.
    expect((await evals.listSnapshotEntries(owner, first.id, "INCLUDED")).data).toHaveLength(2);
    const second = await evaluate(dynamicId);
    expect(second).toMatchObject({ status: "COMPLETED", memberCount: 4 }); // no channel check: no-email + DNC count now
    expect((await evals.getSegmentEvaluation(owner, second.id)).versionNumber).toBe(2);
  });

  it("restricted users only get records they can see", async () => {
    // Outsider's own copy of the rules: only the contact they own.
    const own = await segs.createSegment(outsider, { code: `own-${run}`, name: `Mine ${run}`, sourceType: "CONTACT", segmentType: "DYNAMIC", ownerUserId: outsider.userId, criteria: crit(run) });
    expect((await segs.previewSegment(outsider, own.id, {})).counts.members).toBe(1);
    expect(await evaluate(own.id, outsider)).toMatchObject({ status: "COMPLETED", memberCount: 1 });
  });

  it("static segments: hand-picked members, deleted records excluded, retention keeps pinned/kept snapshots", async () => {
    const seg = await segs.createSegment(owner, { code: `stat-${run}`, name: `Static ${run}`, sourceType: "CONTACT", segmentType: "STATIC", ownerUserId: owner.userId });
    staticId = seg.id;
    await segs.addSegmentMembers(owner, staticId, { recordIds: [c.ok, c.noEmail], kind: "INCLUDED" });
    await segs.addSegmentMembers(owner, staticId, { recordIds: [c.ok], kind: "INCLUDED" }); // no duplicate
    expect((await segs.listSegmentMembers(owner, staticId, "INCLUDED")).meta.totalCount).toBe(2);
    const kept = await evals.requestSegmentEvaluation(owner, staticId, { keep: true, label: "Launch list" });
    expect(await evals.runSegmentEvaluation(kept.evaluation.id)).toMatchObject({ status: "COMPLETED", memberCount: 2 });

    for (let i = 0; i < 6; i++) await evaluate(staticId);
    const all = await prisma.marketingSegmentEvaluation.findMany({ where: { segmentId: staticId, status: "COMPLETED" }, orderBy: { finishedAt: "asc" } });
    expect(all).toHaveLength(7);
    const purged = all.filter((e) => e.entriesPurgedAt);
    expect(purged.length).toBe(1);
    expect(purged[0].id).not.toBe(kept.evaluation.id);
    expect(all.find((e) => e.id === kept.evaluation.id)!.entriesPurgedAt).toBeNull();
    await expectCode(evals.listSnapshotEntries(owner, purged[0].id, "INCLUDED"), "INVALID_STATE_TRANSITION");

    // Archive a member in the CRM: next snapshot excludes it, the old one is unchanged.
    await prisma.crmContact.update({ where: { id: c.noEmail }, data: { archivedAt: new Date() } });
    const after = await evaluate(staticId);
    expect(after).toMatchObject({ status: "COMPLETED", memberCount: 1 });
    const excluded = await evals.listSnapshotEntries(owner, after.id, "EXCLUDED");
    expect(excluded.data.map((r: { reason: string | null }) => r.reason)).toEqual(["SOURCE_UNAVAILABLE"]);
    expect((await evals.getSegmentEvaluation(owner, kept.evaluation.id)).memberCount).toBe(2);
    await prisma.crmContact.update({ where: { id: c.noEmail }, data: { archivedAt: null } });
  });

  it("campaign audience: include + exclude segments from snapshots, de-duplicated; archive is blocked while used", async () => {
    const list = await lookups.listCampaignLookups(owner, {});
    const typeId = list.find((l) => l.kind === "TYPE")!.id;
    const objectiveId = list.find((l) => l.kind === "OBJECTIVE")!.id;
    const camp = await campaigns.createCampaign(owner, { code: `aud-${run}`, name: `Audience ${run}`, typeId, objectiveId, ownerUserId: owner.userId, plannedStartDate: new Date().toISOString().slice(0, 10), plannedEndDate: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10) });
    // Only active segments.
    await expectCode(audience.addCampaignAudience(owner, camp.id, { segmentId: dynamicId, role: "INCLUDE" }), "VALIDATION_ERROR");
    await segs.segmentAction(owner, dynamicId, "activate", {});
    await segs.segmentAction(owner, staticId, "activate", {});

    await audience.addCampaignAudience(owner, camp.id, { segmentId: dynamicId, role: "INCLUDE", pinLatest: true });
    await audience.addCampaignAudience(owner, camp.id, { segmentId: staticId, role: "INCLUDE" });
    let a = await audience.getCampaignAudience(owner, camp.id);
    // dynamic v2: ok, other, noEmail, dnc (4) + static latest: ok (1) -> 5 rows, 4 people.
    expect(a.summary).toEqual({ audience: 4, includedTotal: 5, duplicatesRemoved: 1, removedByExclusions: 0 });
    expect(a.items.find((i) => i.segment.id === dynamicId)!.pinned).toBe(true);

    const staticRow = a.items.find((i) => i.segment.id === staticId)!;
    await audience.removeCampaignAudience(owner, camp.id, staticRow.id);
    await audience.addCampaignAudience(owner, camp.id, { segmentId: staticId, role: "EXCLUDE" });
    a = await audience.getCampaignAudience(owner, camp.id);
    expect(a.summary).toEqual({ audience: 3, includedTotal: 4, duplicatesRemoved: 0, removedByExclusions: 1 });
    expect(a.consentNote).toMatch(/not permission to contact/); // v2 dropped the channel check

    await expectCode(segs.segmentAction(owner, staticId, "archive", {}), "REFERENCED_RECORD_IN_USE");
    // A segment of another record type can't join this audience.
    const companies = await segs.createSegment(owner, { code: `co-${run}`, name: `Companies ${run}`, sourceType: "COMPANY", segmentType: "DYNAMIC", ownerUserId: owner.userId, criteria: { match: "ALL", groups: [] } });
    await segs.segmentAction(owner, companies.id, "activate", {});
    await expectCode(audience.addCampaignAudience(owner, camp.id, { segmentId: companies.id, role: "EXCLUDE" }), "VALIDATION_ERROR");
    // Selecting an audience never sends anything or touches the records.
    expect(await prisma.crmContact.count({ where: { id: { in: Object.values(c) }, archivedAt: { not: null } } })).toBe(0);
  });
});
