import { z } from "zod";
import { writeAuditLog } from "@/core/audit/AuditLogger";
import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { PermissionService } from "@/core/rbac/PermissionService";
import { setConnectionStatus, testConnection } from "@/modules/sales-marketing/delivery/connection.service";
import { MARKETING_PROVIDERS } from "@/modules/sales-marketing/delivery/delivery-registry";
import type { SalesActor } from "@/modules/sales-marketing/enquiries/sales-enquiry.service";
import { CAPABILITY_LABELS, INTEGRATION_KINDS, INTEGRATION_STATUSES, SM_API_KEY_PURPOSE, SM_API_SCOPES, type IntegrationKind, type IntegrationStatus, type SmApiScope } from "./integration-registry";
import { refreshRegistry, setRegistryStatus } from "./integration-registry.service";
import { getSmApiKey, keyState } from "./sm-api-keys.service";
import { getSmSubscription, testSmSubscription, updateSmSubscription } from "./sm-webhooks.service";

/**
 * Phase 16 — S&M → Integrations (admin, signed-in users). The registry with
 * health, the detail of one integration (usage, deliveries, callbacks, sync
 * checkpoints, audit history), enable / disable, connection checks and
 * metrics. Every action goes through the owning service (delivery
 * connections keep needing sales_marketing_settings.edit; CRM integrations
 * are shown read-only and managed in CRM Settings).
 */

const DAY = 86_400_000;
const AUDIT_TABLES: Record<string, string[]> = {
  crm_api_keys: ["crm_api_keys"],
  crm_webhook_subscriptions: ["crm_webhook_subscriptions"],
  marketing_channel_connections: ["marketing_channel_connections"],
  crm_webhook_endpoints: ["crm_webhook_endpoints"],
};

function present(r: Awaited<ReturnType<typeof prisma.integration.findFirstOrThrow>>) {
  const s = INTEGRATION_STATUSES[r.status as IntegrationStatus];
  const k = INTEGRATION_KINDS[r.kind as IntegrationKind];
  const provider = r.kind === "DELIVERY_PROVIDER" ? MARKETING_PROVIDERS[r.provider as keyof typeof MARKETING_PROVIDERS] : null;
  return {
    id: r.id,
    kind: r.kind,
    kindLabel: k?.label ?? r.kind,
    managedIn: r.managedIn,
    manageHref: k?.href ?? null,
    provider: r.provider,
    providerLabel: provider?.label ?? r.provider,
    // Only Phase 10 providers carry this flag; none is live-verified in this build.
    liveVerified: provider ? provider.liveVerified : null,
    name: r.name,
    status: r.status,
    statusLabel: s?.label ?? r.status,
    statusTone: s?.tone ?? "zinc",
    statusReason: r.statusReason,
    statusChangedAt: r.statusChangedAt,
    capabilities: r.capabilities.map((c) => ({ key: c, label: CAPABILITY_LABELS[c] ?? c })),
    authMethod: r.authMethod,
    // A reference to where the credential lives — never the credential.
    credentialRef: r.credentialRef,
    credentialRotatedAt: r.credentialRotatedAt,
    resourceType: r.resourceType,
    resourceId: r.resourceId,
    lastSuccessAt: r.lastSuccessAt,
    lastErrorAt: r.lastErrorAt,
    lastError: r.lastError,
    lastCheckedAt: r.lastCheckedAt,
    version: r.version,
  };
}
export type IntegrationDto = ReturnType<typeof present>;

async function load(actor: SalesActor, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new BusinessRuleError("NOT_FOUND", "Integration not found.");
  const r = await prisma.integration.findFirst({ where: { id, companyId: actor.companyId } });
  if (!r) throw new BusinessRuleError("NOT_FOUND", "Integration not found.");
  return r;
}

export async function listIntegrations(actor: SalesActor) {
  await PermissionService.assert(actor.userId, "sales_integrations", "view");
  await refreshRegistry(actor.companyId);
  const rows = await prisma.integration.findMany({ where: { companyId: actor.companyId }, orderBy: [{ managedIn: "desc" }, { kind: "asc" }, { name: "asc" }] });
  return rows.map(present);
}

async function usageByEndpoint(companyId: string, clientId: string, since: Date) {
  const rows = await prisma.integrationApiUsage.groupBy({ by: ["endpoint"], where: { companyId, apiKeyId: clientId, hour: { gte: since } }, _sum: { requests: true, errors: true, denied: true, rateLimited: true }, _max: { updatedAt: true } });
  return rows.map((r) => ({ endpoint: r.endpoint, requests: r._sum.requests ?? 0, errors: r._sum.errors ?? 0, refused: r._sum.denied ?? 0, rateLimited: r._sum.rateLimited ?? 0, lastAt: r._max.updatedAt })).sort((a, b) => b.requests - a.requests);
}

async function history(companyId: string, resourceType: string, resourceId: string) {
  const rows = await prisma.auditLog.findMany({
    where: { companyId, tableName: { in: AUDIT_TABLES[resourceType] ?? [resourceType] }, recordId: resourceId },
    orderBy: { performedAt: "desc" },
    take: 25,
    select: { id: true, action: true, performedAt: true, newValues: true, userId: true },
  });
  const users = await prisma.user.findMany({ where: { id: { in: rows.map((r) => r.userId).filter((x): x is string => Boolean(x)) } }, select: { id: true, fullName: true } });
  const names = new Map(users.map((u) => [u.id, u.fullName]));
  // Only which fields changed (audit rows never hold secrets — they record "generated" / "rotated" — but values stay in the audit log).
  return rows.map((r) => ({ id: r.id, action: r.action, at: r.performedAt, by: r.userId ? (names.get(r.userId) ?? null) : null, changed: r.newValues && typeof r.newValues === "object" ? Object.keys(r.newValues as object).slice(0, 8) : [] }));
}

export async function getIntegration(actor: SalesActor, id: string) {
  await PermissionService.assert(actor.userId, "sales_integrations", "view");
  const row = await load(actor, id);
  await refreshRegistry(actor.companyId, { kind: row.kind as IntegrationKind, resourceId: row.resourceId });
  const r = await load(actor, id);
  const since = new Date(Date.now() - DAY);
  const detail: Record<string, unknown> = {};
  if (r.kind === "API_CLIENT") {
    detail.apiKey = await getSmApiKey(actor, r.resourceId).catch(() => null);
    detail.usage24h = await usageByEndpoint(actor.companyId, r.resourceId, since);
    detail.usage7d = await usageByEndpoint(actor.companyId, r.resourceId, new Date(Date.now() - 7 * DAY));
    detail.checkpoints = await prisma.integrationSyncCheckpoint.findMany({ where: { companyId: actor.companyId, integrationId: r.id }, orderBy: { stream: "asc" } });
    detail.openConflicts = await prisma.integrationConflict.count({ where: { companyId: actor.companyId, integrationId: r.id, status: "OPEN" } });
  } else if (r.kind === "WEBHOOK_SUBSCRIPTION") {
    detail.subscription = await getSmSubscription(actor, r.resourceId).catch(() => null);
  } else if (r.kind === "DELIVERY_PROVIDER") {
    const [callbacks, pending, failed] = await Promise.all([
      usageByEndpoint(actor.companyId, r.resourceId, since),
      prisma.marketingDeliveryEvent.count({ where: { companyId: actor.companyId, connectionId: r.resourceId, source: "PROVIDER", processedAt: null } }),
      prisma.marketingDeliveryEvent.count({ where: { companyId: actor.companyId, connectionId: r.resourceId, source: "PROVIDER", receivedAt: { gte: since }, result: "ERROR" } }),
    ]);
    const cb = callbacks.find((c) => c.endpoint === "inbound:callback");
    detail.callbacks24h = { accepted: cb ? cb.requests - cb.refused : 0, rejected: cb?.refused ?? 0, waitingToProcess: pending, failedToProcess: failed };
    detail.notLiveVerified = true;
  }
  return { ...present(r), detail, history: await history(actor.companyId, r.resourceType, r.resourceId) };
}

const toggleSchema = z.object({ action: z.enum(["enable", "disable", "check"]), reason: z.string().trim().max(300).optional().or(z.literal("")), version: z.number().int().optional() }).strict();

/** Enable / disable / check — each through the owning service. */
export async function integrationAction(actor: SalesActor, id: string, raw: unknown) {
  await PermissionService.assert(actor.userId, "sales_integrations", "edit");
  const input = toggleSchema.parse(raw ?? {});
  const r = await load(actor, id);
  if (r.managedIn === "CRM") throw new BusinessRuleError("VALIDATION_ERROR", "This integration is managed in CRM Settings.");
  if (r.status === "REVOKED") throw new BusinessRuleError("INVALID_STATE_TRANSITION", "A revoked integration can't be changed.");
  const kind = r.kind as IntegrationKind;
  let message = "";
  let checks: { label: string; ok: boolean; detail?: string }[] | null = null;
  if (input.action === "check") {
    if (kind === "DELIVERY_PROVIDER") {
      const c = await testConnection(actor, r.resourceId);
      message = `${c.ok ? "Connection check passed" : "Connection check failed"}: ${c.message}`;
    } else if (kind === "WEBHOOK_SUBSCRIPTION") {
      const t = await testSmSubscription(actor, r.resourceId, {});
      message = t.status === "SUCCEEDED" ? `Test event delivered (HTTP ${t.responseStatus}${t.durationMs !== null ? ` in ${t.durationMs} ms` : ""}).` : `Test event not delivered: ${t.message ?? t.status}`;
    } else if (kind === "API_CLIENT") {
      const k = await prisma.crmApiKey.findFirstOrThrow({ where: { id: r.resourceId, companyId: actor.companyId, purpose: SM_API_KEY_PURPOSE }, select: { scopes: true, revokedAt: true, expiresAt: true, createdByUserId: true, createdBy: { select: { status: true, fullName: true } } } });
      const state = keyState(k);
      checks = [
        { label: "Key is active (not revoked or expired)", ok: state === "ACTIVE" || state === "OWNER_INACTIVE", detail: state === "EXPIRED" ? "Expired." : state === "REVOKED" ? "Revoked." : undefined },
        { label: `The user it acts as (${k.createdBy.fullName}) is active`, ok: k.createdBy.status === "ACTIVE" },
      ];
      for (const s of k.scopes as SmApiScope[]) {
        const p = SM_API_SCOPES[s]?.permission;
        if (!p) continue;
        checks.push({ label: `${SM_API_SCOPES[s].label} — needs ${p.module}.${p.action}`, ok: await PermissionService.can(k.createdByUserId, p.module as never, p.action as never) });
      }
      message = checks.every((c) => c.ok) ? "Every check passed. The key can call the API with its scopes." : "Some checks failed — calls needing them are refused.";
    } else throw new BusinessRuleError("VALIDATION_ERROR", "This integration has no connection check.");
  } else {
    const enable = input.action === "enable";
    if (kind === "API_CLIENT") {
      await setRegistryStatus(actor.companyId, kind, r.resourceId, enable ? "CONFIGURED" : "DISABLED", enable ? null : input.reason || "Disabled by a person.");
      message = enable ? "Enabled — calls are accepted again." : "Disabled — calls with this key are refused until it is enabled.";
    } else if (kind === "WEBHOOK_SUBSCRIPTION") {
      const sub = await getSmSubscription(actor, r.resourceId);
      await updateSmSubscription(actor, r.resourceId, { version: sub.version, isActive: enable });
      message = enable ? "Enabled — new events are delivered from now (nothing missed is replayed)." : "Disabled — queued deliveries were cancelled.";
    } else if (kind === "DELIVERY_PROVIDER") {
      await setConnectionStatus(actor, r.resourceId, enable ? "ACTIVE" : "DISABLED");
      message = enable ? "Connection enabled." : "Connection disabled.";
    } else throw new BusinessRuleError("VALIDATION_ERROR", "This integration can't be switched here.");
    await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName: "integrations", recordId: r.id, action: "UPDATE", oldValues: { status: r.status }, newValues: { action: input.action, reason: input.reason || null } });
  }
  await refreshRegistry(actor.companyId, { kind, resourceId: r.resourceId });
  return { message, checks, integration: present(await load(actor, id)) };
}

/** Operational metrics (last 24 h unless stated). */
export async function integrationMetrics(actor: SalesActor) {
  await PermissionService.assert(actor.userId, "sales_integrations", "view");
  const now = Date.now();
  const since = new Date(now - DAY);
  const c = actor.companyId;
  const [api, statuses, deliveries, pending, oldestPending, retried, openConflicts, checkpoints, lastEvent, smKeys] = await Promise.all([
    prisma.integrationApiUsage.aggregate({ where: { companyId: c, hour: { gte: since }, NOT: { endpoint: { startsWith: "inbound:" } } }, _sum: { requests: true, errors: true, denied: true, rateLimited: true } }),
    prisma.integration.groupBy({ by: ["status"], where: { companyId: c }, _count: { _all: true } }),
    prisma.crmWebhookDelivery.groupBy({ by: ["status"], where: { companyId: c, eventSource: "INTEGRATION", createdAt: { gte: since }, isTest: false }, _count: { _all: true } }),
    prisma.crmWebhookDelivery.count({ where: { companyId: c, eventSource: "INTEGRATION", status: { in: ["PENDING", "RETRYING"] } } }),
    prisma.crmWebhookDelivery.findFirst({ where: { companyId: c, eventSource: "INTEGRATION", status: { in: ["PENDING", "RETRYING"] }, nextAttemptAt: { lte: new Date() } }, orderBy: { nextAttemptAt: "asc" }, select: { nextAttemptAt: true } }),
    prisma.crmWebhookDelivery.count({ where: { companyId: c, eventSource: "INTEGRATION", createdAt: { gte: since }, attempts: { gt: 1 } } }),
    prisma.integrationConflict.count({ where: { companyId: c, status: "OPEN" } }),
    prisma.integrationSyncCheckpoint.findMany({ where: { companyId: c }, select: { lastRunAt: true } }),
    prisma.integrationEvent.findFirst({ where: { companyId: c }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    prisma.crmApiKey.findMany({ where: { companyId: c, purpose: SM_API_KEY_PURPOSE }, select: { id: true } }),
  ]);
  const inbound = await prisma.integrationApiUsage.aggregate({ where: { companyId: c, hour: { gte: since }, endpoint: "inbound:callback" }, _sum: { requests: true, denied: true } });
  const requests = api._sum.requests ?? 0;
  const failed = (api._sum.errors ?? 0) + (api._sum.denied ?? 0);
  const del = Object.fromEntries(deliveries.map((d) => [d.status, d._count._all]));
  const delivered = del.SUCCEEDED ?? 0;
  const delFailed = del.FAILED ?? 0;
  return {
    api: { requests, errorRatePercent: requests ? Math.round((failed / requests) * 1000) / 10 : null, errors: api._sum.errors ?? 0, refused: api._sum.denied ?? 0, rateLimited: api._sum.rateLimited ?? 0, keys: smKeys.length },
    webhooks: { delivered, failed: delFailed, successRatePercent: delivered + delFailed ? Math.round((delivered / (delivered + delFailed)) * 1000) / 10 : null, pending, retried, queueLatencySeconds: oldestPending ? Math.max(0, Math.round((now - oldestPending.nextAttemptAt.getTime()) / 1000)) : 0 },
    inbound: { accepted: (inbound._sum.requests ?? 0) - (inbound._sum.denied ?? 0), rejected: inbound._sum.denied ?? 0 },
    sync: { openConflicts, lastRunAt: checkpoints.reduce<Date | null>((a, x) => (x.lastRunAt && (!a || x.lastRunAt > a) ? x.lastRunAt : a), null) },
    events: { lastPublishedAt: lastEvent?.createdAt ?? null },
    registry: Object.fromEntries(statuses.map((s) => [s.status, s._count._all])) as Partial<Record<IntegrationStatus, number>>,
  };
}
