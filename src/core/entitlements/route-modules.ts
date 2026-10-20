import type { Module } from "@/config/rbac";
import { NAV_SECTIONS } from "@/components/layout/navigation";

/**
 * Maps an ERP page URL to the RBAC modules that own it, using the sidebar's
 * own navigation config as the single source of truth (Platform SaaS
 * Phase 3, PLAT-019). The longest matching link wins, so /production/scan
 * (Barcodes) isn't mistaken for /production (Production).
 */

interface RouteEntry {
  href: string;
  modules: readonly Module[];
}

const ROUTE_ENTRIES: RouteEntry[] = NAV_SECTIONS.flatMap((section) => [
  ...(section.href ? [{ href: section.href, modules: section.modules }] : []),
  ...(section.children ?? []).map((child) => ({ href: child.href, modules: child.modules })),
])
  // Longest first, so the most specific link matches.
  .sort((a, b) => b.href.length - a.href.length);

function matches(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** The modules owning this page, or null when no sidebar link covers it. */
export function modulesForPath(pathname: string): readonly Module[] | null {
  return ROUTE_ENTRIES.find((entry) => matches(pathname, entry.href))?.modules ?? null;
}

/** True when every module owning this page is turned off for the company. */
export function isPathDisabled(pathname: string, disabledModules: Set<Module>): boolean {
  const modules = modulesForPath(pathname);
  if (!modules || modules.length === 0 || disabledModules.size === 0) return false;
  return modules.every((m) => disabledModules.has(m));
}

export const MODULE_UNAVAILABLE_PATH = "/module-unavailable";
export const NO_ACCESS_PATH = "/no-access";

/**
 * P6: true when the page belongs to one or more modules and the user can
 * view none of them. Pages no sidebar link covers (or with no modules) are
 * left to the page's own checks.
 */
export function isPathForbidden(pathname: string, viewableModules: Set<Module>): boolean {
  const modules = modulesForPath(pathname);
  if (!modules || modules.length === 0) return false;
  return !modules.some((m) => viewableModules.has(m));
}
