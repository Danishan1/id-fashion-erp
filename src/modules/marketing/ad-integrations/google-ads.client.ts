/**
 * Thin HTTP wrapper around Google's OAuth2 endpoints + the Google Ads API
 * (GAQL search). Same "no business logic here" rule as the Meta client.
 *
 * UNVERIFIED PENDING REAL CREDENTIALS: written against the public Google
 * Ads API v17 / OAuth2 docs, but this project has no real Google Cloud OAuth
 * Client or Developer Token to exercise it against yet.
 */
const GOOGLE_ADS_API_VERSION = "v17";
const GOOGLE_ADS_BASE = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}`;

export function isGoogleAdsConfigured(): boolean {
  return !!(process.env.GOOGLE_ADS_CLIENT_ID && process.env.GOOGLE_ADS_CLIENT_SECRET && process.env.GOOGLE_ADS_DEVELOPER_TOKEN);
}

export function getGoogleAuthorizationUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_ADS_CLIENT_ID ?? "",
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "https://www.googleapis.com/auth/adwords",
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
}

async function googleOAuthFetch(body: Record<string, string>): Promise<GoogleTokenResponse> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(json?.error_description ?? json?.error ?? `Google OAuth request failed with status ${res.status}`);
  }
  return json as GoogleTokenResponse;
}

export async function exchangeGoogleCodeForToken(code: string, redirectUri: string): Promise<GoogleTokenResponse> {
  return googleOAuthFetch({
    code,
    client_id: process.env.GOOGLE_ADS_CLIENT_ID ?? "",
    client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET ?? "",
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
}

export async function refreshGoogleAccessToken(refreshToken: string): Promise<GoogleTokenResponse> {
  return googleOAuthFetch({
    refresh_token: refreshToken,
    client_id: process.env.GOOGLE_ADS_CLIENT_ID ?? "",
    client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET ?? "",
    grant_type: "refresh_token",
  });
}

async function googleAdsFetch<T>(path: string, accessToken: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${GOOGLE_ADS_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "developer-token": process.env.GOOGLE_ADS_DEVELOPER_TOKEN ?? "",
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  const body = await res.json();
  if (!res.ok) {
    const message = body?.error?.message ?? `Google Ads API request failed with status ${res.status}`;
    throw new Error(message);
  }
  return body as T;
}

export async function fetchGoogleAccessibleCustomers(accessToken: string): Promise<string[]> {
  const body = await googleAdsFetch<{ resourceNames: string[] }>("/customers:listAccessibleCustomers", accessToken);
  // "customers/1234567890" -> "1234567890"
  return body.resourceNames.map((name) => name.split("/")[1]);
}

export interface GoogleCampaign {
  id: string;
  name: string;
}

export async function fetchGoogleCampaigns(accessToken: string, customerId: string): Promise<GoogleCampaign[]> {
  const body = await googleAdsFetch<{ results?: Array<{ campaign: { id: string; name: string } }> }>(
    `/customers/${customerId}/googleAds:search`,
    accessToken,
    { method: "POST", body: JSON.stringify({ query: "SELECT campaign.id, campaign.name FROM campaign WHERE campaign.status != 'REMOVED'" }) }
  );
  return (body.results ?? []).map((row) => ({ id: String(row.campaign.id), name: row.campaign.name }));
}

export interface GoogleDailyMetric {
  campaignId: string;
  date: string;
  spend: number;
  impressions: number;
  clicks: number;
}

export async function fetchGoogleDailyMetrics(accessToken: string, customerId: string, since: string, until: string): Promise<GoogleDailyMetric[]> {
  const query = `SELECT campaign.id, segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks
    FROM campaign
    WHERE segments.date BETWEEN '${since}' AND '${until}'`;
  const body = await googleAdsFetch<{
    results?: Array<{ campaign: { id: string }; segments: { date: string }; metrics: { costMicros?: string; impressions?: string; clicks?: string } }>;
  }>(`/customers/${customerId}/googleAds:search`, accessToken, { method: "POST", body: JSON.stringify({ query }) });

  return (body.results ?? []).map((row) => ({
    campaignId: String(row.campaign.id),
    date: row.segments.date,
    // Google reports cost in micros (millionths of the account currency).
    spend: Number(row.metrics.costMicros ?? 0) / 1_000_000,
    impressions: Number(row.metrics.impressions ?? 0),
    clicks: Number(row.metrics.clicks ?? 0),
  }));
}
