import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { decryptSecret, encryptSecret } from "@/core/security/encryption";
import { signOAuthState, verifyOAuthState } from "@/core/security/oauth-state";
import { CampaignRepository } from "@/modules/marketing/campaign.repository";
import { recordDailyMetric } from "@/modules/marketing/campaign.service";
import {
  exchangeGoogleCodeForToken,
  fetchGoogleAccessibleCustomers,
  fetchGoogleCampaigns,
  fetchGoogleDailyMetrics,
  getGoogleAuthorizationUrl,
  isGoogleAdsConfigured,
  refreshGoogleAccessToken,
} from "./google-ads.client";
import {
  exchangeMetaCodeForToken,
  exchangeMetaLongLivedToken,
  fetchMetaAdAccounts,
  fetchMetaCampaigns,
  fetchMetaDailyInsights,
  getMetaAuthorizationUrl,
  isMetaConfigured,
} from "./meta-ads.client";
import { AdAccountConnectionRepository, AdCampaignLinkRepository } from "./ad-integration.repository";
import type { AdPlatformValue } from "./ad-integration.schema";

export interface ActorContext {
  companyId: string;
  userId: string;
  branchId?: string | null;
}

function baseUrl(): string {
  const url = process.env.NEXTAUTH_URL;
  if (!url) throw new Error("NEXTAUTH_URL must be set to build an OAuth redirect URI.");
  return url;
}

function redirectUriFor(platform: AdPlatformValue): string {
  return `${baseUrl()}/api/v1/ad-integrations/connect/${platform.toLowerCase()}/callback`;
}

export function getAdIntegrationConfigStatus() {
  return { META: isMetaConfigured(), GOOGLE: isGoogleAdsConfigured() };
}

export async function listAdAccountConnections(companyId: string) {
  return AdAccountConnectionRepository.findMany(companyId);
}

export function initiateAdIntegrationConnection(actor: ActorContext, platform: AdPlatformValue): string {
  const configured = platform === "META" ? isMetaConfigured() : isGoogleAdsConfigured();
  if (!configured) {
    throw new BusinessRuleError(
      "AD_INTEGRATION_NOT_CONFIGURED",
      `${platform === "META" ? "Meta" : "Google"} Ads integration is not configured — set the required environment variables first.`
    );
  }

  const state = signOAuthState({ companyId: actor.companyId, userId: actor.userId, platform });
  const redirectUri = redirectUriFor(platform);
  return platform === "META" ? getMetaAuthorizationUrl(redirectUri, state) : getGoogleAuthorizationUrl(redirectUri, state);
}

/**
 * Handles the OAuth redirect back from Meta/Google. Deliberately connects
 * EVERY ad account/customer the granted token can see, rather than pausing
 * mid-flow for the user to pick one — the common case (a single business
 * with one ad account) needs zero extra clicks, and a business with several
 * can disconnect the ones it doesn't want from the connections list. This
 * also avoids needing a server-side "pending token" cache for a multi-step
 * picker, which would be real complexity for a case most callers won't hit.
 */
export async function handleAdIntegrationCallback(platform: AdPlatformValue, code: string, state: string) {
  const payload = verifyOAuthState(state);
  if (!payload || payload.platform !== platform) {
    throw new BusinessRuleError("VALIDATION_ERROR", "This connection link is invalid or has expired — start connecting again.");
  }

  const actor: ActorContext = { companyId: payload.companyId, userId: payload.userId };
  const redirectUri = redirectUriFor(platform);

  const connections =
    platform === "META" ? await connectMetaAccounts(actor, code, redirectUri) : await connectGoogleAccounts(actor, code, redirectUri);

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "ad_account_connections",
    recordId: connections[0]?.id ?? "none",
    action: "CREATE",
    newValues: { platform, accountsConnected: connections.length },
  });

  return connections;
}

async function connectMetaAccounts(actor: ActorContext, code: string, redirectUri: string) {
  const shortLived = await exchangeMetaCodeForToken(code, redirectUri);
  const longLived = await exchangeMetaLongLivedToken(shortLived.access_token);
  const accessToken = longLived.access_token;
  const expiresAt = longLived.expires_in ? new Date(Date.now() + longLived.expires_in * 1000) : null;

  const adAccounts = await fetchMetaAdAccounts(accessToken);
  const connections = [];
  for (const account of adAccounts) {
    const connection = await AdAccountConnectionRepository.upsertByExternalAccount({
      companyId: actor.companyId,
      platform: "META",
      externalAccountId: account.account_id,
      accountName: account.name,
      accessTokenEncrypted: encryptSecret(accessToken),
      refreshTokenEncrypted: null,
      tokenExpiresAt: expiresAt,
      connectedByUserId: actor.userId,
    });
    await refreshCampaignLinks(connection.id, await fetchMetaCampaigns(accessToken, account.account_id));
    connections.push(connection);
  }
  return connections;
}

async function connectGoogleAccounts(actor: ActorContext, code: string, redirectUri: string) {
  const token = await exchangeGoogleCodeForToken(code, redirectUri);
  const expiresAt = new Date(Date.now() + token.expires_in * 1000);
  const customerIds = await fetchGoogleAccessibleCustomers(token.access_token);

  const connections = [];
  for (const customerId of customerIds) {
    const connection = await AdAccountConnectionRepository.upsertByExternalAccount({
      companyId: actor.companyId,
      platform: "GOOGLE",
      externalAccountId: customerId,
      accountName: `Google Ads Customer ${customerId}`,
      accessTokenEncrypted: encryptSecret(token.access_token),
      refreshTokenEncrypted: token.refresh_token ? encryptSecret(token.refresh_token) : null,
      tokenExpiresAt: expiresAt,
      connectedByUserId: actor.userId,
    });
    await refreshCampaignLinks(connection.id, await fetchGoogleCampaigns(token.access_token, customerId));
    connections.push(connection);
  }
  return connections;
}

async function refreshCampaignLinks(connectionId: string, campaigns: Array<{ id: string; name: string }>) {
  for (const campaign of campaigns) {
    await AdCampaignLinkRepository.upsertExternalCampaign(connectionId, campaign.id, campaign.name);
  }
}

export async function linkAdCampaign(actor: ActorContext, connectionId: string, linkId: string, localCampaignId: string | null) {
  const connection = await AdAccountConnectionRepository.findAnyById(actor.companyId, connectionId);
  if (!connection) throw new BusinessRuleError("NOT_FOUND", "Ad account connection not found.", { id: connectionId });

  const link = await AdCampaignLinkRepository.findByIdInConnection(connectionId, linkId);
  if (!link) throw new BusinessRuleError("NOT_FOUND", "Ad campaign link not found.", { id: linkId });

  if (localCampaignId) {
    const localCampaign = await CampaignRepository.findAnyById(actor.companyId, localCampaignId);
    if (!localCampaign) throw new BusinessRuleError("NOT_FOUND", "Campaign not found.", { id: localCampaignId });
  }

  const updated = await AdCampaignLinkRepository.setLocalCampaign(linkId, localCampaignId);

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "ad_campaign_links",
    recordId: linkId,
    action: "UPDATE",
    oldValues: { localCampaignId: link.localCampaignId },
    newValues: { localCampaignId },
  });

  return updated;
}

export async function disconnectAdAccountConnection(actor: ActorContext, connectionId: string) {
  const connection = await AdAccountConnectionRepository.findAnyById(actor.companyId, connectionId);
  if (!connection) throw new BusinessRuleError("NOT_FOUND", "Ad account connection not found.", { id: connectionId });

  const updated = await AdAccountConnectionRepository.updateStatus(connectionId, "DISCONNECTED");

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "ad_account_connections",
    recordId: connectionId,
    action: "CANCEL",
    oldValues: { status: connection.status },
    newValues: { status: "DISCONNECTED" },
  });

  return updated;
}

function toDateOnly(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Manual trigger only — matches this project's established convention (no
 * background job runner exists: "Run Automation Now", "Check for Due
 * Follow-ups", "Generate Re-engagement Follow-ups" are all the same shape).
 * Every metric row is written through the exact same `recordDailyMetric`
 * the manual UI form and CSV import both already use — same governance
 * (the linked local Campaign must be APPROVED), same upsert-by-date
 * semantics, zero duplicated logic.
 */
export async function syncAdAccountConnection(actor: ActorContext, connectionId: string, daysBack: number) {
  const connection = await AdAccountConnectionRepository.findAnyById(actor.companyId, connectionId);
  if (!connection) throw new BusinessRuleError("NOT_FOUND", "Ad account connection not found.", { id: connectionId });

  if (connection.status === "DISCONNECTED") {
    throw new BusinessRuleError("AD_SYNC_FAILED", "This connection is disconnected — reconnect before syncing.");
  }

  const until = new Date();
  const since = new Date(until.getTime() - daysBack * 24 * 60 * 60 * 1000);
  const sinceStr = toDateOnly(since);
  const untilStr = toDateOnly(until);

  let metricsWritten = 0;
  const skipped: Array<{ localCampaignId: string; reason: string }> = [];

  try {
    const rows =
      connection.platform === "META"
        ? await fetchMetaDailyInsights(decryptSecret(connection.accessTokenEncrypted), connection.externalAccountId, sinceStr, untilStr)
        : await syncGoogleWithRefresh(connection, sinceStr, untilStr);

    const localCampaignByExternalId = new Map(
      connection.campaignLinks.filter((l) => l.localCampaignId).map((l) => [l.externalCampaignId, l.localCampaignId as string])
    );

    for (const row of rows) {
      const localCampaignId = localCampaignByExternalId.get(row.campaignId);
      if (!localCampaignId) continue; // not linked to a local Campaign — nothing to write yet

      try {
        await recordDailyMetric(actor, localCampaignId, {
          metricDate: row.date,
          spend: row.spend,
          impressions: row.impressions,
          clicks: row.clicks,
          notes: `Synced from ${connection.platform === "META" ? "Meta Ads" : "Google Ads"}`,
        });
        metricsWritten++;
      } catch (error) {
        skipped.push({ localCampaignId, reason: error instanceof Error ? error.message : "Unknown error" });
      }
    }

    await AdAccountConnectionRepository.updateSyncResult(connectionId, { status: "CONNECTED", lastSyncedAt: new Date(), lastSyncError: null });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown sync error";
    await AdAccountConnectionRepository.updateSyncResult(connectionId, { status: "ERROR", lastSyncedAt: new Date(), lastSyncError: message });
    throw new BusinessRuleError("AD_SYNC_FAILED", `Sync failed: ${message}`);
  }

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "ad_account_connections",
    recordId: connectionId,
    action: "UPDATE",
    newValues: { syncedDaysBack: daysBack, metricsWritten, skippedCount: skipped.length },
  });

  return { metricsWritten, skipped };
}

async function syncGoogleWithRefresh(
  connection: { id: string; accessTokenEncrypted: string; refreshTokenEncrypted: string | null; externalAccountId: string },
  since: string,
  until: string
) {
  try {
    const accessToken = decryptSecret(connection.accessTokenEncrypted);
    return await fetchGoogleDailyMetrics(accessToken, connection.externalAccountId, since, until);
  } catch {
    // Google access tokens are short-lived (~1h) — an expired one is the
    // expected, common case, not a genuine error. Refresh once and retry
    // before giving up.
    if (!connection.refreshTokenEncrypted) throw new Error("Access token expired and no refresh token is stored — reconnect this account.");
    const refreshToken = decryptSecret(connection.refreshTokenEncrypted);
    const refreshed = await refreshGoogleAccessToken(refreshToken);
    await AdAccountConnectionRepository.updateTokens(connection.id, {
      accessTokenEncrypted: encryptSecret(refreshed.access_token),
      tokenExpiresAt: new Date(Date.now() + refreshed.expires_in * 1000),
    });
    return fetchGoogleDailyMetrics(refreshed.access_token, connection.externalAccountId, since, until);
  }
}
