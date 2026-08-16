import { auth } from "@/core/auth/auth";
import { prisma } from "@/core/db/client";

async function getFoundationCounts(companyId: string) {
  const [customers, suppliers, employees, warehouses, users] = await Promise.all([
    prisma.customer.count({ where: { companyId, isActive: true } }),
    prisma.supplier.count({ where: { companyId, isActive: true } }),
    prisma.employee.count({ where: { companyId, isActive: true } }),
    prisma.warehouse.count({ where: { companyId, isActive: true } }),
    prisma.user.count({ where: { companyId, status: "ACTIVE" } }),
  ]);
  return { customers, suppliers, employees, warehouses, users };
}

export default async function DashboardPage() {
  const session = await auth();
  const companyId = session!.user.companyId;
  const counts = await getFoundationCounts(companyId);

  const tiles = [
    { label: "Active Customers", value: counts.customers },
    { label: "Active Suppliers", value: counts.suppliers },
    { label: "Employees", value: counts.employees },
    { label: "Warehouses", value: counts.warehouses },
    { label: "Active Users", value: counts.users },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Dashboard</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Sampling, Production, Accounts, and Dispatch KPIs will appear here as those modules go live
          (see CLAUDE.md phased roadmap). These are real counts from the current database.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {tiles.map((tile) => (
          <div
            key={tile.label}
            className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
          >
            <p className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">{tile.value}</p>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{tile.label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
