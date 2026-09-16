"use client";

import { useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import type { Module } from "@/config/rbac";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";

/**
 * The dashboard shell: sidebar + topbar + scrollable content area.
 *
 * Two responsibilities live here, both previously missing (see the 2026-09-16
 * UI/UX audit, priority fixes #1/#2):
 *  - Height containment: this outer container is pinned to exactly the
 *    viewport height (`h-dvh`) with `overflow-hidden`, so the page itself
 *    never scrolls — only `<main>` does (`overflow-y-auto` + `min-h-0`, the
 *    latter needed because a flex child's default `min-height: auto` would
 *    otherwise refuse to shrink below its content size and defeat the
 *    scroll). The sidebar therefore never scrolls out of view on a long page.
 *  - Responsive nav: on `lg` and above the sidebar renders exactly as before
 *    (a static, always-visible column — nothing changes for desktop users).
 *    Below `lg` it becomes a fixed, off-canvas drawer toggled by a hamburger
 *    button in the Topbar, with a click-to-dismiss backdrop, auto-closing on
 *    every route change so it never lingers open over newly-navigated page.
 */
export function DashboardShell({
  isPlatformAdmin,
  viewableModules,
  userName,
  children,
}: {
  isPlatformAdmin?: boolean;
  viewableModules: Module[] | "all";
  userName: string;
  children: ReactNode;
}) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const pathname = usePathname();

  // Close the drawer whenever the route changes (e.g. after tapping a nav
  // link) — adjusted directly during render against a tracked previous
  // pathname, per React's own "adjusting state when a prop changes"
  // guidance, rather than a useEffect that calls setState synchronously
  // (this project's own established react-hooks/set-state-in-effect fix).
  const [lastPathname, setLastPathname] = useState(pathname);
  if (pathname !== lastPathname) {
    setLastPathname(pathname);
    setMobileNavOpen(false);
  }

  return (
    <div className="flex h-dvh overflow-hidden">
      {mobileNavOpen && (
        <div
          className="fixed inset-0 z-30 bg-zinc-900/50 lg:hidden"
          onClick={() => setMobileNavOpen(false)}
          aria-hidden="true"
        />
      )}
      <div
        className={`fixed inset-y-0 left-0 z-40 w-64 transition-transform duration-200 ease-in-out lg:static lg:z-auto lg:translate-x-0 lg:transition-none ${
          mobileNavOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <Sidebar isPlatformAdmin={isPlatformAdmin} viewableModules={viewableModules} />
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        <Topbar userName={userName} onMenuClick={() => setMobileNavOpen((open) => !open)} />
        <main className="min-h-0 flex-1 overflow-y-auto bg-zinc-50 p-6 dark:bg-zinc-950">{children}</main>
      </div>
    </div>
  );
}
