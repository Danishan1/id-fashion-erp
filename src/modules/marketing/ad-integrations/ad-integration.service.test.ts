import { beforeEach, describe, expect, it, vi } from "vitest";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/core/security/encryption", () => ({
  encryptSecret: vi.fn((v: string) => `enc(${v})`),
  decryptSecret: vi.fn((v: string) => v.replace(/^enc\(/, "").replace(/\)$/, "")),
}));
vi.mock("@/core/security/oauth-state", () => ({
  signOAuthState: vi.fn(() => "signed-state"),
  verifyOAuthState: vi.fn(),
}));
vi.mock("@/modules/marketing/campaign.repository", () => ({
  CampaignRepository: { findAnyById: vi.fn() },
}));
vi.mock("@/modules/marketing/campaign.service", () => ({ recordDailyMetric: vi.fn() }));
vi.mock("./meta-ads.client", () => ({
  isMetaConfigured: vi.fn(() => true),
  getMetaAuthorizationUrl: vi.fn(() => "https://facebook.example/oauth"),
  exchangeMetaCodeForToken: vi.fn(),
  exchangeMetaLongLivedToken: vi.fn(),
  fetchMetaAdAccounts: vi.fn(),
  fetchMetaCampaigns: vi.fn(),
  fetchMetaDailyInsights: vi.fn(),
}));
vi.mock("./google-ads.client", () => ({
  isGoogleAdsConfigured: vi.fn(() => true),
  getGoogleAuthorizationUrl: vi.fn(() => "https://google.example/oauth"),
  exchangeGoogleCodeForToken: vi.fn(),
  fetchGoogleAccessibleCustomers: vi.fn(),
  fetchGoogleCampaigns: vi.fn(),
  fetchGoogleDailyMetrics: vi.fn(),
  refreshGoogleAccessToken: vi.fn(),
}));
vi.mock("./ad-integration.repository", () => ({
  AdAccountConnectionRepository: {
    findMany: vi.fn(),
    findAnyById: vi.fn(),
    upsertByExternalAccount: vi.fn(),
    updateTokens: vi.fn(),
    updateSyncResult: vi.fn(),
    updateStatus: vi.fn(),
  },
  AdCampaignLinkRepository: {
    upsertExternalCampaign: vi.fn(),
    findByIdInConnection: vi.fn(),
    setLocalCampaign: vi.fn(),
  },
}));

const { verifyOAuthState } = await import("@/core/security/oauth-state");
const { CampaignRepository } = await import("@/modules/marketing/campaign.repository");
const { recordDailyMetric } = await import("@/modules/marketing/campaign.service");
const metaClient = await import("./meta-ads.client");
const googleClient = await import("./google-ads.client");
const { AdAccountConnectionRepository, AdCampaignLinkRepository } = await import("./ad-integration.repository");
const {
  getAdIntegrationConfigStatus,
  initiateAdIntegrationConnection,
  handleAdIntegrationCallback,
  linkAdCampaign,
  disconnectAdAccountConnection,
  syncAdAccountConnection,
} = await import("./ad-integration.service");

const actor = { companyId: "co-1", userId: "user-1" };

beforeEach(() => {
  process.env.NEXTAUTH_URL = "http://localhost:3000";
  vi.mocked(metaClient.isMetaConfigured).mockReset().mockReturnValue(true);
  vi.mocked(googleClient.isGoogleAdsConfigured).mockReset().mockReturnValue(true);
  vi.mocked(verifyOAuthState).mockReset();
  vi.mocked(CampaignRepository.findAnyById).mockReset();
  vi.mocked(recordDailyMetric).mockReset().mockResolvedValue({} as never);
  vi.mocked(AdAccountConnectionRepository.findAnyById).mockReset();
  vi.mocked(AdAccountConnectionRepository.updateStatus).mockReset().mockResolvedValue({ id: "conn-1", status: "DISCONNECTED" } as never);
  vi.mocked(AdAccountConnectionRepository.updateSyncResult).mockReset().mockResolvedValue({} as never);
  vi.mocked(AdCampaignLinkRepository.findByIdInConnection).mockReset();
  vi.mocked(AdCampaignLinkRepository.setLocalCampaign).mockReset().mockResolvedValue({ id: "link-1", localCampaignId: "camp-1" } as never);
});

describe("getAdIntegrationConfigStatus", () => {
  it("reflects each platform's own configured() check", () => {
    vi.mocked(metaClient.isMetaConfigured).mockReturnValue(true);
    vi.mocked(googleClient.isGoogleAdsConfigured).mockReturnValue(false);
    expect(getAdIntegrationConfigStatus()).toEqual({ META: true, GOOGLE: false });
  });
});

describe("initiateAdIntegrationConnection", () => {
  it("returns a real authorization URL when the platform is configured", () => {
    const url = initiateAdIntegrationConnection(actor, "META");
    expect(url).toBe("https://facebook.example/oauth");
  });

  it("throws AD_INTEGRATION_NOT_CONFIGURED when the platform's env vars are missing", () => {
    vi.mocked(metaClient.isMetaConfigured).mockReturnValue(false);
    expect(() => initiateAdIntegrationConnection(actor, "META")).toThrow(BusinessRuleError);
    try {
      initiateAdIntegrationConnection(actor, "META");
    } catch (error) {
      expect((error as BusinessRuleError).code).toBe("AD_INTEGRATION_NOT_CONFIGURED");
    }
  });
});

describe("handleAdIntegrationCallback", () => {
  it("rejects a state that fails verification without calling any platform API", async () => {
    vi.mocked(verifyOAuthState).mockReturnValue(null);
    await expect(handleAdIntegrationCallback("META", "code-123", "bad-state")).rejects.toThrow(BusinessRuleError);
    expect(metaClient.exchangeMetaCodeForToken).not.toHaveBeenCalled();
  });

  it("rejects a state whose platform doesn't match the callback route", async () => {
    vi.mocked(verifyOAuthState).mockReturnValue({ companyId: "co-1", userId: "user-1", platform: "GOOGLE", issuedAt: Date.now() });
    await expect(handleAdIntegrationCallback("META", "code-123", "state")).rejects.toThrow(BusinessRuleError);
  });

  it("connects every ad account the token can see, one AdAccountConnection row each", async () => {
    vi.mocked(verifyOAuthState).mockReturnValue({ companyId: "co-1", userId: "user-1", platform: "META", issuedAt: Date.now() });
    vi.mocked(metaClient.exchangeMetaCodeForToken).mockResolvedValue({ access_token: "short-lived", token_type: "bearer" });
    vi.mocked(metaClient.exchangeMetaLongLivedToken).mockResolvedValue({ access_token: "long-lived-token", token_type: "bearer", expires_in: 5184000 });
    vi.mocked(metaClient.fetchMetaAdAccounts).mockResolvedValue([
      { id: "act_111", account_id: "111", name: "Account One" },
      { id: "act_222", account_id: "222", name: "Account Two" },
    ]);
    vi.mocked(metaClient.fetchMetaCampaigns).mockResolvedValue([{ id: "camp-ext-1", name: "External Campaign" }]);
    vi.mocked(AdAccountConnectionRepository.upsertByExternalAccount).mockImplementation(
      (data) => Promise.resolve({ id: `conn-${data.externalAccountId}`, ...data }) as never
    );

    const result = await handleAdIntegrationCallback("META", "code-123", "state");

    expect(result).toHaveLength(2);
    expect(AdAccountConnectionRepository.upsertByExternalAccount).toHaveBeenCalledTimes(2);
    expect(AdCampaignLinkRepository.upsertExternalCampaign).toHaveBeenCalledWith("conn-111", "camp-ext-1", "External Campaign");
  });
});

describe("linkAdCampaign", () => {
  it("validates the local campaign belongs to the actor's company before linking", async () => {
    vi.mocked(AdAccountConnectionRepository.findAnyById).mockResolvedValue({ id: "conn-1", campaignLinks: [] } as never);
    vi.mocked(AdCampaignLinkRepository.findByIdInConnection).mockResolvedValue({ id: "link-1", localCampaignId: null } as never);
    vi.mocked(CampaignRepository.findAnyById).mockResolvedValue(null);

    await expect(linkAdCampaign(actor, "conn-1", "link-1", "camp-not-in-company")).rejects.toThrow(BusinessRuleError);
    expect(AdCampaignLinkRepository.setLocalCampaign).not.toHaveBeenCalled();
  });

  it("links successfully once the local campaign is confirmed to exist in-company", async () => {
    vi.mocked(AdAccountConnectionRepository.findAnyById).mockResolvedValue({ id: "conn-1", campaignLinks: [] } as never);
    vi.mocked(AdCampaignLinkRepository.findByIdInConnection).mockResolvedValue({ id: "link-1", localCampaignId: null } as never);
    vi.mocked(CampaignRepository.findAnyById).mockResolvedValue({ id: "camp-1" } as never);

    await linkAdCampaign(actor, "conn-1", "link-1", "camp-1");
    expect(AdCampaignLinkRepository.setLocalCampaign).toHaveBeenCalledWith("link-1", "camp-1");
  });

  it("allows clearing a link back to unlinked with null", async () => {
    vi.mocked(AdAccountConnectionRepository.findAnyById).mockResolvedValue({ id: "conn-1", campaignLinks: [] } as never);
    vi.mocked(AdCampaignLinkRepository.findByIdInConnection).mockResolvedValue({ id: "link-1", localCampaignId: "camp-1" } as never);

    await linkAdCampaign(actor, "conn-1", "link-1", null);
    expect(CampaignRepository.findAnyById).not.toHaveBeenCalled();
    expect(AdCampaignLinkRepository.setLocalCampaign).toHaveBeenCalledWith("link-1", null);
  });
});

describe("disconnectAdAccountConnection", () => {
  it("sets status to DISCONNECTED for a connection owned by the actor's company", async () => {
    vi.mocked(AdAccountConnectionRepository.findAnyById).mockResolvedValue({ id: "conn-1", status: "CONNECTED", campaignLinks: [] } as never);
    await disconnectAdAccountConnection(actor, "conn-1");
    expect(AdAccountConnectionRepository.updateStatus).toHaveBeenCalledWith("conn-1", "DISCONNECTED");
  });

  it("404s for a connection that doesn't belong to the actor's company", async () => {
    vi.mocked(AdAccountConnectionRepository.findAnyById).mockResolvedValue(null);
    await expect(disconnectAdAccountConnection(actor, "conn-other-company")).rejects.toThrow(BusinessRuleError);
  });
});

describe("syncAdAccountConnection", () => {
  it("refuses to sync a disconnected connection", async () => {
    vi.mocked(AdAccountConnectionRepository.findAnyById).mockResolvedValue({ id: "conn-1", status: "DISCONNECTED" } as never);
    await expect(syncAdAccountConnection(actor, "conn-1", 7)).rejects.toThrow(BusinessRuleError);
  });

  it("writes a metric only for links that have a localCampaignId, skipping unlinked external campaigns", async () => {
    vi.mocked(AdAccountConnectionRepository.findAnyById).mockResolvedValue({
      id: "conn-1",
      status: "CONNECTED",
      platform: "META",
      externalAccountId: "111",
      accessTokenEncrypted: "enc(token-abc)",
      campaignLinks: [
        { externalCampaignId: "camp-ext-1", localCampaignId: "local-camp-1" },
        { externalCampaignId: "camp-ext-2", localCampaignId: null },
      ],
    } as never);
    vi.mocked(metaClient.fetchMetaDailyInsights).mockResolvedValue([
      { campaignId: "camp-ext-1", date: "2026-08-20", spend: 500, impressions: 1000, clicks: 20 },
      { campaignId: "camp-ext-2", date: "2026-08-20", spend: 300, impressions: 800, clicks: 10 },
    ]);

    const result = await syncAdAccountConnection(actor, "conn-1", 7);

    expect(result.metricsWritten).toBe(1);
    expect(recordDailyMetric).toHaveBeenCalledTimes(1);
    expect(recordDailyMetric).toHaveBeenCalledWith(actor, "local-camp-1", expect.objectContaining({ metricDate: "2026-08-20", spend: 500 }));
    expect(AdAccountConnectionRepository.updateSyncResult).toHaveBeenCalledWith("conn-1", expect.objectContaining({ status: "CONNECTED", lastSyncError: null }));
  });

  it("records a per-link failure as skipped without aborting the rest of the sync", async () => {
    vi.mocked(AdAccountConnectionRepository.findAnyById).mockResolvedValue({
      id: "conn-1",
      status: "CONNECTED",
      platform: "META",
      externalAccountId: "111",
      accessTokenEncrypted: "enc(token-abc)",
      campaignLinks: [
        { externalCampaignId: "camp-ext-1", localCampaignId: "local-camp-1" },
        { externalCampaignId: "camp-ext-2", localCampaignId: "local-camp-2" },
      ],
    } as never);
    vi.mocked(metaClient.fetchMetaDailyInsights).mockResolvedValue([
      { campaignId: "camp-ext-1", date: "2026-08-20", spend: 500, impressions: 1000, clicks: 20 },
      { campaignId: "camp-ext-2", date: "2026-08-20", spend: 300, impressions: 800, clicks: 10 },
    ]);
    vi.mocked(recordDailyMetric)
      .mockResolvedValueOnce({} as never)
      .mockRejectedValueOnce(new BusinessRuleError("INVALID_STATE_TRANSITION", "Campaign not approved yet."));

    const result = await syncAdAccountConnection(actor, "conn-1", 7);

    expect(result.metricsWritten).toBe(1);
    expect(result.skipped).toEqual([{ localCampaignId: "local-camp-2", reason: "Campaign not approved yet." }]);
  });

  it("marks the connection ERROR (not DISCONNECTED) when the platform API call itself fails", async () => {
    vi.mocked(AdAccountConnectionRepository.findAnyById).mockResolvedValue({
      id: "conn-1",
      status: "CONNECTED",
      platform: "META",
      externalAccountId: "111",
      accessTokenEncrypted: "enc(token-abc)",
      campaignLinks: [],
    } as never);
    vi.mocked(metaClient.fetchMetaDailyInsights).mockRejectedValue(new Error("Invalid OAuth access token"));

    await expect(syncAdAccountConnection(actor, "conn-1", 7)).rejects.toThrow(BusinessRuleError);
    expect(AdAccountConnectionRepository.updateSyncResult).toHaveBeenCalledWith(
      "conn-1",
      expect.objectContaining({ status: "ERROR", lastSyncError: "Invalid OAuth access token" })
    );
  });

  it("refreshes an expired Google access token once and retries before giving up", async () => {
    vi.mocked(AdAccountConnectionRepository.findAnyById).mockResolvedValue({
      id: "conn-2",
      status: "CONNECTED",
      platform: "GOOGLE",
      externalAccountId: "999",
      accessTokenEncrypted: "enc(expired-token)",
      refreshTokenEncrypted: "enc(refresh-token)",
      campaignLinks: [{ externalCampaignId: "g-camp-1", localCampaignId: "local-camp-3" }],
    } as never);
    vi.mocked(googleClient.fetchGoogleDailyMetrics)
      .mockRejectedValueOnce(new Error("token expired"))
      .mockResolvedValueOnce([{ campaignId: "g-camp-1", date: "2026-08-20", spend: 100, impressions: 500, clicks: 5 }]);
    vi.mocked(googleClient.refreshGoogleAccessToken).mockResolvedValue({ access_token: "fresh-token", expires_in: 3600, token_type: "bearer" });

    const result = await syncAdAccountConnection(actor, "conn-2", 7);

    expect(result.metricsWritten).toBe(1);
    expect(AdAccountConnectionRepository.updateTokens).toHaveBeenCalledWith("conn-2", expect.objectContaining({ accessTokenEncrypted: "enc(fresh-token)" }));
  });
});
