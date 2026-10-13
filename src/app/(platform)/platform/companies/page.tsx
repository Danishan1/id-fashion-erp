import { notFound } from "next/navigation";
import Link from "next/link";
import { getPlatformPageUser } from "@/modules/platform/platform-page";
import { listCompanySummaries } from "@/modules/platform/platform-company-lifecycle.service";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { formatDate } from "@/lib/date-format";

export default async function PlatformCompaniesPage() {
  const user = await getPlatformPageUser();
  if (!user) notFound();
  const canCreate = user.role === "PLATFORM_SUPER_ADMIN";
  const canRequestSupport = user.role === "PLATFORM_SUPER_ADMIN" || user.role === "SUPPORT_AGENT";

  const companies = await listCompanySummaries();

  return (
    <div className="space-y-4">
      <Breadcrumb items={[{ label: "Platform", href: "/platform" }, { label: "Companies" }]} />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Companies</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Every company hosted on this instance. Open a company to see its usage, edit its details, suspend or
            reactivate it, and turn modules on or off.
          </p>
        </div>
        {canCreate && (
          <Link
            href="/platform/companies/new"
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
          >
            New Company
          </Link>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-4 py-2 font-medium">Tax Reg. No.</th>
              <th className="px-4 py-2 font-medium">Active Users</th>
              <th className="px-4 py-2 font-medium">Last Login</th>
              <th className="px-4 py-2 font-medium">Modules Off</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Created</th>
              <th className="px-4 py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {companies.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-zinc-500">
                  No companies yet.
                </td>
              </tr>
            )}
            {companies.map((c) => (
              <tr key={c.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                <td className="px-4 py-2">
                  <Link href={`/platform/companies/${c.id}`} className="font-medium text-indigo-600 hover:underline">
                    {c.name}
                  </Link>
                  {c.legalName && <div className="text-xs text-zinc-500">{c.legalName}</div>}
                </td>
                <td className="px-4 py-2 text-zinc-700 dark:text-zinc-200">{c.taxRegistrationNo ?? "—"}</td>
                <td className="px-4 py-2 text-zinc-700 dark:text-zinc-200">{c.activeUsers}</td>
                <td className="px-4 py-2 text-zinc-700 dark:text-zinc-200">{c.lastLoginAt ? formatDate(c.lastLoginAt) : "—"}</td>
                <td className="px-4 py-2 text-zinc-700 dark:text-zinc-200">{c.disabledModuleCount || "—"}</td>
                <td className="px-4 py-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      c.isActive
                        ? "bg-green-100 text-green-700 dark:bg-green-500/10 dark:text-green-400"
                        : "bg-red-100 text-red-700 dark:bg-red-500/10 dark:text-red-400"
                    }`}
                  >
                    {c.isActive ? "Active" : "Suspended"}
                  </span>
                </td>
                <td className="px-4 py-2 text-zinc-700 dark:text-zinc-200">{formatDate(c.createdAt)}</td>
                <td className="px-4 py-2 text-right whitespace-nowrap">
                  {canRequestSupport && c.isActive && (
                    <Link href={`/platform/support?companyId=${c.id}`} className="text-indigo-600 hover:underline">
                      Request support access
                    </Link>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
