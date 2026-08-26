import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { getMarketingDashboard, getMarketingTrends } from "@/modules/marketing/campaign.service";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { TrendChart } from "./TrendChart";

export default async function MarketingDashboardPage() {
  const session = await auth();
  await PermissionService.assert(session!.user.id, "marketing", "view", { sessionIssuedAt: session!.user.sessionIssuedAt }).catch(() => notFound());

  const [stats, trends] = await Promise.all([
    getMarketingDashboard(session!.user.companyId),
    getMarketingTrends(session!.user.companyId, 30),
  ]);

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

      <div>
        <h2 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Last 30 Days</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <TrendChart title="Spend" data={trends.map((t) => ({ date: t.date, value: t.spend }))} color="#dc2626" format={(v) => `₹${v.toLocaleString()}`} />
          <TrendChart title="Leads" data={trends.map((t) => ({ date: t.date, value: t.leads }))} color="#4f46e5" />
          <TrendChart title="Revenue" data={trends.map((t) => ({ date: t.date, value: t.revenue }))} color="#16a34a" format={(v) => `₹${v.toLocaleString()}`} />
          <TrendChart title="Clicks" data={trends.map((t) => ({ date: t.date, value: t.clicks }))} color="#0891b2" />
          <TrendChart title="Impressions" data={trends.map((t) => ({ date: t.date, value: t.impressions }))} color="#7c3aed" />
          <TrendChart title="ROAS" data={trends.map((t) => ({ date: t.date, value: t.roas }))} color="#ea580c" format={(v) => `${v.toFixed(2)}x`} />
        </div>
      </div>

      <div className="flex gap-4">
        <Link href="/campaigns" className="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400">
          View all Campaigns →
        </Link>
        <Link href="/marketing/channel-performance" className="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400">
          Channel Performance →
        </Link>
        <Link href="/marketing/customer-segments" className="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400">
          Customer Segments →
        </Link>
        <Link href="/marketing/ad-integrations" className="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400">
          Ad Integrations →
        </Link>
      </div>
    </div>
  );
}
