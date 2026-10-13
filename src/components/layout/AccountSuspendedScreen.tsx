"use client";

import { signOut } from "next-auth/react";

/** Shown instead of the ERP to users of a suspended company (PLAT-006). */
export function AccountSuspendedScreen({ companyName }: { companyName: string }) {
  return (
    <div className="flex h-dvh items-center justify-center bg-zinc-50 px-4 dark:bg-zinc-950">
      <div className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-8 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Account suspended</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
          The account for <span className="font-medium">{companyName}</span> is currently suspended, so the ERP
          can&apos;t be used. Please contact support to restore access.
        </p>
        <button
          type="button"
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="mt-6 rounded-md border border-zinc-300 px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
