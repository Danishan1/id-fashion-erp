import { notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { REPORT_CATEGORIES_META } from "@/modules/reports/categories-meta";
import { listReportConfigsForCategory } from "@/modules/reports/registry";
import "@/modules/reports/all-reports";

export default async function ReportCenterPage() {
  const session = await auth();
  await PermissionService.assert(session!.user.id, "reports", "view", { sessionIssuedAt: session!.user.sessionIssuedAt }).catch(() => notFound());

  return (
    <div className="space-y-4">
      <Breadcrumb items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Report Center" }]} />
      <div>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Report Center</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Every reporting category in the ERP. Categories with built reports link to real, live data; the rest are
          shown honestly as not-yet-built or not-available so nothing here pretends to work before it does.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {REPORT_CATEGORIES_META.map((cat) => {
          const builtCount = cat.unavailableReason ? 0 : listReportConfigsForCategory(cat.key).length;
          return (
            <Link
              key={cat.key}
              href={`/reports/${cat.key}`}
              className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm transition hover:border-indigo-300 hover:shadow dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-indigo-700"
            >
              <div className="flex items-center justify-between">
                <h2 className="font-medium text-zinc-900 dark:text-zinc-50">{cat.label}</h2>
                {cat.unavailableReason ? (
                  <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                    Not available
                  </span>
                ) : builtCount > 0 ? (
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400">
                    {builtCount} report{builtCount === 1 ? "" : "s"}
                  </span>
                ) : (
                  <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-400">
                    Coming soon
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{cat.description}</p>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
