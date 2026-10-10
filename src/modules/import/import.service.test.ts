import { beforeEach, describe, expect, it, vi } from "vitest";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";

// LEAD/DEAL coverage was removed with the legacy CRM (2026-10-09, CRM
// Replacement) — only CAMPAIGN_DAILY_METRIC remains, Marketing's own
// row-importer, restored alongside the rest of the Marketing module.
vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/core/db/client", () => ({
  prisma: {
    campaign: { findFirst: vi.fn() },
  },
}));
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
const { recordDailyMetric } = await import("@/modules/marketing/campaign.service");
const { ImportBatchRepository } = await import("./import.repository");
const { runImport } = await import("./import.service");

const actor = { companyId: "co-1", userId: "user-1", branchId: "br-1" };

beforeEach(() => {
  vi.mocked(prisma.campaign.findFirst).mockReset();
  vi.mocked(recordDailyMetric).mockReset().mockResolvedValue({} as never);
  vi.mocked(ImportBatchRepository.create)
    .mockReset()
    .mockResolvedValue({ id: "batch-1" } as never);
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

  it("reports a thrown BusinessRuleError as a skipped row with its exact message", async () => {
    vi.mocked(prisma.campaign.findFirst).mockResolvedValue({ id: "campaign-uuid-1" } as never);
    vi.mocked(recordDailyMetric).mockRejectedValueOnce(new BusinessRuleError("VALIDATION_ERROR", "Spend must be a non-negative number."));

    const result = await runImport(actor, {
      importType: "CAMPAIGN_DAILY_METRIC",
      fileName: "metrics.csv",
      rows: [{ campaignNumber: "CAM-2026-00001", metricDate: "2026-08-20", spend: "5" }],
    });

    expect(result.importedCount).toBe(0);
    expect(result.skippedCount).toBe(1);
    expect(result.failedRows[0].reason).toBe("Spend must be a non-negative number.");
  });

  it("does not abort the batch when one row fails — later rows still import", async () => {
    vi.mocked(prisma.campaign.findFirst).mockResolvedValue({ id: "campaign-uuid-1" } as never);
    vi.mocked(recordDailyMetric).mockRejectedValueOnce(new BusinessRuleError("VALIDATION_ERROR", "bad row")).mockResolvedValueOnce({} as never);

    const result = await runImport(actor, {
      importType: "CAMPAIGN_DAILY_METRIC",
      fileName: "metrics.csv",
      rows: [
        { campaignNumber: "CAM-2026-00001", metricDate: "2026-08-20" },
        { campaignNumber: "CAM-2026-00001", metricDate: "2026-08-21" },
      ],
    });

    expect(result.importedCount).toBe(1);
    expect(result.skippedCount).toBe(1);
  });
});

describe("runImport — batch summary persistence", () => {
  it("persists the ImportBatch summary with the imported/skipped counts and failed-row detail", async () => {
    vi.mocked(prisma.campaign.findFirst).mockResolvedValue(null);

    await runImport(actor, {
      importType: "CAMPAIGN_DAILY_METRIC",
      fileName: "metrics.csv",
      rows: [{ metricDate: "2026-08-20" }, { campaignNumber: "CAM-2026-00001", metricDate: "2026-08-20" }],
    });

    expect(ImportBatchRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: "co-1",
        importType: "CAMPAIGN_DAILY_METRIC",
        fileName: "metrics.csv",
        totalRows: 2,
        importedCount: 0,
        skippedCount: 2,
        createdByUserId: "user-1",
      })
    );
  });

  it("stores a null failedRowsJson (not an empty array) when every row succeeds", async () => {
    vi.mocked(prisma.campaign.findFirst).mockResolvedValue({ id: "campaign-uuid-1" } as never);

    await runImport(actor, {
      importType: "CAMPAIGN_DAILY_METRIC",
      fileName: "metrics.csv",
      rows: [{ campaignNumber: "CAM-2026-00001", metricDate: "2026-08-20" }],
    });

    expect(ImportBatchRepository.create).toHaveBeenCalledWith(expect.objectContaining({ failedRowsJson: null }));
  });
});
