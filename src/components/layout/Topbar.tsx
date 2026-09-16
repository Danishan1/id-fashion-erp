"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { NotificationBell } from "./NotificationBell";
import { GlobalSearch } from "./GlobalSearch";

interface TopbarProps {
  userName: string;
  /** Toggles the mobile/tablet off-canvas nav drawer. Renders a hamburger button, `lg:hidden`, when supplied. */
  onMenuClick?: () => void;
}

function MenuIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5" aria-hidden="true">
      <path d="M3 5.5h14M3 10h14M3 14.5h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function Topbar({ userName, onMenuClick }: TopbarProps) {
  const router = useRouter();
  const pathname = usePathname();
  // Hidden on the dashboard home page — nothing meaningful to go back to
  // from the app's own landing page. Present everywhere else, in the same
  // top-right spot on every page, so it's always where a user expects it
  // rather than depending on each page's own breadcrumb being noticed.
  const showBack = pathname !== "/dashboard";

  return (
    <header className="flex h-14 items-center justify-between gap-3 border-b border-zinc-200 bg-white px-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-1 items-center gap-3">
        {onMenuClick && (
          <button
            type="button"
            onClick={onMenuClick}
            aria-label="Open navigation menu"
            className="shrink-0 rounded-md border border-zinc-300 p-2 text-zinc-700 hover:bg-zinc-100 lg:hidden dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            <MenuIcon />
          </button>
        )}
        <GlobalSearch />
      </div>
      <div className="flex items-center gap-4">
        {showBack && (
          <button
            type="button"
            onClick={() => router.back()}
            className="flex items-center gap-1 rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            <span aria-hidden="true">←</span> Back
          </button>
        )}
        <NotificationBell />
        <Link href="/account" className="text-sm text-zinc-600 hover:underline dark:text-zinc-300">
          {userName}
        </Link>
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          Sign out
        </button>
      </div>
    </header>
  );
}
