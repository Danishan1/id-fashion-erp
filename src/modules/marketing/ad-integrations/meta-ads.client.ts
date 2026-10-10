/**
 * Thin HTTP wrapper around Meta's Graph/Marketing API — no business logic
 * here at all (that's `ad-sync.service.ts`'s job), just request shaping and
 * response parsing, so this file is the one place that needs to change if
 * Meta ever revs the API version. Every call is a plain `fetch` — no new
 * npm dependency.
 *
 * UNVERIFIED PENDING REAL CREDENTIALS: written against Meta's public Graph
 * API v21.0 docs, but this project has no real Meta App to exercise it
 * against yet. Do not treat this as tested — treat it as ready to test the
 * moment `META_APP_ID`/`META_APP_SECRET` are set to real values.
 */
const GRAPH_API_VERSION = "v21.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

export function isMetaConfigured(): boolean {
  return !!(process.env.META_APP_ID && process.env.META_APP_SECRET);
}

export function getMetaAuthorizationUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.META_APP_ID ?? "",
    redirect_uri: redirectUri,
    state,
    scope: "ads_read,business_management",
    response_type: "code",
  });
  return `https://www.facebook.com/${GRAPH_API_VERSION}/dialog/oauth?${params.toString()}`;
}

interface MetaTokenResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
}

async function metaFetch<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const body = await res.json();
  if (!res.ok) {
    const message = body?.error?.message ?? `Meta API request failed with status ${res.status}`;
    throw new Error(message);
  }
  return body as T;
}

export async function exchangeMetaCodeForToken(code: string, redirectUri: string): Promise<MetaTokenResponse> {
  const params = new URLSearchParams({
    client_id: process.env.META_APP_ID ?? "",
    client_secret: process.env.META_APP_SECRET ?? "",
    redirect_uri: redirectUri,
    code,
  });
  return metaFetch<MetaTokenResponse>(`${GRAPH_BASE}/oauth/access_token?${params.toString()}`);
}

/** A short-lived token (~1-2h) must be exchanged for a long-lived one
 * (~60 days) right after the initial code exchange — Meta has no separate
 * refresh-token concept the way Google does. */
export async function exchangeMetaLongLivedToken(shortLivedToken: string): Promise<MetaTokenResponse> {
  const params = new URLSearchParams({
    grant_type: "fb_exchange_token",
    client_id: process.env.META_APP_ID ?? "",
    client_secret: process.env.META_APP_SECRET ?? "",
    fb_exchange_token: shortLivedToken,
  });
  return metaFetch<MetaTokenResponse>(`${GRAPH_BASE}/oauth/access_token?${params.toString()}`);
}

export interface MetaAdAccount {
  id: string;
  account_id: string;
  name: string;
}

export async function fetchMetaAdAccounts(accessToken: string): Promise<MetaAdAccount[]> {
  const params = new URLSearchParams({ fields: "id,account_id,name", access_token: accessToken });
  const body = await metaFetch<{ data: MetaAdAccount[] }>(`${GRAPH_BASE}/me/adaccounts?${params.toString()}`);
  return body.data;
}

export interface MetaCampaign {
  id: string;
  name: string;
}

export async function fetchMetaCampaigns(accessToken: string, adAccountId: string): Promise<MetaCampaign[]> {
  const params = new URLSearchParams({ fields: "id,name", access_token: accessToken, limit: "500" });
  const body = await metaFetch<{ data: MetaCampaign[] }>(`${GRAPH_BASE}/act_${adAccountId}/campaigns?${params.toString()}`);
  return body.data;
}

export interface MetaDailyInsight {
  campaignId: string;
  date: string;
  spend: number;
  impressions: number;
  clicks: number;
}

export async function fetchMetaDailyInsights(accessToken: string, adAccountId: string, since: string, until: string): Promise<MetaDailyInsight[]> {
  const params = new URLSearchParams({
    level: "campaign",
    fields: "campaign_id,spend,impressions,clicks,date_start",
    time_range: JSON.stringify({ since, until }),
    time_increment: "1",
    access_token: accessToken,
    limit: "500",
  });
  const body = await metaFetch<{ data: Array<{ campaign_id: string; date_start: string; spend: string; impressions: string; clicks: string }> }>(
    `${GRAPH_BASE}/act_${adAccountId}/insights?${params.toString()}`
  );
  return body.data.map((row) => ({
    campaignId: row.campaign_id,
    date: row.date_start,
    spend: Number(row.spend),
    impressions: Number(row.impressions),
    clicks: Number(row.clicks),
  }));
}
