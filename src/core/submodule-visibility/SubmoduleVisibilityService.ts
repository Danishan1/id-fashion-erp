import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { SUBMODULE_KEYS, SUBMODULE_REGISTRY, isSubmoduleKey, type SubmoduleKey } from "@/config/submodule-registry";
import { SUBMODULE_HAS_DATA_CHECKS } from "./submodule-data-checks";

export interface SubmoduleVisibilityState {
  isVisible: boolean;
  isLocked: boolean;
}

export type SubmoduleVisibilityMap = Record<SubmoduleKey, SubmoduleVisibilityState>;

/**
 * Short-TTL, per-company cache of "does this submodule have real data" --
 * an admin-configured display preference, not persisted business state, so
 * a few seconds of staleness is an acceptable tradeoff against re-running
 * an existence check per submodule on every page load across a growing
 * registry and multiple consumer forms. Invalidated immediately on every
 * write for that company. Never the source of truth for whether a toggle
 * is *allowed* -- setSubmoduleVisibility always re-checks fresh.
 */
const LOCK_CACHE_TTL_MS = 8000;
const lockCache = new Map<string, { expiresAt: number; locks: Record<SubmoduleKey, boolean> }>();

/** Test-only reset hook for the module-level cache -- mirrors PermissionService.invalidate()'s own precedent for an exported singleton's in-process cache leaking across test cases. */
export function clearSubmoduleVisibilityCache() {
  lockCache.clear();
}

async function getLockMap(companyId: string): Promise<Record<SubmoduleKey, boolean>> {
  const cached = lockCache.get(companyId);
  if (cached && cached.expiresAt > Date.now()) return cached.locks;

  const entries = await Promise.all(
    SUBMODULE_KEYS.map(async (key) => [key, await SUBMODULE_HAS_DATA_CHECKS[key](companyId)] as const)
  );
  const locks = Object.fromEntries(entries) as Record<SubmoduleKey, boolean>;
  lockCache.set(companyId, { expiresAt: Date.now() + LOCK_CACHE_TTL_MS, locks });
  return locks;
}

/**
 * `isVisible` is derived, not trusted from the stored row, whenever the
 * submodule is locked: a locked submodule is ALWAYS reported visible,
 * regardless of what's stored. This is what actually closes the race
 * between "first real row for a submodule gets created" and "admin hides
 * that same submodule" -- the write path's own pre-check (below) can lose
 * that race, but the very next read here self-heals it, since isLocked is
 * recomputed fresh (modulo the short cache window) rather than trusted from
 * a stored flag.
 */
export async function getSubmoduleVisibilityMap(companyId: string): Promise<SubmoduleVisibilityMap> {
  const [rows, locks] = await Promise.all([
    prisma.submoduleVisibility.findMany({ where: { companyId } }),
    getLockMap(companyId),
  ]);
  const storedVisibleByKey = new Map(rows.map((r) => [r.submoduleKey, r.isVisible]));

  return Object.fromEntries(
    SUBMODULE_KEYS.map((key) => {
      const isLocked = locks[key];
      const isVisible = isLocked ? true : (storedVisibleByKey.get(key) ?? true);
      return [key, { isVisible, isLocked }];
    })
  ) as SubmoduleVisibilityMap;
}

export async function setSubmoduleVisibility(
  companyId: string,
  key: string,
  isVisible: boolean
): Promise<SubmoduleVisibilityMap> {
  if (!isSubmoduleKey(key)) {
    throw new BusinessRuleError("NOT_FOUND", "Unknown submodule.", { key });
  }

  // Defense in depth for a clean error message -- the real race-closure is
  // getSubmoduleVisibilityMap's "locked always wins" read-side derivation
  // above, not this pre-check.
  const hasData = await SUBMODULE_HAS_DATA_CHECKS[key](companyId);
  if (hasData) {
    throw new BusinessRuleError(
      "SUBMODULE_LOCKED",
      `"${SUBMODULE_REGISTRY[key].label}" already has data and its visibility can no longer be changed.`,
      { key }
    );
  }

  await prisma.submoduleVisibility.upsert({
    where: { companyId_submoduleKey: { companyId, submoduleKey: key } },
    update: { isVisible },
    create: { companyId, submoduleKey: key, isVisible },
  });

  lockCache.delete(companyId);
  return getSubmoduleVisibilityMap(companyId);
}
