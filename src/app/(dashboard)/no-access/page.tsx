import Link from "next/link";

/**
 * Where an ERP page redirects when the user has no view permission on any
 * module that owns it (P6, 2026-10-21). The proxy checks this before the page
 * renders, so a list page without permission never shows its shell.
 */
export default function NoAccessPage() {
  return (
    <div className="mx-auto mt-16 max-w-md rounded-lg border border-zinc-200 bg-white p-8 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">No access</h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
        You don&apos;t have permission to open this page. If you need it, ask your administrator.
      </p>
      <Link
        href="/dashboard"
        className="mt-6 inline-block rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
      >
        Back to dashboard
      </Link>
    </div>
  );
}
