import { beforeEach, describe, expect, it, vi } from "vitest";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/core/db/client", () => ({
  prisma: {
    lead: { findFirst: vi.fn() },
    customer: { findFirst: vi.fn() },
    campaign: { findFirst: vi.fn() },
    crmLeadSource: { findFirst: vi.fn() },
  },
}));
vi.mock("@/modules/crm/crm-config.service", () => ({ ensureCrmDefaults: vi.fn() }));
vi.mock("@/modules/crm/lead.service", () => ({ createLead: vi.fn() }));
vi.mock("@/modules/crm/deal.service", () => ({ createDeal: vi.fn() }));
vi.mock("@/modules/marketing/campaign.service", () => ({ recordDailyMetric: vi.fn() }));
vi.mock("./import.repository", () => ({
  ImportBatchRepository: {
    create: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    findByIdWithDetails: vi.fn(),
  },
}));

const { prisma } = await import("@/core/db/client");
const { createLead } = await import("@/modules/crm/lead.service");
const { createDeal } = await import("@/modules/crm/deal.service");
const { recordDailyMetric } = await import("@/modules/marketing/campaign.service");
const { ImportBatchRepository } = await import("./import.repository");
const { runImport } = await import("./import.service");

const actor = { companyId: "co-1", userId: "user-1", branchId: "br-1" };

beforeEach(() => {
  vi.mocked(prisma.lead.findFirst).mockReset();
  vi.mocked(prisma.customer.findFirst).mockReset();
  vi.mocked(prisma.campaign.findFirst).mockReset();
  // Only WEBSITE is a configured source in these tests.
  vi.mocked(prisma.crmLeadSource.findFirst)
    .mockReset()
    .mockImplementation(((args: { where: { OR: Array<{ code?: string }> } }) =>
      Promise.resolve(args.where.OR.some((c) => c.code === "WEBSITE") ? { id: "11111111-1111-4111-8111-111111111111" } : null)) as never);
  vi.mocked(createLead).mockReset().mockResolvedValue({} as never);
  vi.mocked(createDeal).mockReset().mockResolvedValue({} as never);
  vi.mocked(recordDailyMetric).mockReset().mockResolvedValue({} as never);
  vi.mocked(ImportBatchRepository.create)
    .mockReset()
    .mockResolvedValue({ id: "batch-1" } as never);
});

describe("runImport — LEAD", () => {
  it("imports a valid row through the exact same createLead used by the manual form", async () => {
    const result = await runImport(actor, {
      importType: "LEAD",
      fileName: "leads.csv",
      rows: [{ name: "Jane Doe", email: "jane@example.com", source: "website", leadScore: "85" }],
    });

    expect(result.importedCount).toBe(1);
    expect(result.skippedCount).toBe(0);
    expect(createLead).toHaveBeenCalledWith(actor, expect.objectContaining({ name: "Jane Doe", email: "jane@example.com", sourceId: "11111111-1111-4111-8111-111111111111", leadScore: 85 }));
  });

  it("skips a row with an invalid Source without ever calling createLead", async () => {
    const result = await runImport(actor, {
      importType: "LEAD",
      fileName: "leads.csv",
      rows: [{ name: "Bad Row", source: "carrier-pigeon" }],
    });

    expect(result.importedCount).toBe(0);
    expect(result.skippedCount).toBe(1);
    expect(result.failedRows[0].reason).toContain("source");
    expect(createLead).not.toHaveBeenCalled();
  });

  // Regression test for the P4 fix: an invalid Source used to be checked by
  // a manual pre-check that threw immediately with only that one issue,
  // before createLeadSchema.parse() ever ran — silently hiding any other
  // problems in the same row (e.g. a missing name) until the source was
  // fixed and the row was re-uploaded. It must now report every issue in
  // the row together in one combined message, matching importDealRow's own
  // (already-correct) behavior.
  it("aggregates every validation issue in a Lead row into one combined message, not just the first", async () => {
    const result = await runImport(actor, {
      importType: "LEAD",
      fileName: "leads.csv",
      // Both an invalid source AND a missing required name.
      rows: [{ name: "", source: "carrier-pigeon" }],
    });

    expect(result.skippedCount).toBe(1);
    expect(result.failedRows[0].reason).toContain("source");
    expect(result.failedRows[0].reason).toContain("name");
    expect(createLead).not.toHaveBeenCalled();
  });

  it("reports a thrown BusinessRuleError (e.g. a duplicate) as a skipped row with its exact message", async () => {
    vi.mocked(createLead).mockRejectedValueOnce(new BusinessRuleError("DUPLICATE_LEAD_EXISTS", "A lead with this email already exists: Jane Doe."));

    const result = await runImport(actor, {
      importType: "LEAD",
      fileName: "leads.csv",
      rows: [{ name: "Jane Doe", email: "jane@example.com" }],
    });

    expect(result.importedCount).toBe(0);
    expect(result.skippedCount).toBe(1);
    expect(result.failedRows[0].reason).toBe("A lead with this email already exists: Jane Doe.");
  });

  it("does not abort the batch when one row fails — later rows still import", async () => {
    vi.mocked(createLead).mockRejectedValueOnce(new BusinessRuleError("VALIDATION_ERROR", "bad row")).mockResolvedValueOnce({} as never);

    const result = await runImport(actor, {
      importType: "LEAD",
      fileName: "leads.csv",
      rows: [{ name: "Row One" }, { name: "Row Two" }],
    });

    expect(result.importedCount).toBe(1);
    expect(result.skippedCount).toBe(1);
  });
});

describe("runImport — DEAL", () => {
  it("resolves a Lead # reference and passes the real leadId through to createDeal", async () => {
    const leadUuid = "11111111-1111-4111-8111-111111111111";
    vi.mocked(prisma.lead.findFirst).mockResolvedValue({ id: leadUuid } as never);

    await runImport(actor, {
      importType: "DEAL",
      fileName: "deals.csv",
      rows: [{ title: "New Deal", leadNumber: "LD-2026-00001" }],
    });

    expect(prisma.lead.findFirst).toHaveBeenCalledWith({ where: { companyId: "co-1", leadNumber: "LD-2026-00001" }, select: { id: true } });
    expect(createDeal).toHaveBeenCalledWith(actor, expect.objectContaining({ title: "New Deal", leadId: leadUuid }));
  });

  it("skips the row with a clear reason when the referenced Lead # doesn't exist", async () => {
    vi.mocked(prisma.lead.findFirst).mockResolvedValue(null);

    const result = await runImport(actor, {
      importType: "DEAL",
      fileName: "deals.csv",
      rows: [{ title: "New Deal", leadNumber: "LD-9999999" }],
    });

    expect(result.skippedCount).toBe(1);
    expect(result.failedRows[0].reason).toContain('Lead "LD-9999999" not found');
    expect(createDeal).not.toHaveBeenCalled();
  });
});

describe("runImport — CAMPAIGN_DAILY_METRIC", () => {
  it("resolves by Campaign # and calls recordDailyMetric with the resolved id", async () => {
    vi.mocked(prisma.campaign.findFirst).mockResolvedValue({ id: "campaign-uuid-1" } as never);

    await runImport(actor, {
      importType: "CAMPAIGN_DAILY_METRIC",
      fileName: "metrics.csv",
      rows: [{ campaignNumber: "CAM-2026-00001", metricDate: "2026-08-20", spend: "500" }],
    });

    expect(recordDailyMetric).toHaveBeenCalledWith(actor, "campaign-uuid-1", expect.objectContaining({ metricDate: "2026-08-20", spend: 500 }));
  });

  it("fails the row (never running an unfiltered lookup) when neither Campaign # nor Name is given", async () => {
    const result = await runImport(actor, {
      importType: "CAMPAIGN_DAILY_METRIC",
      fileName: "metrics.csv",
      rows: [{ metricDate: "2026-08-20" }],
    });

    expect(result.skippedCount).toBe(1);
    expect(result.failedRows[0].reason).toContain("Either Campaign # or Campaign Name is required");
    expect(prisma.campaign.findFirst).not.toHaveBeenCalled();
    expect(recordDailyMetric).not.toHaveBeenCalled();
  });
});

describe("runImport — batch summary persistence", () => {
  it("persists the ImportBatch summary with the imported/skipped counts and failed-row detail", async () => {
    vi.mocked(createLead).mockRejectedValueOnce(new BusinessRuleError("VALIDATION_ERROR", "bad"));

    await runImport(actor, {
      importType: "LEAD",
      fileName: "leads.csv",
      rows: [{ name: "Bad Lead" }, { name: "Good Lead" }],
    });

    expect(ImportBatchRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: "co-1",
        importType: "LEAD",
        fileName: "leads.csv",
        totalRows: 2,
        importedCount: 1,
        skippedCount: 1,
        createdByUserId: "user-1",
      })
    );
  });

  it("stores a null failedRowsJson (not an empty array) when every row succeeds", async () => {
    await runImport(actor, {
      importType: "LEAD",
      fileName: "leads.csv",
      rows: [{ name: "Good Lead" }],
    });

    expect(ImportBatchRepository.create).toHaveBeenCalledWith(expect.objectContaining({ failedRowsJson: null }));
  });
});
