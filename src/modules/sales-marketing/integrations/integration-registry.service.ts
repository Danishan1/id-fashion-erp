import { Prisma } from "@prisma/client";
import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { WEBHOOK_ATTENTION_THRESHOLD } from "@/modules/crm/webhooks-out/webhook-events";
import { MARKETING_PROVIDERS } from "@/modules/sales-marketing/delivery/delivery-registry";
import { SM_API_KEY_PURPOSE, SM_API_SCOPES, canIntegrationTransition, type IntegrationKind, type IntegrationStatus, type SmApiScope } from "./integration-registry";

/**
 * Phase 16 — the integration registry. Each row wraps an existing resource
 * (S&M API key, S&M or CRM webhook subscription, Phase 10 delivery connection,
 * CRM lead-capture key / incoming webhook). The resource keeps its own
 * configuration and secrets; the registry holds lifecycle, capabilities and
 * health, derived from what actually happened (calls, deliveries, tests,
 * callbacks). Only DISABLED (API clients) and REVOKED are set by a person;
 * every status change is checked against INTEGRATION_TRANSITIONS.
 */

export const RESOURCE_TYPE: Record<IntegrationKind, string> = {
  API_CLIENT: "crm_api_keys",
  CRM_CAPTURE_KEY: "crm_api_keys",
  WEBHOOK_SUBSCRIPTION: "crm_webhook_subscriptions",
  CRM_WEBHOOK_SUBSCRIPTION: "crm_webhook_subscriptions",
  DELIVERY_PROVIDER: "marketing_channel_connections",
  CRM_INBOUND_WEBHOOK: "crm_webhook_endpoints",
};

interface Derived {
  kind: IntegrationKind;
  resourceId: string;
  provider: string;
  name: string;
  capabilities: string[];
  authMethod: string;
  credentialRef: string | null;
  credentialRotatedAt: Date | null;
  managedIn: "SALES_MARKETING" | "CRM";
  status: IntegrationStatus;
  reason: string | null;
  lastSuccessAt: Date | null;
  lastErrorAt: Date | null;
  lastError: string | null;
}

const DAY = 86_400_000;
const hourOf = (d: Date) => new Date(Math.floor(d.getTime() / 3_600_000) * 3_600_000);
const maxDate = (...ds: (Date | null | undefined)[]) => ds.filter((d): d is Date => Boolean(d)).reduce<Date | null>((a, d) => (!a || d > a ? d : a), null);

// ── Usage counters (API calls, inbound callbacks) ────────────────

export type UsageOutcome = "ok" | "error" | "denied" | "rate_limited";

/** Hourly counters per client (API key or delivery connection) + endpoint. Never fails the request. */
export async function recordUsage(u: { companyId: string; clientId: string; endpoint: string; outcome: UsageOutcome; status: number }, now = new Date()) {
  const hour = hourOf(now);
  const err = u.outcome === "error" ? 1 : 0;
  const den = u.outcome === "denied" ? 1 : 0;
  const rl = u.outcome === "rate_limited" ? 1 : 0;
  await prisma.$executeRaw`
    INSERT INTO integration_api_usage (id, company_id, api_key_id, endpoint, hour, requests, errors, rate_limited, denied, last_status, updated_at)
    VALUES (gen_random_uuid(), ${u.companyId}::uuid, ${u.clientId}::uuid, ${u.endpoint.slice(0, 80)}, ${hour}, 1, ${err}, ${rl}, ${den}, ${u.status}, ${now})
    ON CONFLICT (api_key_id, endpoint, hour) DO UPDATE SET
      requests = integration_api_usage.requests + 1,
      errors = integration_api_usage.errors + ${err},
      rate_limited = integration_api_usage.rate_limited + ${rl},
      denied = integration_api_usage.denied + ${den},
      last_status = ${u.status},
      updated_at = ${now}`.catch((e) => console.error(JSON.stringify({ level: "warn", message: "Integration usage not recorded", error: (e as Error).message })));
}

async function usageSince(companyId: string, clientIds: string[], since: Date) {
  if (!clientIds.length) return new Map<string, { requests: number; errors: number; denied: number; rateLimited: number; lastErrorHour: Date | null }>();
  const rows = await prisma.integrationApiUsage.groupBy({
    by: ["apiKeyId"],
    where: { companyId, apiKeyId: { in: clientIds }, hour: { gte: hourOf(since) } },
    _sum: { requests: true, errors: true, denied: true, rateLimited: true },
  });
  const errHours = await prisma.integrationApiUsage.groupBy({ by: ["apiKeyId"], where: { companyId, apiKeyId: { in: clientIds }, hour: { gte: hourOf(since) }, OR: [{ errors: { gt: 0 } }, { denied: { gt: 0 } }] }, _max: { updatedAt: true } });
  const lastErr = new Map(errHours.map((r) => [r.apiKeyId, r._max.updatedAt]));
  return new Map(rows.map((r) => [r.apiKeyId, { requests: r._sum.requests ?? 0, errors: r._sum.errors ?? 0, denied: r._sum.denied ?? 0, rateLimited: r._sum.rateLimited ?? 0, lastErrorHour: lastErr.get(r.apiKeyId) ?? null }]));
}

// ── Derivation per kind ──────────────────────────────────────────

function apiCapabilities(scopes: string[]) {
  const s = new Set(scopes);
  return [
    ...(scopes.some((x) => x.endsWith(":read")) ? ["api.read"] : []),
    ...(s.has("sm.enquiries:write") || s.has("sm.exports:create") || s.has("sm.webhooks:manage") ? ["api.write"] : []),
    ...(s.has("sm.enquiries:write") ? ["sync.enquiries"] : []),
  ];
}

async function deriveAll(companyId: string, now: Date, only?: { kind: IntegrationKind; resourceId: string }): Promise<Derived[]> {
  const want = (k: IntegrationKind) => !only || only.kind === k;
  const idFilter = only ? { id: only.resourceId } : {};
  const out: Derived[] = [];

  if (want("API_CLIENT") || want("CRM_CAPTURE_KEY")) {
    const keys = await prisma.crmApiKey.findMany({
      where: { companyId, ...idFilter, ...(only ? { purpose: only.kind === "API_CLIENT" ? SM_API_KEY_PURPOSE : "CRM_CAPTURE" } : {}) },
      select: { id: true, name: true, purpose: true, scopes: true, lastUsedAt: true, revokedAt: true, expiresAt: true, createdAt: true, rotatedFromId: true, createdBy: { select: { status: true } } },
    });
    const usage = await usageSince(companyId, keys.filter((k) => k.purpose === SM_API_KEY_PURPOSE).map((k) => k.id), new Date(now.getTime() - DAY));
    for (const k of keys) {
      const sm = k.purpose === SM_API_KEY_PURPOSE;
      const u = usage.get(k.id);
      let status: IntegrationStatus;
      let reason: string | null = null;
      if (k.revokedAt) [status, reason] = ["REVOKED", "Revoked."];
      else if (k.expiresAt && k.expiresAt <= now) [status, reason] = ["FAILED", "The key has expired."];
      else if (k.createdBy.status !== "ACTIVE") [status, reason] = ["FAILED", "The user this key acts as is no longer active."];
      else if (!k.lastUsedAt) [status, reason] = ["PENDING_VERIFICATION", "Not used yet."];
      else if (u && u.requests >= 10 && (u.errors + u.denied) / u.requests >= 0.5) [status, reason] = ["DEGRADED", `${u.errors + u.denied} of ${u.requests} calls failed in the last 24 hours.`];
      else status = "CONNECTED";
      out.push({
        kind: sm ? "API_CLIENT" : "CRM_CAPTURE_KEY",
        resourceId: k.id,
        provider: sm ? "erp-api" : "crm-lead-ingest",
        name: k.name,
        capabilities: sm ? apiCapabilities(k.scopes) : ["leads.ingest"],
        authMethod: "API key (Bearer), SHA-256 hashed",
        credentialRef: `crm_api_keys:${k.id}`,
        credentialRotatedAt: k.rotatedFromId ? k.createdAt : null,
        managedIn: sm ? "SALES_MARKETING" : "CRM",
        status,
        reason,
        lastSuccessAt: k.lastUsedAt,
        lastErrorAt: u?.lastErrorHour ?? null,
        lastError: u && u.errors + u.denied ? `${u.errors} errors, ${u.denied} refused and ${u.rateLimited} rate-limited calls in the last 24 hours.` : null,
      });
    }
  }

  if (want("WEBHOOK_SUBSCRIPTION") || want("CRM_WEBHOOK_SUBSCRIPTION")) {
    const subs = await prisma.crmWebhookSubscription.findMany({
      where: { companyId, ...idFilter, ...(only ? { scope: only.kind === "WEBHOOK_SUBSCRIPTION" ? "SALES_MARKETING" : "CRM" } : {}) },
      select: { id: true, name: true, scope: true, isActive: true, consecutiveFailures: true, lastDeliveryStatus: true, lastSuccessAt: true, lastDeliveryAt: true, lastError: true, secretRotatedAt: true },
    });
    for (const s of subs) {
      const sm = s.scope === "SALES_MARKETING";
      let status: IntegrationStatus;
      let reason: string | null = null;
      if (!s.isActive) [status, reason] = ["DISABLED", "The subscription is turned off."];
      else if (s.consecutiveFailures >= WEBHOOK_ATTENTION_THRESHOLD) [status, reason] = ["FAILED", `${s.consecutiveFailures} deliveries failed in a row.`];
      else if (s.lastDeliveryStatus === "FAILED") [status, reason] = ["DEGRADED", "The last delivery failed."];
      else if (s.lastSuccessAt) status = "CONNECTED";
      else [status, reason] = ["PENDING_VERIFICATION", "No successful delivery yet."];
      out.push({
        kind: sm ? "WEBHOOK_SUBSCRIPTION" : "CRM_WEBHOOK_SUBSCRIPTION",
        resourceId: s.id,
        provider: "https-webhook",
        name: s.name,
        capabilities: ["events.outbound"],
        authMethod: "HMAC-SHA256 signature (secret stored encrypted)",
        credentialRef: `crm_webhook_subscriptions:${s.id}`,
        credentialRotatedAt: s.secretRotatedAt,
        managedIn: sm ? "SALES_MARKETING" : "CRM",
        status,
        reason,
        lastSuccessAt: s.lastSuccessAt,
        lastErrorAt: s.lastDeliveryStatus === "FAILED" ? s.lastDeliveryAt : null,
        lastError: s.lastDeliveryStatus === "FAILED" ? s.lastError : null,
      });
    }
  }

  if (want("DELIVERY_PROVIDER")) {
    const conns = await prisma.marketingChannelConnection.findMany({
      where: { companyId, ...idFilter },
      select: { id: true, name: true, providerKey: true, channelType: true, status: true, lastTestedAt: true, lastTestStatus: true, lastTestMessage: true, consecutiveFailures: true, circuitOpenUntil: true, lastSendAt: true, updatedAt: true },
    });
    const callbacks = await usageSince(companyId, conns.map((c) => c.id), new Date(now.getTime() - DAY));
    for (const c of conns) {
      const def = MARKETING_PROVIDERS[c.providerKey];
      const cb = callbacks.get(c.id);
      let status: IntegrationStatus;
      let reason: string | null = null;
      if (c.status === "DISABLED") [status, reason] = ["DISABLED", "The connection is turned off."];
      else if (c.circuitOpenUntil && c.circuitOpenUntil > now) [status, reason] = ["FAILED", "Sending is paused after repeated provider failures."];
      else if (c.consecutiveFailures > 0 || c.lastTestStatus === "FAILED") [status, reason] = ["DEGRADED", c.lastTestMessage ?? "Recent failures."];
      else if (cb?.denied) [status, reason] = ["DEGRADED", `${cb.denied} provider callback(s) failed verification in the last 24 hours.`];
      else if (c.lastTestStatus === "OK" || c.lastSendAt) status = "CONNECTED";
      else [status, reason] = ["CONFIGURED", "Not tested or used yet."];
      out.push({
        kind: "DELIVERY_PROVIDER",
        resourceId: c.id,
        provider: c.providerKey,
        name: c.name,
        capabilities: [
          `send.${c.channelType.toLowerCase()}`,
          ...(def?.capabilities.webhooks ? ["webhook.delivery_status"] : []),
          ...(def?.capabilities.unsubscribeEvents ? ["webhook.unsubscribe"] : []),
          ...(def?.capabilities.connectionTest ? ["check.connection"] : []),
        ],
        authMethod: `Provider credentials (encrypted); callbacks: ${def?.capabilities.webhookAuth === "SIGNATURE" ? "signature + URL token" : def?.capabilities.webhookAuth === "URL_TOKEN" ? "URL token" : "none"}`,
        credentialRef: `marketing_channel_connections:${c.id}`,
        credentialRotatedAt: null,
        managedIn: "SALES_MARKETING",
        status,
        reason,
        lastSuccessAt: maxDate(c.lastSendAt, c.lastTestStatus === "OK" ? c.lastTestedAt : null),
        lastErrorAt: c.lastTestStatus === "FAILED" ? c.lastTestedAt : (cb?.lastErrorHour ?? null),
        lastError: c.lastTestStatus === "FAILED" ? c.lastTestMessage : cb?.denied ? `${cb.denied} callback(s) failed verification.` : null,
      });
    }
  }

  if (want("CRM_INBOUND_WEBHOOK")) {
    const eps = await prisma.crmWebhookEndpoint.findMany({ where: { companyId, ...idFilter }, select: { id: true, name: true, provider: true, isActive: true, lastReceivedAt: true } });
    for (const e of eps) {
      out.push({
        kind: "CRM_INBOUND_WEBHOOK",
        resourceId: e.id,
        provider: e.provider,
        name: e.name,
        capabilities: ["leads.ingest"],
        authMethod: "HMAC signature (secret stored encrypted)",
        credentialRef: `crm_webhook_endpoints:${e.id}`,
        credentialRotatedAt: null,
        managedIn: "CRM",
        status: !e.isActive ? "DISABLED" : e.lastReceivedAt ? "CONNECTED" : "PENDING_VERIFICATION",
        reason: !e.isActive ? "Turned off in CRM Settings." : e.lastReceivedAt ? null : "Nothing received yet.",
        lastSuccessAt: e.lastReceivedAt,
        lastErrorAt: null,
        lastError: null,
      });
    }
  }
  return out;
}

/** Next status: a person's DISABLED (API clients) stays until they enable it; REVOKED is final; otherwise the derived health. */
export function nextStatus(kind: IntegrationKind, current: IntegrationStatus | null, derived: IntegrationStatus): IntegrationStatus {
  if (!current) return derived;
  if (current === "REVOKED") return "REVOKED";
  if (kind === "API_CLIENT" && current === "DISABLED" && derived !== "REVOKED") return "DISABLED";
  return canIntegrationTransition(current, derived) ? derived : current;
}

/** Re-derives registry rows from their resources (all, or one) and removes rows whose resource is gone. */
export async function refreshRegistry(companyId: string, only?: { kind: IntegrationKind; resourceId: string }, now = new Date()) {
  const derived = await deriveAll(companyId, now, only);
  const existing = await prisma.integration.findMany({ where: { companyId, ...(only ? { resourceType: RESOURCE_TYPE[only.kind], resourceId: only.resourceId } : {}) } });
  const byResource = new Map(existing.map((r) => [`${r.resourceType}:${r.resourceId}`, r]));
  for (const d of derived) {
    const key = `${RESOURCE_TYPE[d.kind]}:${d.resourceId}`;
    const cur = byResource.get(key);
    byResource.delete(key);
    const status = nextStatus(d.kind, (cur?.status as IntegrationStatus) ?? null, d.status);
    const base = {
      kind: d.kind,
      provider: d.provider,
      name: d.name.slice(0, 200),
      capabilities: d.capabilities,
      authMethod: d.authMethod,
      credentialRef: d.credentialRef,
      credentialRotatedAt: d.credentialRotatedAt,
      managedIn: d.managedIn,
      lastSuccessAt: d.lastSuccessAt,
      lastErrorAt: d.lastErrorAt,
      lastError: d.lastError?.slice(0, 500) ?? null,
      lastCheckedAt: now,
    };
    if (!cur) {
      await prisma.integration
        .create({ data: { companyId, resourceType: RESOURCE_TYPE[d.kind], resourceId: d.resourceId, ...base, status, statusReason: d.reason, statusChangedAt: now } })
        .catch((e) => {
          if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e; // created concurrently
        });
    } else {
      const changed = status !== cur.status;
      await prisma.integration.update({
        where: { id: cur.id },
        data: { ...base, ...(changed ? { status, statusChangedAt: now, statusReason: d.reason, version: { increment: 1 } } : status === d.status ? { statusReason: d.reason } : {}) },
      });
    }
  }
  // Resources that no longer exist (deleted subscriptions / connections).
  const gone = [...byResource.values()].map((r) => r.id);
  if (gone.length) await prisma.integration.deleteMany({ where: { id: { in: gone } } });
}

export async function ensureRegistryRow(companyId: string, kind: IntegrationKind, resourceId: string, extra: { credentialRotatedAt?: Date } = {}) {
  await refreshRegistry(companyId, { kind, resourceId });
  if (extra.credentialRotatedAt) await prisma.integration.updateMany({ where: { companyId, resourceType: RESOURCE_TYPE[kind], resourceId }, data: { credentialRotatedAt: extra.credentialRotatedAt } });
}

/** A person's lifecycle change (DISABLED / CONFIGURED / REVOKED), checked against the transitions. */
export async function setRegistryStatus(companyId: string, kind: IntegrationKind, resourceId: string, to: IntegrationStatus, reason: string | null) {
  await ensureRegistryRow(companyId, kind, resourceId);
  const row = await prisma.integration.findUniqueOrThrow({ where: { companyId_resourceType_resourceId: { companyId, resourceType: RESOURCE_TYPE[kind], resourceId } } });
  if (row.status === to) return row;
  if (!canIntegrationTransition(row.status as IntegrationStatus, to)) throw new BusinessRuleError("INVALID_STATE_TRANSITION", `An integration that is ${row.status.toLowerCase().replace(/_/g, " ")} can't become ${to.toLowerCase().replace(/_/g, " ")}.`);
  const r = await prisma.integration.updateMany({ where: { id: row.id, version: row.version }, data: { status: to, statusReason: reason?.slice(0, 300) ?? null, statusChangedAt: new Date(), version: { increment: 1 } } });
  if (!r.count) throw new BusinessRuleError("RECORD_VERSION_CONFLICT", "The integration changed just now. Reload and try again.");
  return prisma.integration.findUniqueOrThrow({ where: { id: row.id } });
}

/** Scope label list for a key (UI / docs). */
export const scopeLabels = (scopes: string[]) => scopes.map((s) => SM_API_SCOPES[s as SmApiScope]?.label ?? s);
