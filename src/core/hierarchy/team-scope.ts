import type { HierarchyModule } from "@prisma/client";
import { prisma } from "@/core/db/client";

/**
 * P3 (2026-10-21): module-specific reporting hierarchy.
 *
 * An employee's manager in a module is their active EmployeeReportingLine for
 * that module (start date reached, end date not passed), or -- when they have
 * none -- their general Employee.reportsToId. A manager's team is everyone
 * below them: direct reports and all descendants (decision 9).
 *
 * The manager map is cached per company+module for a few seconds and cleared
 * by `invalidateTeamScope(companyId)` whenever a reporting line or a
 * reportsToId changes. Stored on globalThis so every Next.js runtime layer
 * shares one cache (same reason as PermissionService).
 */

export type { HierarchyModule };
export const HIERARCHY_MODULES: HierarchyModule[] = ["PRODUCTION", "CRM", "HRMS"];

export interface TeamScope {
  /** The caller's own linked employee, if any. */
  employeeId: string | null;
  /** Employees below the caller in this module (not including the caller). */
  teamEmployeeIds: string[];
  /** Login user ids linked to those employees. */
  teamUserIds: string[];
}

type ManagerMap = Map<string, string>; // employeeId -> managerId

interface CacheEntry {
  expiresAt: number;
  managers: ManagerMap;
}

const CACHE_MS = 10_000;
const globalCache = globalThis as unknown as { __teamScopeCache?: Map<string, CacheEntry> };
const cache = (globalCache.__teamScopeCache ??= new Map<string, CacheEntry>());

export function invalidateTeamScope(companyId?: string) {
  if (!companyId) return cache.clear();
  for (const key of [...cache.keys()]) if (key.startsWith(`${companyId}:`)) cache.delete(key);
}

function todayUtc(): Date {
  return new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
}

/** Effective employee -> manager map for one module in one company. */
export async function loadManagerMap(companyId: string, module: HierarchyModule): Promise<ManagerMap> {
  const key = `${companyId}:${module}`;
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.managers;

  const today = todayUtc();
  const [employees, lines] = await Promise.all([
    prisma.employee.findMany({
      where: { companyId, deletedAt: null },
      select: { id: true, reportsToId: true },
    }),
    prisma.employeeReportingLine.findMany({
      where: {
        companyId,
        module,
        isActive: true,
        startDate: { lte: today },
        OR: [{ endDate: null }, { endDate: { gte: today } }],
      },
      select: { employeeId: true, managerId: true },
    }),
  ]);

  const managers: ManagerMap = new Map();
  for (const e of employees) if (e.reportsToId) managers.set(e.id, e.reportsToId);
  // A module line always wins over the general reportsToId.
  for (const l of lines) managers.set(l.employeeId, l.managerId);

  cache.set(key, { expiresAt: Date.now() + CACHE_MS, managers });
  return managers;
}

/** Everyone below `employeeId` (loop-safe). */
export function descendantsOf(managers: ManagerMap, employeeId: string): string[] {
  const children = new Map<string, string[]>();
  for (const [emp, mgr] of managers) {
    const list = children.get(mgr);
    if (list) list.push(emp);
    else children.set(mgr, [emp]);
  }
  const seen = new Set<string>([employeeId]);
  const out: string[] = [];
  const queue = [employeeId];
  while (queue.length) {
    const current = queue.shift()!;
    for (const child of children.get(current) ?? []) {
      if (seen.has(child)) continue;
      seen.add(child);
      out.push(child);
      queue.push(child);
    }
  }
  return out;
}

/** True if making `managerId` the manager of `employeeId` would create a loop. */
export function wouldCreateLoop(managers: ManagerMap, employeeId: string, managerId: string): boolean {
  if (employeeId === managerId) return true;
  const seen = new Set<string>();
  let current: string | undefined = managerId;
  while (current) {
    if (current === employeeId) return true;
    if (seen.has(current)) return false; // an existing loop elsewhere -- not ours
    seen.add(current);
    current = managers.get(current);
  }
  return false;
}

/** The caller's team in one module. Users with no linked employee have no team. */
export async function getTeamScope(userId: string, module: HierarchyModule): Promise<TeamScope> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { companyId: true, employeeId: true } });
  if (!user?.employeeId) return { employeeId: null, teamEmployeeIds: [], teamUserIds: [] };

  const managers = await loadManagerMap(user.companyId, module);
  const teamEmployeeIds = descendantsOf(managers, user.employeeId);
  if (teamEmployeeIds.length === 0) return { employeeId: user.employeeId, teamEmployeeIds, teamUserIds: [] };

  const users = await prisma.user.findMany({
    where: { companyId: user.companyId, employeeId: { in: teamEmployeeIds } },
    select: { id: true },
  });
  return { employeeId: user.employeeId, teamEmployeeIds, teamUserIds: users.map((u) => u.id) };
}
