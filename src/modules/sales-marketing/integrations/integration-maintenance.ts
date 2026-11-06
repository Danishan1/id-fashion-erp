import { prisma } from "@/core/db/client";
import { SM_API_LIMITS, SM_WEBHOOK_LIMITS } from "./integration-registry";
import { refreshRegistry } from "./integration-registry.service";
import { purgeIdempotency } from "./idempotency";
import { purgeOldIntegrationEvents } from "./public-events";

/**
 * Phase 16 — integration upkeep, every 5 minutes on the S&M workflow queue
 * (no new queue): refresh registry health for every company that has an
 * integration, and enforce retention (public events 30 days, idempotency
 * keys 24 h, API usage counters 90 days).
 */
export async function tickIntegrations(now = new Date()) {
  const companies = await prisma.$queryRaw<{ company_id: string }[]>`
    SELECT company_id FROM crm_api_keys
    UNION SELECT company_id FROM crm_webhook_subscriptions
    UNION SELECT company_id FROM marketing_channel_connections
    UNION SELECT company_id FROM crm_webhook_endpoints
    UNION SELECT company_id FROM integrations`;
  let refreshed = 0;
  for (const c of companies) {
    try {
      await refreshRegistry(c.company_id, undefined, now);
      refreshed++;
    } catch (e) {
      console.error(JSON.stringify({ level: "error", message: "Integration registry refresh failed", companyId: c.company_id, error: (e as Error).message }));
    }
  }
  const events = await purgeOldIntegrationEvents(now, SM_WEBHOOK_LIMITS.eventRetentionDays);
  const idempotency = await purgeIdempotency(now);
  const { count: usage } = await prisma.integrationApiUsage.deleteMany({ where: { hour: { lt: new Date(now.getTime() - SM_API_LIMITS.usageRetentionDays * 86_400_000) } } });
  return { refreshed, purged: { events, idempotency, usage } };
}
