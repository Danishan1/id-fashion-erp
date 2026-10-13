"use client";

import { signOut } from "next-auth/react";

/**
 * Where a support session lands once it has been revoked by the customer,
 * has expired, or was ended (Platform SaaS Phase 2, PLAT-014). Reachable
 * signed in or out (route-access.ts).
 */
export default function SupportEndedPage() {
  return (
    <div className="flex flex-1 items-center justify-center bg-zinc-50 px-4 dark:bg-zinc-950">
      <div className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-8 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Support session ended</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
          This support session has ended — it expired, was ended, or the customer revoked access. You no longer have
          access to this company&apos;s data.
        </p>
        <button
          type="button"
          onClick={() => signOut({ callbackUrl: "/platform/login" })}
          className="mt-6 rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
        >
          Back to platform sign-in
        </button>
      </div>
    </div>
  );
}
