"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import type { Module, Action } from "@/config/rbac";
import { NAV_SECTIONS, filterNavSections, isLeafActive, isPathActive, isSectionActive, type NavSection } from "./navigation";

// The customer ERP sidebar has no platform links and no company switcher
// (Platform SaaS Phase 1, PLAT-003/005) — platform operators use the
// separate /platform portal and its own PlatformSidebar.

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      className={`h-4 w-4 shrink-0 text-zinc-400 transition-transform duration-150 dark:text-zinc-500 ${open ? "rotate-90" : ""}`}
      aria-hidden="true"
    >
      <path d="M7 5l6 5-6 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Points left (collapse) or right (expand) — a plain double-chevron, the standard "minimize sidebar" glyph. */
function CollapseToggleIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4 shrink-0" aria-hidden="true">
      {collapsed ? (
        <path d="M7 4l6 6-6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <path d="M13 4l-6 6 6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      )}
    </svg>
  );
}

const LEAF_CLASSES = (isActive: boolean) =>
  `block rounded-md px-3 py-1.5 text-sm ${
    isActive
      ? "bg-indigo-50 font-medium text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300"
      : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
  }`;

export function Sidebar({
  viewableModules = "all",
  actionModules,
  isCollapsed = false,
  onToggleCollapse,
}: {
  /**
   * The current user's real, live-computed set of `view`-permitted modules
   * (PermissionService.getViewableModules()) — drives which sections/links
   * actually render, so a narrowly-scoped role only ever sees what it can
   * do. Defaults to "all" so any caller that doesn't pass this (there
   * shouldn't be one in the real app — DashboardLayout always does) fails
   * open to the pre-existing "show everything" behavior rather than a blank
   * sidebar.
   */
  viewableModules?: Module[] | "all";
  /**
   * Module-sets for any non-"view" action a NavLeaf's `requiredAction`
   * declares (e.g. `{ approve: [...] }` for "Pending Approvals") — see
   * filterNavSections(). Unlike `viewableModules`, this has no fail-open
   * default: a leaf with an unmet `requiredAction` simply stays hidden,
   * which is the correct, safer direction for a nav item that would
   * otherwise 404 for the viewer anyway.
   */
  actionModules?: Partial<Record<Action, Module[] | "all">>;
  /** Desktop-only minimize/maximize — the width itself is owned by DashboardShell (the flex parent); this only changes what's rendered inside. */
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  const pathname = usePathname();
  const sections = filterNavSections(NAV_SECTIONS, viewableModules, actionModules);

  // The group containing the active route is expanded by default — derived
  // directly from the current pathname on every render (including a hard
  // page refresh, since usePathname resolves synchronously), not synced via
  // an effect. `overrides` records only groups the user has explicitly
  // toggled away from that default, so a manual expand/collapse persists
  // across client-side navigation without fighting the auto-expand rule.
  const [overrides, setOverrides] = useState<Map<string, boolean>>(new Map());

  function isGroupOpen(section: NavSection): boolean {
    const override = overrides.get(section.label);
    if (override !== undefined) return override;
    return isSectionActive(section, pathname);
  }

  function toggleGroup(section: NavSection) {
    setOverrides((prev) => {
      const next = new Map(prev);
      next.set(section.label, !isGroupOpen(section));
      return next;
    });
  }

  // Clicking a group's letter-badge while the whole sidebar is minimized
  // needs to do two things at once: restore full width, and land on that
  // group already open — otherwise the viewer would maximize into a fully
  // collapsed tree and have to find + reopen the very group they clicked.
  function expandSidebarWithGroupOpen(section: NavSection) {
    setOverrides((prev) => new Map(prev).set(section.label, true));
    onToggleCollapse?.();
  }

  if (isCollapsed) {
    return (
      <nav className="flex h-full w-full flex-col items-center border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex h-14 w-full items-center justify-center border-b border-zinc-200 dark:border-zinc-800">
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label="Expand sidebar"
            title="Expand sidebar"
            className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            <CollapseToggleIcon collapsed />
          </button>
        </div>
        <div className="flex flex-1 flex-col items-center gap-1 overflow-y-auto py-3">
          {sections.map((section) => {
            const active = isSectionActive(section, pathname);
            const badgeClass = `flex h-9 w-9 items-center justify-center rounded-md text-sm font-semibold ${
              active
                ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300"
                : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            }`;
            const initial = section.label.charAt(0).toUpperCase();

            if (!section.children) {
              return (
                <Link key={section.label} href={section.href ?? "#"} title={section.label} aria-label={section.label} className={badgeClass}>
                  {initial}
                </Link>
              );
            }
            return (
              <button
                key={section.label}
                type="button"
                onClick={() => expandSidebarWithGroupOpen(section)}
                title={section.label}
                aria-label={`Expand sidebar to ${section.label}`}
                className={badgeClass}
              >
                {initial}
              </button>
            );
          })}
        </div>
      </nav>
    );
  }

  return (
    <nav className="flex h-full w-full flex-col border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex h-14 items-center justify-between border-b border-zinc-200 px-4 dark:border-zinc-800">
        <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Fashion ERP</span>
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-label="Minimize sidebar"
          title="Minimize sidebar"
          className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
        >
          <CollapseToggleIcon collapsed={false} />
        </button>
      </div>
      <div className="flex-1 space-y-0.5 overflow-y-auto px-2 py-3">
        {sections.map((section) => {
          if (!section.children) {
            const isActive = section.href ? isPathActive(pathname, section.href) : false;
            return (
              <Link key={section.label} href={section.href ?? "#"} className={LEAF_CLASSES(isActive) + " font-medium"}>
                {section.label}
              </Link>
            );
          }

          const isOpen = isGroupOpen(section);
          const groupActive = isSectionActive(section, pathname);

          return (
            <div key={section.label}>
              <div
                className={`flex items-center rounded-md px-3 py-1.5 text-sm font-semibold uppercase tracking-wide ${
                  groupActive ? "text-indigo-700 dark:text-indigo-300" : "text-zinc-500 dark:text-zinc-400"
                }`}
              >
                {section.href ? (
                  <Link href={section.href} className="flex-1 truncate normal-case tracking-normal hover:text-zinc-900 dark:hover:text-zinc-100">
                    {section.label}
                  </Link>
                ) : (
                  <button
                    type="button"
                    onClick={() => toggleGroup(section)}
                    className="flex-1 truncate text-left normal-case tracking-normal hover:text-zinc-900 dark:hover:text-zinc-100"
                  >
                    {section.label}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => toggleGroup(section)}
                  aria-label={isOpen ? `Collapse ${section.label}` : `Expand ${section.label}`}
                  aria-expanded={isOpen}
                  className="rounded p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  <ChevronIcon open={isOpen} />
                </button>
              </div>
              {isOpen && (
                <div className="ml-2 space-y-0.5 border-l border-zinc-200 pl-2 dark:border-zinc-800">
                  {section.children.map((child, index) => {
                    // A new, non-interactive sub-heading before the first
                    // leaf of each distinct `group` value — lets one section
                    // (e.g. "Inventory") present two or more sub-modules
                    // (Raw Materials / Finished Goods) without a second
                    // nesting level in the data model. No-op for every
                    // section whose leaves don't declare a group.
                    const showGroupHeading = child.group && child.group !== section.children![index - 1]?.group;
                    return (
                      <div key={child.href}>
                        {showGroupHeading && (
                          <div className="px-3 pt-2 pb-0.5 text-xs font-semibold uppercase tracking-wide text-zinc-400 first:pt-0 dark:text-zinc-500">
                            {child.group}
                          </div>
                        )}
                        <Link href={child.href} className={LEAF_CLASSES(isLeafActive(section.children!, child, pathname))}>
                          {child.label}
                        </Link>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </nav>
  );
}
