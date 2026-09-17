"use client";

import { useState, useSyncExternalStore, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import type { Module } from "@/config/rbac";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";

const SIDEBAR_COLLAPSED_KEY = "erp-sidebar-collapsed";

// A tiny external store over localStorage, read via useSyncExternalStore —
// React's own designed-for-this-exact-case hook for a value that lives
// outside React and can differ between the server-rendered first paint and
// the client. Unlike a useEffect-driven setState, this has no
// react-hooks/set-state-in-effect concern (there's no setState in an effect
// at all) AND no hydration-mismatch risk (getServerSnapshot always returns
// the same "expanded" default the server rendered, and React's own
// reconciliation for this hook already accounts for a client snapshot that
// legitimately differs from the server one, unlike a plain lazy useState
// initializer would).
const collapsedListeners = new Set<() => void>();

function subscribeToSidebarCollapsed(listener: () => void) {
  collapsedListeners.add(listener);
  return () => collapsedListeners.delete(listener);
}

function getSidebarCollapsedSnapshot(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true";
  } catch {
    return false;
  }
}

function getSidebarCollapsedServerSnapshot(): boolean {
  return false;
}

function setSidebarCollapsedStore(next: boolean) {
  try {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next));
  } catch {
    // Private browsing / blocked storage — the in-memory notify below still
    // toggles the UI for this session, it just won't persist across reloads.
  }
  collapsedListeners.forEach((listener) => listener());
}

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
  // Desktop-only sidebar minimize/maximize — a pure per-viewer display
  // preference. Renders "expanded" on the server-rendered first paint
  // (getSidebarCollapsedServerSnapshot), then the real localStorage value
  // once mounted on the client — the same one-render "flash" tradeoff
  // already accepted elsewhere in this app for a pure browser-storage
  // convenience (never used for state that must persist reliably or be
  // read back by the server).
  const isSidebarCollapsed = useSyncExternalStore(
    subscribeToSidebarCollapsed,
    getSidebarCollapsedSnapshot,
    getSidebarCollapsedServerSnapshot
  );
  function toggleSidebarCollapsed() {
    setSidebarCollapsedStore(!isSidebarCollapsed);
  }
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
        className={`fixed inset-y-0 left-0 z-40 w-64 shrink-0 transition-transform duration-200 ease-in-out lg:static lg:z-auto lg:translate-x-0 lg:transition-none ${
          isSidebarCollapsed ? "lg:w-16" : "lg:w-64"
        } ${mobileNavOpen ? "translate-x-0" : "-translate-x-full"}`}
      >
        <Sidebar
          isPlatformAdmin={isPlatformAdmin}
          viewableModules={viewableModules}
          // The desktop minimize preference must never apply while the
          // mobile off-canvas drawer is the thing actually on screen — the
          // drawer's own wrapper stays a fixed w-64 regardless of this
          // state (only the lg: width classes above respond to it), so
          // rendering the collapsed icon-rail content inside that full-width
          // drawer would look broken. mobileNavOpen is only ever true while
          // that drawer is visible, so gating on it here is exact, not an
          // approximation — no viewport/matchMedia detection needed.
          isCollapsed={isSidebarCollapsed && !mobileNavOpen}
          onToggleCollapse={toggleSidebarCollapsed}
        />
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        <Topbar userName={userName} onMenuClick={() => setMobileNavOpen((open) => !open)} />
        <main className="min-h-0 flex-1 overflow-y-auto bg-zinc-50 p-6 dark:bg-zinc-950">{children}</main>
      </div>
    </div>
  );
}
