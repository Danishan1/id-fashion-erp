"use client";

import Link from "next/link";
import { signOut } from "next-auth/react";
import { NotificationBell } from "./NotificationBell";

interface TopbarProps {
  userName: string;
}

export function Topbar({ userName }: TopbarProps) {
  return (
    <header className="flex h-14 items-center justify-between border-b border-zinc-200 bg-white px-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex-1">
        <input
          type="search"
          placeholder="Search customers, orders, samples, invoices…"
          className="w-full max-w-md rounded-md border border-zinc-300 bg-zinc-50 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-800"
        />
      </div>
      <div className="flex items-center gap-4">
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
