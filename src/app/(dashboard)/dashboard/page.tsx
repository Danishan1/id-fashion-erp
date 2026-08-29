import { auth } from "@/core/auth/auth";
import { getDashboardViewForUser } from "@/modules/dashboard/dashboard.service";

function StatTiles({ tiles }: { tiles: { label: string; value: number }[] }) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
      {tiles.map((tile) => (
        <div key={tile.label} className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">{tile.value}</p>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{tile.label}</p>
        </div>
      ))}
    </div>
  );
}

export default async function DashboardPage() {
  const session = await auth();
  const view = await getDashboardViewForUser({
    userId: session!.user.id,
    companyId: session!.user.companyId,
    isPlatformAdmin: session!.user.isPlatformAdmin,
  });

  if (view.kind === "platform") {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Platform Overview</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Totals across every active company on this instance — switch into one from the sidebar to work
            inside it directly.
          </p>
        </div>
        <StatTiles
          tiles={[
            { label: "Companies", value: view.overall.companies },
            { label: "Active Customers", value: view.overall.customers },
            { label: "Active Suppliers", value: view.overall.suppliers },
            { label: "Employees", value: view.overall.employees },
            { label: "Active Users", value: view.overall.users },
          ]}
        />
        <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                <th className="px-4 py-2 font-medium">Company</th>
                <th className="px-4 py-2 font-medium">Customers</th>
                <th className="px-4 py-2 font-medium">Suppliers</th>
                <th className="px-4 py-2 font-medium">Employees</th>
                <th className="px-4 py-2 font-medium">Users</th>
              </tr>
            </thead>
            <tbody>
              {view.companies.map((c) => (
                <tr key={c.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                  <td className="px-4 py-2 font-medium text-zinc-900 dark:text-zinc-50">{c.name}</td>
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

  if (view.kind === "team") {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">My Team</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Scoped to the employees who report directly to {view.supervisorName} — not the whole company.
          </p>
        </div>
        <StatTiles
          tiles={[
            { label: "Team Size", value: view.team.teamSize },
            { label: "Present Today", value: view.team.presentToday },
            { label: "Active Job Orders", value: view.team.activeJobOrders },
            { label: "Pending Leave Requests", value: view.team.pendingLeaveRequests },
          ]}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Dashboard</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Sampling, Production, Accounts, and Dispatch KPIs will appear here as those modules go live
          (see CLAUDE.md phased roadmap). These are real counts from the current database.
        </p>
      </div>
      <StatTiles
        tiles={[
          { label: "Active Customers", value: view.counts.customers },
          { label: "Active Suppliers", value: view.counts.suppliers },
          { label: "Employees", value: view.counts.employees },
          { label: "Warehouses", value: view.counts.warehouses },
          { label: "Active Users", value: view.counts.users },
        ]}
      />
    </div>
  );
}
