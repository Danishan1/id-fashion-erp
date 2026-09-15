import { prisma } from "@/core/db/client";
import type { AIProviderCapability, AIProviderHealthStatus, AIUsageErrorCategory, Prisma } from "@prisma/client";

/**
 * UTC calendar boundaries — never local-timezone `new Date(y, m, d)`
 * construction, matching this project's own hard-won lesson (documented
 * repeatedly elsewhere in this codebase: a server running in a timezone
 * ahead of UTC silently buckets "today" one calendar day early against any
 * UTC-stored timestamp otherwise). Shared by AIProviderManager's own
 * daily/monthly-limit enforcement and the admin usage dashboard so both
 * always agree on exactly the same "today"/"this month" boundary.
 */
export function utcStartOfDay(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function utcStartOfMonth(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/**
 * Shared between AIProviderManager (the runtime candidate-selection/
 * failover engine, src/core/ai/provider-manager/) and the admin-facing CRUD
 * service (src/modules/ai-providers/) — one Prisma-query surface for the 3
 * new tables, matching this project's own "modules import from core, never
 * duplicate a repository across layers" convention.
 */
export const AIProviderRepository = {
  findMany: (companyId: string) => prisma.aIProvider.findMany({ where: { companyId }, orderBy: [{ priority: "asc" }, { createdAt: "asc" }] }),

  findAnyById: (companyId: string, id: string) => prisma.aIProvider.findFirst({ where: { id, companyId } }),

  /**
   * The real candidate query AIProviderManager uses — active, declares the
   * needed capability, and not currently in a health state that should
   * exclude it. `cooldownUntil` in the past (or null) means the timed
   * cooldown has expired and it's eligible to try again; AUTH_ERROR/
   * DISABLED have no timed recovery at all (see AIProviderManager's own
   * health-penalty logic) so they're excluded regardless of cooldownUntil.
   */
  findCandidates: (companyId: string, capability: AIProviderCapability) =>
    prisma.aIProvider.findMany({
      where: {
        companyId,
        isActive: true,
        capabilities: { has: capability },
        healthStatus: { notIn: ["AUTH_ERROR", "DISABLED"] },
        OR: [{ cooldownUntil: null }, { cooldownUntil: { lte: new Date() } }],
      },
      orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
    }),

  create: (data: Prisma.AIProviderUncheckedCreateInput) => prisma.aIProvider.create({ data }),

  update: (id: string, data: Prisma.AIProviderUncheckedUpdateInput) => prisma.aIProvider.update({ where: { id }, data }),

  delete: (id: string) => prisma.aIProvider.delete({ where: { id } }),

  markHealthy: (id: string) =>
    prisma.aIProvider.update({
      where: { id },
      data: { healthStatus: "HEALTHY", cooldownUntil: null, lastHealthCheckAt: new Date(), lastErrorMessage: null },
    }),

  applyHealthPenalty: (id: string, healthStatus: AIProviderHealthStatus, cooldownUntil: Date | null, errorMessage: string) =>
    prisma.aIProvider.update({
      where: { id },
      data: { healthStatus, cooldownUntil, lastHealthCheckAt: new Date(), lastErrorMessage: errorMessage },
    }),

  /** Admin "Reset" action — manually clears AUTH_ERROR/DISABLED-by-health-penalty back to HEALTHY, distinct from the isActive toggle. */
  resetHealth: (id: string) =>
    prisma.aIProvider.update({
      where: { id },
      data: { healthStatus: "HEALTHY", cooldownUntil: null, lastErrorMessage: null },
    }),
};

export const AIProviderUsageRepository = {
  create: (data: Prisma.AIProviderUsageUncheckedCreateInput) => prisma.aIProviderUsage.create({ data }),

  /** Real, locally-tracked usage counts for the admin dashboard and daily/monthly-limit enforcement — never a provider's own hosted balance, which is not obtainable from any of these APIs (see AIProviderManager's own comment on not fabricating credit figures). */
  countSince: (providerId: string, since: Date) =>
    prisma.aIProviderUsage.count({ where: { providerId, success: true, requestedAt: { gte: since } } }),

  summaryByProvider: (companyId: string) =>
    prisma.aIProviderUsage.groupBy({
      by: ["providerId", "success"],
      where: { companyId },
      _count: { _all: true },
    }),

  findRecent: (companyId: string, limit: number) =>
    prisma.aIProviderUsage.findMany({
      where: { companyId },
      orderBy: { requestedAt: "desc" },
      take: limit,
      include: { provider: { select: { id: true, name: true, providerType: true } }, user: { select: { id: true, fullName: true } } },
    }),
};

export const AIFailoverLogRepository = {
  create: (data: { companyId: string; requestedProviderId: string; fallbackProviderId: string; reason: AIUsageErrorCategory; generationContext: string; result: "SUCCESS" | "FAILED" }) =>
    prisma.aIFailoverLog.create({ data }),

  findRecent: (companyId: string, limit: number) =>
    prisma.aIFailoverLog.findMany({
      where: { companyId },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        requestedProvider: { select: { id: true, name: true } },
        fallbackProvider: { select: { id: true, name: true } },
      },
    }),
};
