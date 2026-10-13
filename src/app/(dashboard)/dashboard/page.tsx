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
  });

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
