import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/core/numbering/DocumentNumberingService", () => ({ generateDocumentNumber: vi.fn() }));
vi.mock("@/core/db/client", () => ({
  prisma: {
    lead: { groupBy: vi.fn(), findMany: vi.fn() },
    deal: { aggregate: vi.fn() },
    campaign: { findMany: vi.fn() },
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
const { CampaignRepository, CampaignDailyMetricRepository, CampaignAlertRepository } = await import("./campaign.repository");
const { createCampaign, runMarketingAutomation, resolveCampaignAlert, getMarketingDashboard } = await import("./campaign.service");

const actor = { companyId: "co-1", userId: "user-1", branchId: "br-1" };

function emptyMetricsMocks() {
  vi.mocked(CampaignDailyMetricRepository.sumByCampaignIds).mockResolvedValue([]);
  vi.mocked(prisma.lead.groupBy).mockResolvedValue([] as never);
  vi.mocked(prisma.deal.aggregate).mockResolvedValue({ _sum: { value: null } } as never);
}

beforeEach(() => {
  vi.mocked(generateDocumentNumber).mockReset().mockResolvedValue("CAMP-2026-00001");
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
  emptyMetricsMocks();
});

describe("createCampaign", () => {
  it("generates a campaign number and defaults status to DRAFT", async () => {
    vi.mocked(CampaignRepository.create).mockResolvedValue({ id: "camp-1" } as never);

    await createCampaign(actor, { name: "Diwali Push", channel: "META_ADS", status: "DRAFT" } as never);

    expect(generateDocumentNumber).toHaveBeenCalledWith(expect.objectContaining({ documentType: "CAMPAIGN" }));
    expect(CampaignRepository.create).toHaveBeenCalledWith(expect.objectContaining({ campaignNumber: "CAMP-2026-00001", name: "Diwali Push" }));
  });
});

describe("runMarketingAutomation", () => {
  it("creates a HIGH budget-overspend alert when spend exceeds budget", async () => {
    vi.mocked(CampaignRepository.findActiveOrPaused).mockResolvedValue([{ id: "camp-1", name: "Diwali Push", budget: "1000", channel: "META_ADS" }] as never);
    vi.mocked(CampaignDailyMetricRepository.sumByCampaignIds).mockResolvedValue([{ campaignId: "camp-1", _sum: { spend: "1500" } }] as never);

    await runMarketingAutomation("co-1");

    expect(CampaignAlertRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ alertType: "BUDGET_OVERSPEND", priority: "HIGH", campaignId: "camp-1" })
    );
  });

  it("creates a MEDIUM 80%-budget alert, not overspend, when spend is between 80% and 100%", async () => {
    vi.mocked(CampaignRepository.findActiveOrPaused).mockResolvedValue([{ id: "camp-1", name: "Diwali Push", budget: "1000", channel: "META_ADS" }] as never);
    vi.mocked(CampaignDailyMetricRepository.sumByCampaignIds).mockResolvedValue([{ campaignId: "camp-1", _sum: { spend: "850" } }] as never);

    await runMarketingAutomation("co-1");

    expect(CampaignAlertRepository.create).toHaveBeenCalledWith(expect.objectContaining({ alertType: "BUDGET_80_PERCENT", priority: "MEDIUM" }));
    expect(CampaignAlertRepository.create).not.toHaveBeenCalledWith(expect.objectContaining({ alertType: "BUDGET_OVERSPEND" }));
  });

  it("does not alert at all when spend is comfortably under 80% of budget", async () => {
    vi.mocked(CampaignRepository.findActiveOrPaused).mockResolvedValue([{ id: "camp-1", name: "Diwali Push", budget: "1000", channel: "META_ADS" }] as never);
    vi.mocked(CampaignDailyMetricRepository.sumByCampaignIds).mockResolvedValue([{ campaignId: "camp-1", _sum: { spend: "200" } }] as never);

    await runMarketingAutomation("co-1");

    expect(CampaignAlertRepository.create).not.toHaveBeenCalled();
  });

  it("skips ROAS alerts entirely below the $1000 minimum-spend gate", async () => {
    vi.mocked(CampaignRepository.findActiveOrPaused).mockResolvedValue([{ id: "camp-1", name: "Low Spend", budget: "0", channel: "META_ADS" }] as never);
    // spend under 1000, revenue 0 -> would be a 0.0x ROAS if the gate were missing
    vi.mocked(CampaignDailyMetricRepository.sumByCampaignIds).mockResolvedValue([{ campaignId: "camp-1", _sum: { spend: "500" } }] as never);

    await runMarketingAutomation("co-1");

    expect(CampaignAlertRepository.create).not.toHaveBeenCalledWith(expect.objectContaining({ alertType: "LOW_ROAS" }));
  });

  it("does not re-create an alert of the same type that's already open for that campaign", async () => {
    vi.mocked(CampaignRepository.findActiveOrPaused).mockResolvedValue([{ id: "camp-1", name: "Diwali Push", budget: "1000", channel: "META_ADS" }] as never);
    vi.mocked(CampaignDailyMetricRepository.sumByCampaignIds).mockResolvedValue([{ campaignId: "camp-1", _sum: { spend: "1500" } }] as never);
    vi.mocked(CampaignAlertRepository.findOpenByTypeAndCampaign).mockResolvedValue({ id: "alert-existing" } as never);

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
    const groupByImpl = (args: { where?: { status?: unknown; leadScore?: unknown } }) => {
      if (args.where?.status === "WON") return Promise.resolve([{ campaignId: "camp-1", _count: { _all: 2 } }]);
      if (args.where?.leadScore) return Promise.resolve([{ campaignId: "camp-1", _count: { _all: 3 } }]);
      return Promise.resolve([
        { campaignId: "camp-1", _count: { _all: 5 } },
        { campaignId: "camp-2", _count: { _all: 2 } },
      ]);
    };
    vi.mocked(prisma.lead.groupBy).mockImplementation(groupByImpl as never);
    vi.mocked(prisma.deal.aggregate).mockResolvedValue({ _sum: { value: "3000" } } as never);

    const result = await getMarketingDashboard("co-1");

    expect(result.budget).toBe(1500);
    expect(result.spend).toBe(1000);
    expect(result.leads).toBe(7);
    expect(result.customers).toBe(2);
    expect(result.roas).toBeCloseTo(6000 / 1000);
  });
});
