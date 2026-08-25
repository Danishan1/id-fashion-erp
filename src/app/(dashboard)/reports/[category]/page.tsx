import { notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/core/auth/auth";
import { assertReportAccess } from "@/core/reports/permissions";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { REPORT_CATEGORIES_META } from "@/modules/reports/categories-meta";
import { listReportConfigsForCategory } from "@/modules/reports/registry";
import "@/modules/reports/all-reports";

export default async function ReportCategoryPage({ params }: { params: Promise<{ category: string }> }) {
  const { category } = await params;
  const meta = REPORT_CATEGORIES_META.find((c) => c.key === category);
  if (!meta) notFound();

  const session = await auth();
  await assertReportAccess(session!.user.id, meta.key, "view").catch(() => notFound());

  const configs = listReportConfigsForCategory(category);

  return (
    <div className="space-y-4">
      <Breadcrumb items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Report Center", href: "/reports" }, { label: meta.label }]} />
      <div>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">{meta.label}</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{meta.description}</p>
      </div>

      {meta.unavailableReason ? (
        <p className="rounded-md border border-dashed border-zinc-300 bg-zinc-50 px-4 py-8 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900">
          {meta.unavailableReason}
        </p>
      ) : configs.length === 0 && category !== "sales-orders" ? (
        <p className="rounded-md border border-dashed border-amber-300 bg-amber-50 px-4 py-8 text-center text-sm text-amber-700 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-400">
          Reports for this category are not yet built — planned for a follow-up session on this same architecture.
        </p>
      ) : (
        <div className="divide-y divide-zinc-200 overflow-hidden rounded-lg border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
          {configs.map((c) => (
            <Link
              key={c.key}
              href={`/reports/${category}/${c.key}`}
              className="block px-4 py-3 text-sm font-medium text-zinc-800 hover:bg-zinc-50 dark:text-zinc-100 dark:hover:bg-zinc-800/60"
            >
              {c.title}
            </Link>
          ))}
          {category === "sales-orders" ? (
            <Link
              href="/reports/order-lifecycle"
              className="block px-4 py-3 text-sm font-medium text-zinc-800 hover:bg-zinc-50 dark:text-zinc-100 dark:hover:bg-zinc-800/60"
            >
              Order Lifecycle Report <span className="font-normal text-zinc-500">— full Order → Sampling → Purchase → Production → QC → Dispatch → Invoice → Payment trace</span>
            </Link>
          ) : null}
        </div>
      )}
    </div>
  );
}
