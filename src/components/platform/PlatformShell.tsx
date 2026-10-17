"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import type { ReactNode } from "react";

/**
 * Layout for the platform administration portal (Platform SaaS Phase 1,
 * PLAT-003). Fully separate from the customer ERP's DashboardShell — its own
 * navigation, no ERP modules, no company switcher.
 */
const NAV_ITEMS = [
  { label: "Overview", href: "/platform" },
  { label: "Companies", href: "/platform/companies" },
  { label: "Plans", href: "/platform/plans" },
  { label: "Coupons", href: "/platform/coupons" },
  { label: "Support Tickets", href: "/platform/tickets" },
  { label: "Support Access", href: "/platform/support" },
  { label: "Staff & Team", href: "/platform/staff" },
  { label: "Audit Logs", href: "/platform/audit-logs" },
  { label: "System Health", href: "/platform/system-health" },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/platform") return pathname === "/platform";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function PlatformShell({ userName, roleLabel, children }: { userName: string; roleLabel: string; children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex h-dvh overflow-hidden">
      <nav className="flex w-60 shrink-0 flex-col border-r border-zinc-200 bg-zinc-900 text-zinc-100 dark:border-zinc-800">
        <div className="flex h-14 flex-col justify-center border-b border-zinc-800 px-4">
          <span className="text-sm font-semibold">Fashion ERP</span>
          <span className="text-xs text-indigo-300">Platform Administration</span>
        </div>
        <div className="flex-1 space-y-0.5 px-2 py-3">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`block rounded-md px-3 py-1.5 text-sm ${
                isActive(pathname, item.href) ? "bg-zinc-800 font-medium text-white" : "text-zinc-300 hover:bg-zinc-800"
              }`}
            >
              {item.label}
            </Link>
          ))}
        </div>
      </nav>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-end gap-4 border-b border-zinc-200 bg-white px-4 dark:border-zinc-800 dark:bg-zinc-900">
          <span className="text-sm text-zinc-600 dark:text-zinc-300">
            {userName} <span className="text-xs text-zinc-400">({roleLabel})</span>
          </span>
          <button
            type="button"
            onClick={() => signOut({ callbackUrl: "/platform/login" })}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            Sign out
          </button>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto bg-zinc-50 p-6 dark:bg-zinc-950">{children}</main>
      </div>
    </div>
  );
}

/** Shown when a platform session is no longer valid (account suspended, password changed). */
export function PlatformSessionInvalid() {
  return (
    <div className="flex h-dvh items-center justify-center bg-zinc-50 px-4 dark:bg-zinc-950">
      <div className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-8 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Session no longer valid</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
          Your platform account is no longer active, or its password was changed. Please sign in again.
        </p>
        <button
          type="button"
          onClick={() => signOut({ callbackUrl: "/platform/login" })}
          className="mt-6 rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
        >
          Sign in again
        </button>
      </div>
    </div>
  );
}
