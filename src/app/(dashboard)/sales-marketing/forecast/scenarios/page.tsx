import Link from "next/link";
import { SalesMarketingPageHeader } from "@/components/sales-marketing/SalesMarketingPageHeader";
import { buttonClasses } from "@/components/ui/Button";
import { formatDateTime } from "@/lib/date-format";
import { listScenarios } from "@/modules/sales-marketing/forecast/forecast-scenario.service";
import { periodLabel } from "@/modules/sales-marketing/performance/performance-periods";
import { periodContext } from "@/modules/sales-marketing/performance/performance-page";
import { getSalesMarketingPageContext } from "@/modules/sales-marketing/sales-marketing-page";

export default async function ScenariosPage({ searchParams }: { searchParams: Promise<{ archived?: string }> }) {
  const { archived } = await searchParams;
  const { actor, permissions } = await getSalesMarketingPageContext();
  const [rows, ctx] = await Promise.all([listScenarios(actor, { archived: archived === "true" ? "true" : "false" }), periodContext(actor.companyId)]);
  return (
    <>
      <SalesMarketingPageHeader
        title="What-if scenarios"
        description="Try other assumptions — lower win rates, later dates, growth — against the live forecast. Scenarios never change any real record."
        breadcrumbs={[{ label: "Forecast", href: "/sales-marketing/forecast" }, { label: "Scenarios" }]}
        actions={
          permissions.performance.create ? (
            <Link href="/sales-marketing/forecast/scenarios/new" className={buttonClasses("primary", "sm")}>
              New scenario
            </Link>
          ) : undefined
        }
      />
      <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mb-2 text-xs">
          <Link href={archived === "true" ? "/sales-marketing/forecast/scenarios" : "/sales-marketing/forecast/scenarios?archived=true"} className="text-indigo-600 hover:underline dark:text-indigo-400">
            {archived === "true" ? "Show current scenarios" : "Show archived scenarios"}
          </Link>
        </div>
        {rows.length === 0 ? (
          <p className="text-sm text-zinc-500">No scenarios yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500 dark:border-zinc-800">
                <th className="py-1.5 font-medium">Scenario</th>
                <th className="py-1.5 font-medium">Period</th>
                <th className="py-1.5 font-medium">Assumptions</th>
                <th className="py-1.5 font-medium">Changed</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                  <td className="py-1.5">
                    <Link href={`/sales-marketing/forecast/scenarios/${s.id}`} className="font-medium text-indigo-700 hover:underline dark:text-indigo-300">
                      {s.name}
                    </Link>
                    {s.description && <div className="text-xs text-zinc-500">{s.description}</div>}
                  </td>
                  <td className="py-1.5">{periodLabel(s.periodType, s.periodStart, ctx.fiscalStartMonth)}</td>
                  <td className="py-1.5 text-xs text-zinc-600 dark:text-zinc-300">
                    Probabilities ×{s.assumptions.probabilityFactor}%{s.assumptions.slipDays ? `, +${s.assumptions.slipDays} days` : ""}
                    {s.assumptions.includeOverdue ? ", overdue counted" : ""}
                    {!s.assumptions.includeQuotations ? ", no quotations" : ""}
                    {!s.assumptions.includeOpportunities ? ", no opportunities" : ""}
                    {s.assumptions.trendGrowth ? `, trend ${s.assumptions.trendGrowth > 0 ? "+" : ""}${s.assumptions.trendGrowth}%` : ""}
                  </td>
                  <td className="py-1.5 text-xs">
                    {s.createdBy}
                    <div className="text-zinc-500">{formatDateTime(s.updatedAt)}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
