import { prisma } from "@/core/db/client";
import type { Module } from "@/config/rbac";
import {
  ENTITLEMENT_PACKAGES,
  isEntitlementPackageKey,
  modulesOfPackages,
  type EntitlementPackageKey,
} from "@/config/module-entitlements";

/**
 * Which product packages a company may use (Platform SaaS Phase 3, PLAT-018/019;
 * plan-driven since Phase 4). Read on every permission check, so it's cached
 * briefly per company and cleared immediately when a platform operator
 * changes it.
 *
 * Resolution per package:
 *   1. a per-company override row (company_module_entitlements) wins;
 *   2. otherwise the company's subscription plan decides;
 *   3. no subscription at all = enabled (pre-Phase-4 behaviour).
 *
 * Same globalThis singleton as PermissionService: Next bundles this file
 * separately per runtime layer, and a per-layer cache would let one layer
 * keep serving an old answer after invalidate() ran in another.
 */

const CACHE_TTL_MS = 15_000;

interface CacheEntry {
  disabledPackages: Set<EntitlementPackageKey>;
  overrides: Map<EntitlementPackageKey, boolean>;
  /** null = no subscription (every package included). */
  planPackages: Set<string> | null;
  disabledModules: Set<Module>;
  expiresAt: number;
}

class EntitlementServiceImpl {
  private cache = new Map<string, CacheEntry>();

  invalidate(companyId?: string) {
    if (companyId) this.cache.delete(companyId);
    else this.cache.clear();
  }

  private async load(companyId: string): Promise<CacheEntry> {
    const cached = this.cache.get(companyId);
    if (cached && cached.expiresAt > Date.now()) return cached;

    const [rows, subscription] = await Promise.all([
      prisma.companyModuleEntitlement.findMany({
        where: { companyId },
        select: { packageKey: true, isEnabled: true },
      }),
      prisma.companySubscription.findUnique({
        where: { companyId },
        select: { plan: { select: { modules: { select: { packageKey: true } } } } },
      }),
    ]);

    const overrides = new Map<EntitlementPackageKey, boolean>();
    for (const row of rows) {
      // An unknown key (a package later removed from the catalog) is ignored.
      if (isEntitlementPackageKey(row.packageKey)) overrides.set(row.packageKey, row.isEnabled);
    }
    const planPackages = subscription ? new Set(subscription.plan.modules.map((m) => m.packageKey)) : null;

    const disabledPackages = new Set<EntitlementPackageKey>();
    for (const pkg of ENTITLEMENT_PACKAGES) {
      const enabled = overrides.get(pkg.key) ?? (planPackages ? planPackages.has(pkg.key) : true);
      if (!enabled) disabledPackages.add(pkg.key);
    }

    const entry: CacheEntry = {
      disabledPackages,
      overrides,
      planPackages,
      disabledModules: modulesOfPackages(disabledPackages),
      expiresAt: Date.now() + CACHE_TTL_MS,
    };
    this.cache.set(companyId, entry);
    return entry;
  }

  async getDisabledPackages(companyId: string): Promise<Set<EntitlementPackageKey>> {
    return (await this.load(companyId)).disabledPackages;
  }

  async getDisabledModules(companyId: string): Promise<Set<Module>> {
    return (await this.load(companyId)).disabledModules;
  }

  async isModuleEnabled(companyId: string, module: Module): Promise<boolean> {
    return !(await this.load(companyId)).disabledModules.has(module);
  }

  /**
   * Every package with its current on/off state, in catalog order.
   * `inPlan` = what the subscription plan alone says; `override` = the
   * per-company setting that wins over it (null when there is none).
   */
  async listPackageStates(companyId: string) {
    const entry = await this.load(companyId);
    return ENTITLEMENT_PACKAGES.map((pkg) => ({
      ...pkg,
      isEnabled: !entry.disabledPackages.has(pkg.key),
      inPlan: entry.planPackages ? entry.planPackages.has(pkg.key) : true,
      override: entry.overrides.get(pkg.key) ?? null,
    }));
  }
}

const globalForEntitlements = globalThis as unknown as { __entitlementService?: EntitlementServiceImpl };

export const EntitlementService = globalForEntitlements.__entitlementService ?? new EntitlementServiceImpl();
globalForEntitlements.__entitlementService = EntitlementService;
