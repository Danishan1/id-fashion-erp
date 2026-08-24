import Link from "next/link";
import { auth } from "@/core/auth/auth";
import { getMarketingDashboard } from "@/modules/marketing/campaign.service";
import { Breadcrumb } from "@/components/ui/Breadcrumb";

export default async function MarketingDashboardPage() {
  const session = await auth();
  const stats = await getMarketingDashboard(session!.user.companyId);

  const cards: Array<[string, string]> = [
    ["Budget", `₹${stats.budget.toLocaleString()}`],
    ["Spend", `₹${stats.spend.toLocaleString()}`],
    ["Mapped Leads", stats.leads.toLocaleString()],
    ["Qualified Leads", stats.qualifiedLeads.toLocaleString()],
    ["Customers", stats.customers.toLocaleString()],
    ["Attributed Revenue", `₹${stats.revenue.toLocaleString()}`],
    ["ROAS", `${stats.roas.toFixed(2)}x`],
    ["Open Alerts", stats.openAlerts.toLocaleString()],
  ];

  return (
    <div className="space-y-4">
      <Breadcrumb items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Marketing" }]} />
      <div>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Marketing Dashboard</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Campaign → Lead → Customer → Revenue intelligence, computed live across every campaign.</p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {cards.map(([label, value]) => (
          <div key={label} className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
            <div className="text-xs font-medium uppercase text-zinc-500">{label}</div>
            <div className="mt-1 text-xl font-semibold text-zinc-900 dark:text-zinc-50">{value}</div>
          </div>
        ))}
      </div>

      <Link href="/campaigns" className="inline-block text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400">
        View all Campaigns →
      </Link>
    </div>
  );
}
