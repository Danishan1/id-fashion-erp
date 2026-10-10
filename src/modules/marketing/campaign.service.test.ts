import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/core/numbering/DocumentNumberingService", () => ({ generateDocumentNumber: vi.fn() }));
vi.mock("@/core/rbac/PermissionService", () => ({ PermissionService: { assert: vi.fn() } }));
// Repointed at the new CRM (2026-10-09, CRM Replacement): CrmLead/
// CrmOpportunity instead of the legacy Lead/Deal, "qualified" is now
// temperature IN (WARM, HOT) (no threshold setting anymore), "customers" is
// convertedAt IS NOT NULL, revenue sums CrmOpportunity.amount where
// status=WON.
vi.mock("@/core/db/client", () => ({
  prisma: {
    crmLead: { groupBy: vi.fn(), findMany: vi.fn(), findFirst: vi.fn() },
    crmOpportunity: { aggregate: vi.fn(), findMany: vi.fn() },
    campaign: { findMany: vi.fn() },
    campaignDailyMetric: { findMany: vi.fn(), groupBy: vi.fn() },
  },
}));
vi.mock("./campaign.repository", () => ({
  CampaignRepository: {
    create: vi.fn(),
    update: vi.fn(),
    findAnyById: vi.fn(),
    findByIdWithDetails: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    findActiveOrPaused: vi.fn(),
    findManyByChannel: vi.fn(),
  },
  CampaignDailyMetricRepository: {
    upsert: vi.fn(),
    sumByCampaignIds: vi.fn(),
  },
  CampaignAttributionRepository: {
    create: vi.fn(),
  },
  CampaignAlertRepository: {
    create: vi.fn(),
    findOpenByTypeAndCampaign: vi.fn(),
    findAnyById: vi.fn(),
    update: vi.fn(),
    countOpen: vi.fn(),
  },
}));

const { prisma } = await import("@/core/db/client");
const { generateDocumentNumber } = await import("@/core/numbering/DocumentNumberingService");
const { PermissionService } = await import("@/core/rbac/PermissionService");
const { CampaignRepository, CampaignDailyMetricRepository, CampaignAlertRepository } = await import("./campaign.repository");
const {
  createCampaign,
  updateCampaign,
  changeCampaignStatus,
  approveCampaign,
  rejectCampaign,
  recordDailyMetric,
  runMarketingAutomation,
  resolveCampaignAlert,
  getMarketingDashboard,
  getMarketingTrends,
  getChannelPerformance,
} = await import("./campaign.service");

const actor = { companyId: "co-1", userId: "user-1", branchId: "br-1" };

function emptyMetricsMocks() {
  vi.mocked(CampaignDailyMetricRepository.sumByCampaignIds).mockResolvedValue([]);
  vi.mocked(prisma.crmLead.groupBy).mockResolvedValue([] as never);
  vi.mocked(prisma.crmOpportunity.aggregate).mockResolvedValue({ _sum: { amount: null } } as never);
}

beforeEach(() => {
  vi.mocked(generateDocumentNumber).mockReset().mockResolvedValue("CAMP-2026-00001");
  vi.mocked(PermissionService.assert).mockReset().mockResolvedValue(undefined as never);
  vi.mocked(CampaignRepository.create).mockReset();
  vi.mocked(CampaignRepository.update).mockReset();
  vi.mocked(CampaignRepository.findAnyById).mockReset();
  vi.mocked(CampaignRepository.findActiveOrPaused).mockReset();
  vi.mocked(CampaignRepository.findManyByChannel).mockReset().mockResolvedValue([]);
  vi.mocked(CampaignAlertRepository.create).mockReset();
  vi.mocked(CampaignAlertRepository.findOpenByTypeAndCampaign).mockReset().mockResolvedValue(null);
  vi.mocked(CampaignAlertRepository.findAnyById).mockReset();
  vi.mocked(CampaignAlertRepository.update).mockReset();
  vi.mocked(CampaignAlertRepository.countOpen).mockReset().mockResolvedValue(0);
  vi.mocked(prisma.campaign.findMany).mockReset().mockResolvedValue([]);
  vi.mocked(prisma.campaignDailyMetric.findMany).mockReset().mockResolvedValue([]);
  vi.mocked(prisma.campaignDailyMetric.groupBy).mockReset().mockResolvedValue([]);
  vi.mocked(prisma.crmOpportunity.findMany).mockReset().mockResolvedValue([]);
  vi.mocked(prisma.crmLead.findMany).mockReset().mockResolvedValue([]);
  emptyMetricsMocks();
});

describe("createCampaign", () => {
  it("generates a campaign number and always starts DRAFT/PENDING regardless of input", async () => {
    vi.mocked(CampaignRepository.create).mockResolvedValue({ id: "camp-1" } as never);

    await createCampaign(actor, { name: "Diwali Push", channel: "META_ADS" } as never);

    expect(generateDocumentNumber).toHaveBeenCalledWith(expect.objectContaining({ documentType: "CAMPAIGN" }));
    expect(CampaignRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ campaignNumber: "CAMP-2026-00001", name: "Diwali Push", status: "DRAFT", approvalStatus: "PENDING" })
    );
  });
});

describe("updateCampaign", () => {
  it("blocks editing a completed campaign", async () => {
    vi.mocked(CampaignRepository.findAnyById).mockResolvedValue({ id: "camp-1", status: "COMPLETED" } as never);

    await expect(updateCampaign(actor, "camp-1", { name: "New name" } as never)).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
    expect(CampaignRepository.update).not.toHaveBeenCalled();
  });
});

describe("changeCampaignStatus", () => {
  it("rejects an illegal jump, e.g. DRAFT straight to COMPLETED", async () => {
    vi.mocked(CampaignRepository.findAnyById).mockResolvedValue({ id: "camp-1", status: "DRAFT", approvalStatus: "APPROVED" } as never);

    await expect(changeCampaignStatus(actor, "camp-1", { status: "COMPLETED" } as never)).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
    expect(CampaignRepository.update).not.toHaveBeenCalled();
  });

  it("blocks activating a campaign that isn't Approved yet", async () => {
    vi.mocked(CampaignRepository.findAnyById).mockResolvedValue({ id: "camp-1", status: "DRAFT", approvalStatus: "PENDING" } as never);

    await expect(changeCampaignStatus(actor, "camp-1", { status: "ACTIVE" } as never)).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
    expect(CampaignRepository.update).not.toHaveBeenCalled();
  });

  it("blocks activating a Rejected campaign and surfaces the rejection reason", async () => {
    vi.mocked(CampaignRepository.findAnyById).mockResolvedValue({
      id: "camp-1",
      status: "DRAFT",
      approvalStatus: "REJECTED",
      rejectionReason: "Budget too high for this quarter",
    } as never);

    await expect(changeCampaignStatus(actor, "camp-1", { status: "ACTIVE" } as never)).rejects.toMatchObject({
      code: "INVALID_STATE_TRANSITION",
      message: expect.stringContaining("Budget too high for this quarter"),
    });
  });

  it("allows activating an Approved campaign", async () => {
    vi.mocked(CampaignRepository.findAnyById).mockResolvedValue({ id: "camp-1", status: "DRAFT", approvalStatus: "APPROVED" } as never);
    vi.mocked(CampaignRepository.update).mockResolvedValue({ id: "camp-1", status: "ACTIVE" } as never);

    await changeCampaignStatus(actor, "camp-1", { status: "ACTIVE" } as never);

    expect(CampaignRepository.update).toHaveBeenCalledWith("camp-1", { status: "ACTIVE" });
  });
});

describe("approveCampaign", () => {
  it("asserts marketing.approve with a self-approval resourceContext and clears any prior rejection", async () => {
    vi.mocked(CampaignRepository.findAnyById).mockResolvedValue({ id: "camp-1", createdByUserId: "user-other", approvalStatus: "REJECTED" } as never);
    vi.mocked(CampaignRepository.update).mockResolvedValue({ id: "camp-1", approvalStatus: "APPROVED" } as never);

    await approveCampaign(actor, "camp-1");

    expect(PermissionService.assert).toHaveBeenCalledWith("user-1", "marketing", "approve", { createdBy: "user-other" });
    expect(CampaignRepository.update).toHaveBeenCalledWith(
      "camp-1",
      expect.objectContaining({ approvalStatus: "APPROVED", approvedByUserId: "user-1", rejectionReason: null })
    );
  });
});

describe("rejectCampaign", () => {
  it("stores the reason and clears any prior approval metadata, without a self-approval guard", async () => {
    vi.mocked(CampaignRepository.findAnyById).mockResolvedValue({ id: "camp-1", createdByUserId: "user-1", approvalStatus: "APPROVED" } as never);
    vi.mocked(CampaignRepository.update).mockResolvedValue({ id: "camp-1", approvalStatus: "REJECTED" } as never);

    await rejectCampaign(actor, "camp-1", { reason: "Overlaps with another campaign" });

    expect(PermissionService.assert).toHaveBeenCalledWith("user-1", "marketing", "reject");
    expect(CampaignRepository.update).toHaveBeenCalledWith(
      "camp-1",
      expect.objectContaining({ approvalStatus: "REJECTED", rejectionReason: "Overlaps with another campaign", approvedByUserId: null })
    );
  });
});

describe("recordDailyMetric", () => {
  it("rejects recording metrics against a campaign that isn't Approved", async () => {
    vi.mocked(CampaignRepository.findAnyById).mockResolvedValue({ id: "camp-1", approvalStatus: "PENDING" } as never);

    await expect(recordDailyMetric(actor, "camp-1", { metricDate: "2026-08-24" } as never)).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
    expect(CampaignDailyMetricRepository.upsert).not.toHaveBeenCalled();
  });

  it("allows recording metrics against an Approved campaign", async () => {
    vi.mocked(CampaignRepository.findAnyById).mockResolvedValue({ id: "camp-1", approvalStatus: "APPROVED" } as never);
    vi.mocked(CampaignDailyMetricRepository.upsert).mockResolvedValue({ id: "metric-1" } as never);

    await recordDailyMetric(actor, "camp-1", { metricDate: "2026-08-24", spend: 100, impressions: 0, clicks: 0 } as never);

    expect(CampaignDailyMetricRepository.upsert).toHaveBeenCalled();
  });
});

describe("runMarketingAutomation", () => {
  it("creates a HIGH budget-overspend alert when spend exceeds budget", async () => {
    vi.mocked(CampaignRepository.findActiveOrPaused).mockResolvedValue([
      { id: "camp-1", name: "Diwali Push", budget: "1000", channel: "META_ADS", approvalStatus: "APPROVED" },
    ] as never);
    vi.mocked(CampaignDailyMetricRepository.sumByCampaignIds).mockResolvedValue([{ campaignId: "camp-1", _sum: { spend: "1500" } }] as never);

    await runMarketingAutomation("co-1");

    expect(CampaignAlertRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ alertType: "BUDGET_OVERSPEND", priority: "HIGH", campaignId: "camp-1" })
    );
  });

  it("creates a MEDIUM 80%-budget alert, not overspend, when spend is between 80% and 100%", async () => {
    vi.mocked(CampaignRepository.findActiveOrPaused).mockResolvedValue([
      { id: "camp-1", name: "Diwali Push", budget: "1000", channel: "META_ADS", approvalStatus: "APPROVED" },
    ] as never);
    vi.mocked(CampaignDailyMetricRepository.sumByCampaignIds).mockResolvedValue([{ campaignId: "camp-1", _sum: { spend: "850" } }] as never);

    await runMarketingAutomation("co-1");

    expect(CampaignAlertRepository.create).toHaveBeenCalledWith(expect.objectContaining({ alertType: "BUDGET_80_PERCENT", priority: "MEDIUM" }));
    expect(CampaignAlertRepository.create).not.toHaveBeenCalledWith(expect.objectContaining({ alertType: "BUDGET_OVERSPEND" }));
  });

  it("does not alert at all when spend is comfortably under 80% of budget", async () => {
    vi.mocked(CampaignRepository.findActiveOrPaused).mockResolvedValue([
      { id: "camp-1", name: "Diwali Push", budget: "1000", channel: "META_ADS", approvalStatus: "APPROVED" },
    ] as never);
    vi.mocked(CampaignDailyMetricRepository.sumByCampaignIds).mockResolvedValue([{ campaignId: "camp-1", _sum: { spend: "200" } }] as never);

    await runMarketingAutomation("co-1");

    expect(CampaignAlertRepository.create).not.toHaveBeenCalled();
  });

  it("skips ROAS alerts entirely below the $1000 minimum-spend gate", async () => {
    vi.mocked(CampaignRepository.findActiveOrPaused).mockResolvedValue([
      { id: "camp-1", name: "Low Spend", budget: "0", channel: "META_ADS", approvalStatus: "APPROVED" },
    ] as never);
    // spend under 1000, revenue 0 -> would be a 0.0x ROAS if the gate were missing
    vi.mocked(CampaignDailyMetricRepository.sumByCampaignIds).mockResolvedValue([{ campaignId: "camp-1", _sum: { spend: "500" } }] as never);

    await runMarketingAutomation("co-1");

    expect(CampaignAlertRepository.create).not.toHaveBeenCalledWith(expect.objectContaining({ alertType: "LOW_ROAS" }));
  });

  it("does not re-create an alert of the same type that's already open for that campaign", async () => {
    vi.mocked(CampaignRepository.findActiveOrPaused).mockResolvedValue([
      { id: "camp-1", name: "Diwali Push", budget: "1000", channel: "META_ADS", approvalStatus: "APPROVED" },
    ] as never);
    vi.mocked(CampaignDailyMetricRepository.sumByCampaignIds).mockResolvedValue([{ campaignId: "camp-1", _sum: { spend: "1500" } }] as never);
    vi.mocked(CampaignAlertRepository.findOpenByTypeAndCampaign).mockResolvedValue({ id: "alert-existing" } as never);

    await runMarketingAutomation("co-1");

    expect(CampaignAlertRepository.create).not.toHaveBeenCalled();
  });

  it("skips a campaign whose approval has been revoked, even though it's still ACTIVE/PAUSED", async () => {
    vi.mocked(CampaignRepository.findActiveOrPaused).mockResolvedValue([
      { id: "camp-1", name: "Rejected-after-activation", budget: "1000", channel: "META_ADS", approvalStatus: "REJECTED" },
    ] as never);
    vi.mocked(CampaignDailyMetricRepository.sumByCampaignIds).mockResolvedValue([{ campaignId: "camp-1", _sum: { spend: "1500" } }] as never);

    await runMarketingAutomation("co-1");

    expect(CampaignAlertRepository.create).not.toHaveBeenCalled();
  });
});

describe("resolveCampaignAlert", () => {
  it("marks an OPEN alert RESOLVED with a timestamp", async () => {
    vi.mocked(CampaignAlertRepository.findAnyById).mockResolvedValue({ id: "alert-1", status: "OPEN" } as never);

    await resolveCampaignAlert(actor, "alert-1");

    expect(CampaignAlertRepository.update).toHaveBeenCalledWith("alert-1", expect.objectContaining({ status: "RESOLVED" }));
  });

  it("rejects resolving an alert that's already resolved", async () => {
    vi.mocked(CampaignAlertRepository.findAnyById).mockResolvedValue({ id: "alert-1", status: "RESOLVED" } as never);

    await expect(resolveCampaignAlert(actor, "alert-1")).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
    expect(CampaignAlertRepository.update).not.toHaveBeenCalled();
  });
});

describe("getMarketingDashboard", () => {
  it("sums budget/spend/leads/customers/revenue across every campaign and computes ROAS", async () => {
    vi.mocked(prisma.campaign.findMany).mockResolvedValue([{ id: "camp-1", budget: "1000" }, { id: "camp-2", budget: "500" }] as never);
    vi.mocked(CampaignDailyMetricRepository.sumByCampaignIds).mockResolvedValue([
      { campaignId: "camp-1", _sum: { spend: "800" } },
      { campaignId: "camp-2", _sum: { spend: "200" } },
    ] as never);
    const groupByImpl = (args: { where?: { convertedAt?: unknown; temperature?: unknown } }) => {
      if (args.where?.convertedAt) return Promise.resolve([{ campaignId: "camp-1", _count: { _all: 2 } }]);
      if (args.where?.temperature) return Promise.resolve([{ campaignId: "camp-1", _count: { _all: 3 } }]);
      return Promise.resolve([
        { campaignId: "camp-1", _count: { _all: 5 } },
        { campaignId: "camp-2", _count: { _all: 2 } },
      ]);
    };
    vi.mocked(prisma.crmLead.groupBy).mockImplementation(groupByImpl as never);
    vi.mocked(prisma.crmOpportunity.aggregate).mockResolvedValue({ _sum: { amount: "3000" } } as never);

    const result = await getMarketingDashboard("co-1");

    expect(result.budget).toBe(1500);
    expect(result.spend).toBe(1000);
    expect(result.leads).toBe(7);
    expect(result.customers).toBe(2);
    expect(result.roas).toBeCloseTo(6000 / 1000);
  });
});

describe("getMarketingTrends", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("zero-fills every day in the window, not just days with real activity", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-24T12:00:00"));

    const result = await getMarketingTrends("co-1", 5);

    expect(result).toHaveLength(5);
    expect(result[0].date).toBe("2026-08-20");
    expect(result[4].date).toBe("2026-08-24");
    expect(result.every((r) => r.spend === 0 && r.leads === 0 && r.revenue === 0)).toBe(true);
  });

  it("buckets spend/impressions/clicks, leads, and won-deal revenue onto the correct day and derives CPL/ROAS", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-24T12:00:00"));

    vi.mocked(prisma.campaignDailyMetric.findMany).mockResolvedValue([
      { metricDate: new Date("2026-08-22"), spend: "500", impressions: "1000", clicks: "50" },
    ] as never);
    vi.mocked(prisma.crmLead.findMany).mockResolvedValue([
      { createdAt: new Date("2026-08-22T09:00:00"), convertedAt: null },
      { createdAt: new Date("2026-08-22T15:00:00"), convertedAt: new Date("2026-08-22T16:00:00") },
    ] as never);
    vi.mocked(prisma.crmOpportunity.findMany).mockResolvedValue([{ createdAt: new Date("2026-08-22T10:00:00"), amount: "2000" }] as never);

    const result = await getMarketingTrends("co-1", 5);
    const day = result.find((r) => r.date === "2026-08-22")!;

    expect(day).toMatchObject({ spend: 500, impressions: 1000, clicks: 50, leads: 2, customers: 1, revenue: 2000 });
    expect(day.cpl).toBe(250); // 500 / 2 leads
    expect(day.roas).toBe(4); // 2000 / 500
  });
});

describe("getChannelPerformance", () => {
  it("groups leads/deals/spend by channel and computes ROI, keeping a zero row for a channel with no activity", async () => {
    vi.mocked(prisma.campaign.findMany).mockResolvedValue([
      { id: "camp-meta", channel: "META_ADS" },
      { id: "camp-google", channel: "GOOGLE_ADS" },
      { id: "camp-seo", channel: "SEO" },
    ] as never);
    vi.mocked(prisma.campaignDailyMetric.groupBy).mockResolvedValue([
      { campaignId: "camp-meta", _sum: { spend: "1000" } },
      { campaignId: "camp-google", _sum: { spend: "500" } },
    ] as never);
    vi.mocked(prisma.crmLead.findMany).mockResolvedValue([{ campaignId: "camp-meta" }, { campaignId: "camp-meta" }, { campaignId: "camp-google" }] as never);
    vi.mocked(prisma.crmOpportunity.findMany).mockResolvedValue([
      { status: "WON", amount: "3000", lead: { campaignId: "camp-meta" } },
      { status: "LOST", amount: "1000", lead: { campaignId: "camp-meta" } },
      { status: "OPEN", amount: "500", lead: { campaignId: "camp-google" } },
    ] as never);

    const result = await getChannelPerformance("co-1");
    const meta = result.find((r) => r.channel === "META_ADS")!;
    const google = result.find((r) => r.channel === "GOOGLE_ADS")!;
    const seo = result.find((r) => r.channel === "SEO")!;

    expect(meta).toMatchObject({ campaignCount: 1, leads: 2, deals: 2, wonDeals: 1, revenue: 3000, spend: 1000 });
    expect(meta.roi).toBeCloseTo((3000 - 1000) / 1000); // 2.0
    expect(google).toMatchObject({ campaignCount: 1, leads: 1, deals: 1, wonDeals: 0, revenue: 0, spend: 500 });
    expect(seo).toMatchObject({ campaignCount: 1, leads: 0, deals: 0, wonDeals: 0, revenue: 0, spend: 0, roi: 0 });
  });

  it("scopes to a single channel when filtered", async () => {
    vi.mocked(prisma.campaign.findMany).mockResolvedValue([{ id: "camp-meta", channel: "META_ADS" }] as never);

    await getChannelPerformance("co-1", { channel: "META_ADS" });

    expect(prisma.campaign.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ channel: "META_ADS" }) }));
  });

  it("returns an empty list when the company has no campaigns at all", async () => {
    vi.mocked(prisma.campaign.findMany).mockResolvedValue([]);

    const result = await getChannelPerformance("co-1");

    expect(result).toEqual([]);
  });
});
