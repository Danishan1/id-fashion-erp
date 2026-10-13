import { prisma } from "@/core/db/client";
import type { Module } from "@/config/rbac";
import {
  ENTITLEMENT_PACKAGES,
  isEntitlementPackageKey,
  modulesOfPackages,
  type EntitlementPackageKey,
} from "@/config/module-entitlements";

/**
 * Which product packages a company has turned off (Platform SaaS Phase 3,
 * PLAT-018/019). Read on every permission check, so it's cached briefly per
 * company and cleared immediately when a platform operator changes it.
 *
 * Same globalThis singleton as PermissionService: Next bundles this file
 * separately per runtime layer, and a per-layer cache would let one layer
 * keep serving an old answer after invalidate() ran in another.
 */

const CACHE_TTL_MS = 15_000;

interface CacheEntry {
  disabledPackages: Set<EntitlementPackageKey>;
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

    const rows = await prisma.companyModuleEntitlement.findMany({
      where: { companyId, isEnabled: false },
      select: { packageKey: true },
    });
    const disabledPackages = new Set<EntitlementPackageKey>();
    for (const row of rows) {
      // An unknown key (a package later removed from the catalog) is ignored.
      if (isEntitlementPackageKey(row.packageKey)) disabledPackages.add(row.packageKey);
    }
    const entry: CacheEntry = {
      disabledPackages,
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

  /** Every package with its current on/off state, in catalog order. */
  async listPackageStates(companyId: string) {
    const disabled = await this.getDisabledPackages(companyId);
    return ENTITLEMENT_PACKAGES.map((pkg) => ({ ...pkg, isEnabled: !disabled.has(pkg.key) }));
  }
}

const globalForEntitlements = globalThis as unknown as { __entitlementService?: EntitlementServiceImpl };

export const EntitlementService = globalForEntitlements.__entitlementService ?? new EntitlementServiceImpl();
globalForEntitlements.__entitlementService = EntitlementService;
