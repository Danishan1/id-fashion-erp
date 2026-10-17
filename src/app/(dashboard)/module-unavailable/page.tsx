import Link from "next/link";

/**
 * Where an ERP page redirects when its module is turned off for the
 * company by the platform (Platform SaaS Phase 3, PLAT-019).
 */
export default function ModuleUnavailablePage() {
  return (
    <div className="mx-auto mt-16 max-w-md rounded-lg border border-zinc-200 bg-white p-8 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Module not enabled</h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
        This part of the ERP isn&apos;t enabled for your company. If you need it, contact your administrator or the
        platform team.
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
