import { describe, expect, it, vi } from "vitest";

vi.mock("@/core/db/client", () => ({ prisma: {} }));

const reg = await import("./content-registry");
const { safeFileName } = await import("./asset.service");
const { variablesWithoutFallback } = await import("./marketing-template.service");
const { strictRenderProblems, renderForRecipient } = await import("@/modules/sales-marketing/delivery/delivery-render");
const { brevoAdapter } = await import("@/modules/sales-marketing/delivery/providers/brevo");
const { smtpAdapter } = await import("@/modules/sales-marketing/delivery/providers/smtp");
const { msg91Adapter } = await import("@/modules/sales-marketing/delivery/providers/msg91");
const { whatsappCloudAdapter } = await import("@/modules/sales-marketing/delivery/providers/whatsapp-cloud");

describe("asset rules", () => {
  it("only raster images, PDF and video; SVG and HTML are never accepted", () => {
    expect(reg.isAssetMime("image/png")).toBe(true);
    expect(reg.isAssetMime("image/svg+xml")).toBe(false);
    expect(reg.isAssetMime("text/html")).toBe(false);
    expect(reg.ASSET_TYPES.LOGO.mimes).not.toContain("image/svg+xml" as never);
    expect(reg.ASSET_MIME["video/mp4"].attachable).toBe(false);
    expect(reg.ASSET_MIME["application/pdf"].attachable).toBe(true);
  });
  it("size limit can go down but never above the storage limit", () => {
    expect(reg.assetMaxBytes({})).toBe(20 * 1024 * 1024);
    expect(reg.assetMaxBytes({ MARKETING_ASSET_MAX_MB: "5" })).toBe(5 * 1024 * 1024);
    expect(reg.assetMaxBytes({ MARKETING_ASSET_MAX_MB: "500" })).toBe(20 * 1024 * 1024);
    expect(reg.assetMaxBytes({ MARKETING_ASSET_MAX_MB: "abc" })).toBe(20 * 1024 * 1024);
  });
  it("file names can't carry paths or header-breaking characters", () => {
    expect(safeFileName("../../etc/passwd")).toBe("passwd");
    expect(safeFileName("C:\\Users\\x\\brochure.pdf")).toBe("brochure.pdf");
    expect(safeFileName('a"b<c>.pdf')).toBe("abc.pdf");
    expect(safeFileName("....hidden")).toBe("hidden");
    expect(safeFileName("\u0000\u0001")).toBe("file");
    expect(safeFileName("x".repeat(300)).length).toBe(150);
  });
  it("metadata is validated and normalised", () => {
    const ok = reg.assetMetadataSchema.parse({ name: " Logo ", assetType: "LOGO", tags: ["Brand", "brand", "Diwali 2026"] });
    expect(ok.name).toBe("Logo");
    expect(ok.tags).toEqual(["brand", "diwali 2026"]);
    expect(reg.assetMetadataSchema.safeParse({ name: "x", assetType: "SCRIPT" }).success).toBe(false);
    expect(reg.assetMetadataSchema.safeParse({ name: "x", assetType: "IMAGE", tags: ["<script>"] }).success).toBe(false);
    expect(reg.assetMetadataSchema.safeParse({ name: "x", assetType: "IMAGE", storageKey: "../x" }).success).toBe(false);
    expect(reg.assetMetadataSchema.safeParse({ name: "x", assetType: "IMAGE", expiresOn: "31-12-2026" }).success).toBe(false);
  });
});

describe("review state machine", () => {
  it("submit from draft or withdrawn; decide only while pending", () => {
    expect(reg.canReview("DRAFT", "submit")).toBe(true);
    expect(reg.canReview("WITHDRAWN", "submit")).toBe(true);
    expect(reg.canReview("PENDING", "approve")).toBe(true);
    expect(reg.canReview("DRAFT", "approve")).toBe(false);
    expect(reg.canReview("APPROVED", "approve")).toBe(false);
    expect(reg.canReview("APPROVED", "submit")).toBe(false);
    expect(reg.canReview("REJECTED", "submit")).toBe(false);
    expect(reg.canReview("CHANGES_REQUESTED", "submit")).toBe(false);
    expect(reg.canReview("PENDING", "withdraw")).toBe(true);
  });
  it("deciding needs approve / reject, not edit", () => {
    expect(reg.REVIEW_ACTIONS.approve.permission).toBe("approve");
    expect(reg.REVIEW_ACTIONS.reject.permission).toBe("reject");
    expect(reg.REVIEW_ACTIONS.request_changes.permission).toBe("reject");
    expect(reg.REVIEW_ACTIONS.submit.permission).toBe("edit");
  });
});

describe("campaign content versions", () => {
  it("a save carries the optimistic version and at most 5 attachments", () => {
    const base = { body: "Hi", version: 1 };
    expect(reg.contentVersionSchema.safeParse(base).success).toBe(true);
    expect(reg.contentVersionSchema.safeParse({ body: "Hi" }).success).toBe(false);
    expect(reg.contentVersionSchema.safeParse({ ...base, body: "   " }).success).toBe(false);
    expect(reg.contentVersionSchema.safeParse({ ...base, assetVersionIds: Array(6).fill("2d8f4c1e-6a2b-4c7d-9e1f-0a1b2c3d4e5f") }).success).toBe(false);
    expect(reg.contentCreateSchema.safeParse({ name: "x", templateId: "2d8f4c1e-6a2b-4c7d-9e1f-0a1b2c3d4e5f", locale: "hi-IN" }).success).toBe(true);
    expect(reg.contentCreateSchema.safeParse({ name: "x", templateId: "2d8f4c1e-6a2b-4c7d-9e1f-0a1b2c3d4e5f", locale: "../en" }).success).toBe(false);
  });
});

describe("personalisation rules", () => {
  it("finds variables used without a fallback", () => {
    expect(variablesWithoutFallback("Hi {{contact.first_name|there}}", "Dear {{contact.first_name}}, from {{company.name|us}}")).toEqual(["contact.first_name"]);
    expect(variablesWithoutFallback(null, "{{contact.first_name|}} ok")).toEqual([]);
    expect(variablesWithoutFallback(null, "{{nope.field}}")).toEqual([]);
  });
  it("a missing value without fallback is an error, never a silent blank", () => {
    const r = renderForRecipient({ subject: null, body: "Hi {{contact.first_name}}, {{company.name|friend}}" }, { "contact.first_name": null }, false);
    expect(r.body).toBe("Hi , friend");
    expect(strictRenderProblems(r)).toEqual(["{{contact.first_name}} has no value for this recipient, and no fallback."]);
    const ok = renderForRecipient({ subject: null, body: "Hi {{contact.first_name|there}}" }, { "contact.first_name": null }, false);
    expect(strictRenderProblems(ok)).toEqual([]);
  });
  it("values are inserted as plain text (no re-parsing, no markup)", () => {
    const r = renderForRecipient({ subject: null, body: "Hi {{contact.first_name}}" }, { "contact.first_name": "<script>{{user.email}}</script>" }, false);
    expect(r.body).toBe("Hi <script>{{user.email}}</script>");
    expect(r.parameters).toEqual([{ key: "contact.first_name", value: "<script>{{user.email}}</script>" }]);
  });
});

describe("attachments by provider", () => {
  const msg = (attachments: { fileName: string; mimeType: string; sizeBytes: number }[]) => ({ subject: "S", body: "B", parameters: [], providerMetadata: { externalTemplateId: "t", externalTemplateName: "n" }, attachments });
  const small = [{ fileName: "a.pdf", mimeType: "application/pdf", sizeBytes: 1000 }];
  it("email providers take them within limits", () => {
    expect(smtpAdapter.validateMessage(msg(small), {})).toEqual([]);
    expect(brevoAdapter.validateMessage(msg(small), {})).toEqual([]);
    expect(brevoAdapter.validateMessage(msg([{ fileName: "big.pdf", mimeType: "application/pdf", sizeBytes: 11 * 1024 * 1024 }]), {})[0]).toMatch(/10 MB/);
  });
  it("SMS and WhatsApp refuse them", () => {
    expect(msg91Adapter.validateMessage(msg(small), {})).toContain("SMS can't carry attachments.");
    expect(whatsappCloudAdapter.validateMessage(msg(small), {}).join(" ")).toMatch(/attachments go by email only/);
  });
  it("Brevo sends them base64-encoded", async () => {
    let sent: { attachment?: { name: string; content: string }[] } = {};
    const fetchImpl = (async (_u: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ messageId: "m" }), { status: 201 });
    }) as unknown as typeof fetch;
    await brevoAdapter.send({ id: "c", companyId: "co", config: { fromEmail: "a@b.co" }, secrets: { apiKey: "k" } }, { deliveryId: "d", to: "x@y.co", toName: null, subject: "S", body: "B", parameters: [], providerMetadata: {}, unsubscribeUrl: null, tag: null, attachments: [{ fileName: "a.pdf", mimeType: "application/pdf", sizeBytes: 3, content: Buffer.from("PDF") }] }, { fetch: fetchImpl, now: () => new Date() });
    expect(sent.attachment).toEqual([{ name: "a.pdf", content: Buffer.from("PDF").toString("base64") }]);
  });
});
