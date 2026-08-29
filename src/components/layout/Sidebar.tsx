"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import type { Module } from "@/config/rbac";
import { NAV_SECTIONS, filterNavSections, isPathActive, isSectionActive, type NavSection } from "./navigation";
import { CompanySwitcher } from "./CompanySwitcher";

// No `modules` gate — visibility is driven entirely by the isPlatformAdmin
// flag below, appended after the permission-based filter runs rather than
// through it (a platform admin is orthogonal to the module/action RBAC
// this whole file otherwise filters by).
const PLATFORM_SECTION: NavSection = {
  label: "Platform",
  modules: [],
  children: [{ label: "Companies", href: "/platform/companies", modules: [] }],
};

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

const LEAF_CLASSES = (isActive: boolean) =>
  `block rounded-md px-3 py-1.5 text-sm ${
    isActive
      ? "bg-indigo-50 font-medium text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300"
      : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
  }`;

export function Sidebar({
  isPlatformAdmin = false,
  viewableModules = "all",
}: {
  isPlatformAdmin?: boolean;
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
}) {
  const pathname = usePathname();
  const visibleSections = filterNavSections(NAV_SECTIONS, viewableModules);
  const sections = isPlatformAdmin ? [...visibleSections, PLATFORM_SECTION] : visibleSections;

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

  return (
    <nav className="flex h-full w-64 flex-col border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex h-14 items-center border-b border-zinc-200 px-4 dark:border-zinc-800">
        <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Fashion ERP</span>
      </div>
      <CompanySwitcher />
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
                  {section.children.map((child) => (
                    <Link key={child.href} href={child.href} className={LEAF_CLASSES(isPathActive(pathname, child.href))}>
                      {child.label}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </nav>
  );
}
