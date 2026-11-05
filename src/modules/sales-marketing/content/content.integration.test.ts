/**
 * Content library (Phase 11) against a real, migrated + seeded Postgres
 * database, with files in a temporary storage folder and the email provider
 * mocked. Skipped unless CRM_IT_DATABASE_URL points at a DISPOSABLE database.
 */
import { mkdtempSync, readdirSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const DB_URL = process.env.CRM_IT_DATABASE_URL;
if (DB_URL) process.env.DATABASE_URL = DB_URL;
const STORAGE = mkdtempSync(path.join(tmpdir(), "mkt-assets-"));
process.env.FILE_STORAGE_ROOT = STORAGE;
process.env.APP_BASE_URL = "https://erp.example.com";
process.env.AUTH_SECRET ||= "integration-test-secret-integration-1234";
delete process.env.REDIS_URL;

vi.mock("@/core/rbac/PermissionService", () => ({
  PermissionService: {
    can: vi.fn(async () => true),
    assert: vi.fn(async () => undefined),
    assertAny: vi.fn(async () => undefined),
    getAllowedBranchIds: vi.fn(async () => null),
    invalidate: vi.fn(),
  },
}));

type Actor = { companyId: string; userId: string; branchId: string | null };

describe.skipIf(!DB_URL)("Content library (database integration)", async () => {
  const { prisma } = await import("@/core/db/client");
  const assets = await import("./asset.service");
  const reviews = await import("./content-review.service");
  const contents = await import("./campaign-content.service");
  const templates = await import("./marketing-template.service");
  const resolver = await import("./content-resolver");
  const connections = await import("@/modules/sales-marketing/delivery/connection.service");
  const runs = await import("@/modules/sales-marketing/delivery/delivery-run.service");
  const engine = await import("@/modules/sales-marketing/delivery/delivery-engine");
  const segs = await import("@/modules/sales-marketing/segments/segment.service");
  const evals = await import("@/modules/sales-marketing/segments/segment-evaluation.service");
  const audience = await import("@/modules/sales-marketing/segments/campaign-audience.service");
  const campaigns = await import("@/modules/sales-marketing/campaigns/campaign.service");
  const lookups = await import("@/modules/sales-marketing/campaigns/campaign-lookup.service");

  const run = `c${Date.now().toString(36)}`;
  let author: Actor, approver: Actor;
  const stranger: Actor = { companyId: "00000000-0000-4000-8000-000000000000", userId: "00000000-0000-4000-8000-000000000001", branchId: null };
  let png: Buffer, png2: Buffer, pdf: Buffer;
  let logoId = "", logoV1 = "", logoV2 = "", pdfAssetId = "", pdfV1 = "";
  let templateId = "", templateV1 = "", campaignId = "", contentId = "", channelId = "", connectionId = "";
  const contacts: Record<"withRole" | "noRole", string> = { withRole: "", noRole: "" };
  const expectCode = (p: Promise<unknown>, code: string) => expect(p).rejects.toMatchObject({ code });
  const approve = (type: "ASSET_VERSION" | "TEMPLATE_VERSION" | "CONTENT_VERSION", id: string) => reviews.reviewVersion(author, type, id, "submit", {}).then(() => reviews.reviewVersion(approver, type, id, "approve", {}));

  const sent: { to: string; body: string; attachment?: { name: string; content: string }[] }[] = [];
  const fakeFetch = (async (_u: string, init: RequestInit) => {
    const b = JSON.parse(String(init.body));
    sent.push({ to: b.to[0].email, body: b.textContent, attachment: b.attachment });
    return new Response(JSON.stringify({ messageId: `<${sent.length}@relay>` }), { status: 201 });
  }) as unknown as typeof fetch;
  const deps = { fetch: fakeFetch, now: () => new Date(), sleep: async () => undefined, schedule: async () => true };

  beforeAll(async () => {
    png = await sharp({ create: { width: 40, height: 20, channels: 3, background: "#cc3300" } }).png().toBuffer();
    png2 = await sharp({ create: { width: 80, height: 40, channels: 3, background: "#0033cc" } }).png().toBuffer();
    pdf = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
    const company = await prisma.company.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
    const mk = (n: string) => prisma.user.create({ data: { companyId: company.id, email: `${n}.${run}@content-it.local`, passwordHash: "x", fullName: `${n} ${run}` } });
    const [a, b] = await Promise.all([mk("Author"), mk("Approver")]);
    author = { companyId: company.id, userId: a.id, branchId: null };
    approver = { companyId: company.id, userId: b.id, branchId: null };
    const contact = (key: keyof typeof contacts, name: string, designation: string | null) =>
      prisma.crmContact.create({ data: { companyId: company.id, firstName: name, fullName: `${name} ${run}`, email: `${key}.${run}@example.com`, designation, ownerUserId: a.id, createdByUserId: a.id } }).then((r) => (contacts[key] = r.id));
    await contact("withRole", "Asha", "Buyer");
    await contact("noRole", "Bina", null);
    const seg = await segs.createSegment(author, { code: `cnt-${run}`, name: `Content ${run}`, sourceType: "CONTACT", segmentType: "STATIC", ownerUserId: a.id });
    await segs.addSegmentMembers(author, seg.id, { recordIds: Object.values(contacts), kind: "INCLUDED" });
    const ev = await evals.requestSegmentEvaluation(author, seg.id, {});
    await evals.runSegmentEvaluation(ev.evaluation.id);
    await segs.segmentAction(author, seg.id, "activate", {});
    const list = await lookups.listCampaignLookups(author, {});
    const camp = await campaigns.createCampaign(author, { code: `cnt-${run}`, name: `Content ${run}`, typeId: list.find((l) => l.kind === "TYPE")!.id, objectiveId: list.find((l) => l.kind === "OBJECTIVE")!.id, ownerUserId: a.id, plannedStartDate: new Date().toISOString().slice(0, 10), plannedEndDate: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10) });
    campaignId = camp.id;
    await audience.addCampaignAudience(author, campaignId, { segmentId: seg.id, role: "INCLUDE", pinLatest: true });
    const t = await prisma.crmMessageTemplate.create({ data: { companyId: company.id, name: `Offer ${run}`, nameKey: `offer ${run}`, channelType: "EMAIL", status: "DRAFT", createdByUserId: a.id } });
    const v = await prisma.crmMessageTemplateVersion.create({ data: { companyId: company.id, templateId: t.id, versionNumber: 1, subject: "Hello {{contact.first_name|there}}", body: "Hi {{contact.first_name|there}}, our new range is in.", variables: ["contact.first_name"], createdByUserId: a.id } });
    await prisma.crmMessageTemplate.update({ where: { id: t.id }, data: { currentVersionId: v.id, currentVersionNumber: 1, status: "ACTIVE", activatedAt: new Date(), activatedByUserId: a.id } });
    templateId = t.id;
    templateV1 = v.id;
    const conn = await connections.createConnection(approver, { code: `BRV-${run}`.toUpperCase().slice(0, 30), name: `Brevo ${run}`, providerKey: "BREVO", config: { fromEmail: "news@example.com" }, secrets: { apiKey: "xkeysib-test-1234567890" }, ratePerMinute: 600 });
    connectionId = conn.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("uploads: content-checked, random storage key, metadata and dimensions; bad files refused", async () => {
    const { asset } = await assets.createAsset(author, { name: `Logo ${run}`, assetType: "LOGO", tags: ["Brand"], altText: "Red logo" }, { buffer: png, fileName: "../../logo.png", mimeType: "image/png" });
    logoId = asset.id;
    logoV1 = asset.versions[0].id;
    expect(asset).toMatchObject({ assetType: "LOGO", tags: ["brand"], status: "ACTIVE" });
    expect(asset.code).toMatch(/^AST-\d{5}$/);
    expect(asset.versions[0]).toMatchObject({ versionNumber: 1, fileName: "logo.png", width: 40, height: 20, scanStatus: "NOT_SCANNED", review: "DRAFT" });
    const row = await prisma.marketingAssetVersion.findUniqueOrThrow({ where: { id: logoV1 } });
    expect(row.storageKey).toMatch(/^[0-9a-f-]{36}\.png$/);
    expect(readdirSync(STORAGE)).toContain(row.storageKey);
    // Wrong / disguised / dangerous files.
    await expectCode(assets.createAsset(author, { name: "x", assetType: "IMAGE" }, { buffer: pdf, fileName: "fake.png", mimeType: "image/png" }), "VALIDATION_ERROR");
    await expectCode(assets.createAsset(author, { name: "x", assetType: "IMAGE" }, { buffer: Buffer.from("<svg onload=alert(1)></svg>"), fileName: "x.svg", mimeType: "image/svg+xml" }), "VALIDATION_ERROR");
    await expectCode(assets.createAsset(author, { name: "x", assetType: "DOCUMENT" }, { buffer: Buffer.from("MZ\x90\x00binary"), fileName: "x.pdf", mimeType: "application/pdf" }), "VALIDATION_ERROR");
    await expectCode(assets.createAsset(author, { name: "x", assetType: "IMAGE" }, { buffer: Buffer.from("<html><script>x</script>"), fileName: "x.html", mimeType: "text/html" }), "VALIDATION_ERROR");
    const files = readdirSync(STORAGE).length;
    expect(files).toBe(1); // refused uploads left nothing behind
    const doc = await assets.createAsset(author, { name: `Brochure ${run}`, assetType: "DOCUMENT" }, { buffer: pdf, fileName: "brochure.pdf", mimeType: "application/pdf" });
    pdfAssetId = doc.asset.id;
    pdfV1 = doc.asset.versions[0].id;
    // Tenant isolation.
    await expectCode(assets.getAsset(stranger, logoId), "NOT_FOUND");
    await expectCode(assets.readAssetVersionFile(stranger, logoV1), "NOT_FOUND");
    expect((await assets.readAssetVersionFile(author, logoV1)).buffer.equals(png)).toBe(true);
    // Search by tag and text.
    expect((await assets.listAssets(author, { tag: "brand", search: run })).data.map((a) => a.id)).toEqual([logoId]);
  });

  it("versions are immutable; replacing a file adds a version and keeps history", async () => {
    await expect(prisma.marketingAssetVersion.update({ where: { id: logoV1 }, data: { mimeType: "text/html" } })).rejects.toThrow(/immutable/);
    await expectCode(assets.addAssetVersion(author, logoId, { buffer: png, fileName: "same.png", mimeType: "image/png" }, null), "VALIDATION_ERROR");
    const { asset } = await assets.addAssetVersion(author, logoId, { buffer: png2, fileName: "logo-v2.png", mimeType: "image/png" }, "Bigger");
    logoV2 = asset.versions[0].id;
    expect(asset.versions.map((v) => v.versionNumber)).toEqual([2, 1]);
    expect(asset.currentVersionId).toBe(logoV2);
    // A PDF can't replace a logo.
    await expectCode(assets.addAssetVersion(author, logoId, { buffer: pdf, fileName: "x.pdf", mimeType: "application/pdf" }, null), "VALIDATION_ERROR");
  });

  it("reviews: the author can't decide; approval is per version and final", async () => {
    await reviews.reviewVersion(author, "ASSET_VERSION", logoV1, "submit", {});
    await expectCode(reviews.reviewVersion(author, "ASSET_VERSION", logoV1, "approve", {}), "SELF_APPROVAL_NOT_ALLOWED");
    await expectCode(reviews.reviewVersion(approver, "ASSET_VERSION", logoV1, "reject", {}), "VALIDATION_ERROR"); // needs a reason
    await reviews.reviewVersion(approver, "ASSET_VERSION", logoV1, "approve", { comment: "Fine" });
    await expectCode(reviews.reviewVersion(approver, "ASSET_VERSION", logoV1, "reject", { comment: "Changed my mind" }), "INVALID_STATE_TRANSITION");
    await expectCode(reviews.reviewVersion(stranger, "ASSET_VERSION", logoV1, "approve", {}), "NOT_FOUND");
    expect((await assets.getAsset(author, logoId)).approvedVersionId).toBe(logoV1);
    // The DB itself refuses an author decision and changes to a decided review.
    const r = await prisma.marketingContentReview.findFirstOrThrow({ where: { subjectId: logoV1 } });
    await expect(prisma.marketingContentReview.update({ where: { id: r.id }, data: { status: "REJECTED" } })).rejects.toThrow(/decided review/);
    await reviews.reviewVersion(author, "ASSET_VERSION", logoV2, "submit", {});
    await reviews.reviewVersion(approver, "ASSET_VERSION", logoV2, "request_changes", { comment: "Too blue" });
    expect((await assets.getAsset(author, logoId)).approvedVersionId).toBe(logoV1); // still v1
    expect((await reviews.reviewHistory(author, "ASSET_VERSION", logoV2)).events.map((e) => e.action)).toEqual(["SUBMITTED", "CHANGES_REQUESTED"]);
    await approve("ASSET_VERSION", pdfV1);
    expect((await assets.attachableAssets(author)).map((a) => a.assetVersionId)).toEqual(expect.arrayContaining([logoV1, pdfV1]));
  });

  it("a template must be approved for marketing before a campaign can send it", async () => {
    await prisma.marketingCampaign.update({ where: { id: campaignId }, data: { status: "ACTIVE", actualStartDate: new Date() } });
    const ch = await runs.addCampaignChannel(author, campaignId, { connectionId, templateId });
    await expectCode(runs.startRun(author, ch.id, { confirmed: true }), "VALIDATION_ERROR");
    expect((await templates.listMarketingTemplates(author, { channelType: "EMAIL" }, 1, 100)).data.find((t) => t.id === templateId)).toMatchObject({ currentReview: "DRAFT", approvedVersionNumber: null });
    await approve("TEMPLATE_VERSION", templateV1);
    const r = await resolver.resolveChannelContent({ templateId, contentId: null, campaignId }, true);
    expect(r.content).toMatchObject({ source: "TEMPLATE", templateVersionId: templateV1 });
    expect(r.problems).toEqual([]);
    await runs.setCampaignChannelActive(author, ch.id, false);
  });

  it("campaign content: versions, attachments, conflicts and approval rules", async () => {
    contentId = (await contents.createCampaignContent(author, campaignId, { name: `Launch ${run}`, templateId, locale: "en" })).id;
    let c = await contents.getCampaignContent(author, contentId);
    expect(c.versions[0]).toMatchObject({ versionNumber: 1, templateVersionNumber: 1, review: "DRAFT" });
    await expectCode(contents.saveContentVersion(author, contentId, { subject: c.versions[0].subject, body: c.versions[0].body, version: c.version }), "VALIDATION_ERROR"); // nothing changed
    // Invalid content and unsafe variables are refused on the server.
    await expectCode(contents.saveContentVersion(author, contentId, { subject: "", body: "x", version: c.version }), "VALIDATION_ERROR");
    await expectCode(contents.saveContentVersion(author, contentId, { subject: "S", body: "{{opportunity.value}}", version: c.version }), "VALIDATION_ERROR");
    const v2 = await contents.saveContentVersion(author, contentId, { subject: "Our launch, {{contact.first_name|there}}", body: "Dear {{contact.first_name|there}} ({{contact.designation}}), see the brochure.", assetVersionIds: [pdfV1], changeNote: "Add brochure", version: c.version });
    await expectCode(contents.saveContentVersion(author, contentId, { subject: "Stale", body: "Stale", version: c.version }), "RECORD_VERSION_CONFLICT");
    await expect(prisma.marketingCampaignContentVersion.update({ where: { id: v2.versionId }, data: { body: "tampered" } })).rejects.toThrow(/immutable/);
    // Approval needs every attachment approved: v2 of the logo was sent back.
    c = await contents.getCampaignContent(author, contentId);
    const v3 = await contents.saveContentVersion(author, contentId, { subject: "Our launch", body: "Hi {{contact.first_name|there}}", assetVersionIds: [logoV2], version: c.version });
    await reviews.reviewVersion(author, "CONTENT_VERSION", v3.versionId, "submit", {});
    await expectCode(reviews.reviewVersion(approver, "CONTENT_VERSION", v3.versionId, "approve", {}), "VALIDATION_ERROR");
    await reviews.reviewVersion(author, "CONTENT_VERSION", v3.versionId, "withdraw", {});
    await approve("CONTENT_VERSION", v2.versionId);
    c = await contents.getCampaignContent(author, contentId);
    expect(c.approvedVersionId).toBe(v2.versionId);
    expect(c.currentVersionId).toBe(v3.versionId); // newer draft, but v2 is what's sent
    await expectCode(contents.getCampaignContent(stranger, contentId), "NOT_FOUND");
    // Preview: sample data, nothing sent; a missing designation is flagged.
    const p = await contents.previewContent(author, contentId, { versionId: v2.versionId });
    expect(p).toMatchObject({ basis: "sample", subject: expect.stringContaining("Rahul"), unsubscribeFooter: true });
    expect(p.attachments.map((a) => a.assetVersionId)).toEqual([pdfV1]);
    const pc = await contents.previewContent(author, contentId, { versionId: v2.versionId, contactId: contacts.noRole });
    expect(pc.issues.some((i) => i.severity === "error" && i.message.includes("contact.designation"))).toBe(true);
    expect(sent).toHaveLength(0);
  });

  it("Phase 10 sends the frozen, approved version with its pinned files; later edits don't change the run", async () => {
    const ch = await runs.addCampaignChannel(author, campaignId, { connectionId, contentId });
    channelId = ch.id;
    const { run: r } = await runs.startRun(author, channelId, { confirmed: true });
    expect(r.contentVersionId).toBe((await contents.getCampaignContent(author, contentId)).approvedVersionId);
    // After the run started: a new version is approved. The run must still send v2.
    const c = await contents.getCampaignContent(author, contentId);
    const v4 = await contents.saveContentVersion(author, contentId, { subject: "Changed", body: "Changed text {{contact.first_name|there}}", version: c.version });
    await approve("CONTENT_VERSION", v4.versionId);
    await engine.prepareRun(r.id, deps);
    await engine.dispatchRun(r.id, deps);
    expect(sent).toHaveLength(1); // the contact without a designation is skipped, not sent a blank
    expect(sent[0].to).toBe(`withrole.${run}@example.com`);
    expect(sent[0].body).toContain("Dear Asha (Buyer), see the brochure.");
    expect(sent[0].attachment).toEqual([{ name: "brochure.pdf", content: pdf.toString("base64") }]);
    const skipped = await prisma.marketingDelivery.findFirstOrThrow({ where: { runId: r.id, contactId: contacts.noRole } });
    expect(skipped).toMatchObject({ status: "SUPPRESSED", skipReason: "RENDER_FAILED" });
    const detail = await runs.getRun(author, r.id);
    expect(detail.content).toMatchObject({ versionNumber: 2, attachments: [{ name: `Brochure ${run}`, versionNumber: 1 }] });
  });

  it("in-use assets can't be archived; expired assets stop a send", async () => {
    // The brochure is only in v2, which the finished run sent; the content now sends v4 → not in use.
    expect((await assets.getAsset(author, pdfAssetId)).usage.every((u) => !u.live)).toBe(true);
    // Attach it to a new current version → in use again.
    const content = await contents.getCampaignContent(author, contentId);
    const v5 = await contents.saveContentVersion(author, contentId, { subject: "With brochure", body: "Hi {{contact.first_name|there}}", assetVersionIds: [pdfV1], version: content.version });
    await expectCode(assets.setAssetArchived(author, pdfAssetId, true, (await assets.getAsset(author, pdfAssetId)).version), "REFERENCED_RECORD_IN_USE");
    // Licence expiry: content using it can't be approved, and a channel would report it.
    await prisma.marketingAsset.update({ where: { id: pdfAssetId }, data: { expiresOn: new Date("2020-01-01") } });
    await reviews.reviewVersion(author, "CONTENT_VERSION", v5.versionId, "submit", {});
    await expectCode(reviews.reviewVersion(approver, "CONTENT_VERSION", v5.versionId, "approve", {}), "VALIDATION_ERROR");
    const problems = await resolver.attachmentProblems("EMAIL", [{ assetId: pdfAssetId, assetVersionId: pdfV1, name: "Brochure", fileName: "b.pdf", mimeType: "application/pdf", fileSizeBytes: 10 }], true);
    expect(problems.join(" ")).toMatch(/expired/);
    expect((await resolver.attachmentProblems("SMS", [{ assetId: logoId, assetVersionId: logoV1, name: "Logo", fileName: "l.png", mimeType: "image/png", fileSizeBytes: 10 }], false)).join(" ")).toMatch(/can't carry files/);
    // An asset no open content uses can be archived; archived assets disappear from the picker.
    const other = await assets.createAsset(author, { name: `Spare ${run}`, assetType: "IMAGE" }, { buffer: await sharp({ create: { width: 5, height: 5, channels: 3, background: "#00ff00" } }).png().toBuffer(), fileName: "s.png", mimeType: "image/png" });
    const archived = await assets.setAssetArchived(author, other.asset.id, true, other.asset.version);
    expect(archived.status).toBe("ARCHIVED");
    await expectCode(assets.addAssetVersion(author, other.asset.id, { buffer: png2, fileName: "x.png", mimeType: "image/png" }, null), "INVALID_STATE_TRANSITION");
  });
});
