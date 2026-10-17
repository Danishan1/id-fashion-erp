import { notFound } from "next/navigation";
import { getPlatformPageUser } from "@/modules/platform/platform-page";
import { getPlatformOverview } from "@/modules/platform/platform-overview.service";

function StatTiles({ tiles }: { tiles: { label: string; value: number }[] }) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
      {tiles.map((tile) => (
        <div key={tile.label} className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">{tile.value}</p>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{tile.label}</p>
        </div>
      ))}
    </div>
  );
}

export default async function PlatformOverviewPage() {
  if (!(await getPlatformPageUser())) notFound();
  const { overall, companies } = await getPlatformOverview();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Platform Overview</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Totals across every company on this instance. Counts only — platform accounts can&apos;t open a
          company&apos;s ERP data.
        </p>
      </div>
      <StatTiles
        tiles={[
          { label: "Companies", value: overall.companies },
          { label: "Active Companies", value: overall.activeCompanies },
          { label: "Active Customers", value: overall.customers },
          { label: "Active Suppliers", value: overall.suppliers },
          { label: "Employees", value: overall.employees },
          { label: "Active Users", value: overall.users },
        ]}
      />
      <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
              <th className="px-4 py-2 font-medium">Company</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Customers</th>
              <th className="px-4 py-2 font-medium">Suppliers</th>
              <th className="px-4 py-2 font-medium">Employees</th>
              <th className="px-4 py-2 font-medium">Users</th>
            </tr>
          </thead>
          <tbody>
            {companies.map((c) => (
              <tr key={c.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                <td className="px-4 py-2 font-medium text-zinc-900 dark:text-zinc-50">{c.name}</td>
                <td className="px-4 py-2 text-zinc-700 dark:text-zinc-200">{c.isActive ? "Active" : "Suspended"}</td>
                <td className="px-4 py-2 text-zinc-700 dark:text-zinc-200">{c.customers}</td>
                <td className="px-4 py-2 text-zinc-700 dark:text-zinc-200">{c.suppliers}</td>
                <td className="px-4 py-2 text-zinc-700 dark:text-zinc-200">{c.employees}</td>
                <td className="px-4 py-2 text-zinc-700 dark:text-zinc-200">{c.users}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
