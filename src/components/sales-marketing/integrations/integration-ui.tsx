"use client";

import { Badge } from "../pricing/pricing-ui";

export { Badge, CARD } from "../pricing/pricing-ui";
export { send, useApi } from "../commissions/commission-ui";

/** Phase 16 — shared bits of the S&M integration screens (DTOs mirror the services). */

export const INT_API = "/api/v1/sales-marketing/integrations";
export const INT_PAGE = "/sales-marketing/integrations";

type Tone = "zinc" | "green" | "amber" | "indigo" | "red";
const TONES: Record<string, Tone> = { zinc: "zinc", green: "green", amber: "amber", indigo: "indigo", red: "red" };
export const toneOf = (t: string | null | undefined): Tone => TONES[t ?? "zinc"] ?? "zinc";
export function StatusBadge({ label, tone }: { label: string; tone: string }) {
  return <Badge tone={toneOf(tone)}>{label}</Badge>;
}

export interface IntegrationRow {
  id: string;
  kind: string;
  kindLabel: string;
  managedIn: "SALES_MARKETING" | "CRM";
  manageHref: string | null;
  provider: string;
  providerLabel: string;
  liveVerified: boolean | null;
  name: string;
  status: string;
  statusLabel: string;
  statusTone: string;
  statusReason: string | null;
  statusChangedAt: string;
  capabilities: { key: string; label: string }[];
  authMethod: string;
  credentialRef: string | null;
  credentialRotatedAt: string | null;
  resourceType: string;
  resourceId: string;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  lastCheckedAt: string | null;
  version: number;
}

export interface IntegrationDetail extends IntegrationRow {
  detail: {
    apiKey?: ApiKeyDto | null;
    usage24h?: UsageRow[];
    usage7d?: UsageRow[];
    checkpoints?: { id: string; stream: string; lastSourceAt: string | null; lastRunAt: string | null; created: number; updated: number; unchanged: number; staleIgnored: number; conflicts: number; failed: number; lastError: string | null }[];
    openConflicts?: number;
    subscription?: WebhookDto | null;
    callbacks24h?: { accepted: number; rejected: number; waitingToProcess: number; failedToProcess: number };
    notLiveVerified?: boolean;
  };
  history: { id: string; action: string; at: string; by: string | null; changed: string[] }[];
}

export interface UsageRow {
  endpoint: string;
  requests: number;
  errors: number;
  refused: number;
  rateLimited: number;
  lastAt: string | null;
}

export interface ApiKeyDto {
  id: string;
  name: string;
  description: string | null;
  keyPreview: string;
  scopes: string[];
  rateLimitPerMinute: number;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  rotatedFromId: string | null;
  createdAt: string;
  actsAs: { id: string; name: string };
  state: "ACTIVE" | "REVOKED" | "EXPIRED" | "OWNER_INACTIVE";
}

export interface WebhookDto {
  id: string;
  name: string;
  description: string | null;
  url: string;
  eventTypes: string[];
  isActive: boolean;
  secret: { configured: boolean; masked: string; rotatedAt: string | null };
  health: "DISABLED" | "NEEDS_ATTENTION" | "LAST_FAILED" | "HEALTHY" | "NO_DELIVERIES";
  lastDeliveryAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  consecutiveFailures: number;
  version: number;
  deliveryCounts?: Record<string, number>;
}

export interface DeliveryRow {
  id: string;
  eventId: string | null;
  eventType: string;
  isTest: boolean;
  status: string;
  statusLabel: string;
  attempts: number;
  nextAttemptAt: string | null;
  responseStatus: number | null;
  durationMs: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  lastAttemptAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
}

export interface ConflictRow {
  id: string;
  status: string;
  field: string;
  reason: string;
  reasonLabel: string;
  erpValue: unknown;
  externalValue: unknown;
  canApply: boolean;
  record: { type: string; id: string; number: string | null; href: string };
  external: { system: string; id: string };
  sourceUpdatedAt: string | null;
  detectedAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolutionNote: string | null;
}

export interface MetricsDto {
  api: { requests: number; errorRatePercent: number | null; errors: number; refused: number; rateLimited: number; keys: number };
  webhooks: { delivered: number; failed: number; successRatePercent: number | null; pending: number; retried: number; queueLatencySeconds: number };
  inbound: { accepted: number; rejected: number };
  sync: { openConflicts: number; lastRunAt: string | null };
  events: { lastPublishedAt: string | null };
  registry: Record<string, number>;
}

export const WEBHOOK_HEALTH: Record<string, { label: string; tone: Tone }> = {
  HEALTHY: { label: "Delivering", tone: "green" },
  LAST_FAILED: { label: "Last delivery failed", tone: "amber" },
  NEEDS_ATTENTION: { label: "Needs attention", tone: "red" },
  NO_DELIVERIES: { label: "No deliveries yet", tone: "zinc" },
  DISABLED: { label: "Disabled", tone: "zinc" },
};

export const KEY_STATE: Record<string, { label: string; tone: Tone }> = {
  ACTIVE: { label: "Active", tone: "green" },
  EXPIRED: { label: "Expired", tone: "red" },
  REVOKED: { label: "Revoked", tone: "red" },
  OWNER_INACTIVE: { label: "User inactive", tone: "amber" },
};

export const fmtValue = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : typeof v === "string" ? v : JSON.stringify(v));
