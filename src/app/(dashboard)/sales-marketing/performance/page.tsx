import { SalesMarketingPageHeader } from "@/components/sales-marketing/SalesMarketingPageHeader";
import { PerformanceBoardClient } from "@/components/sales-marketing/performance/PerformanceBoardClient";
import { periodContaining, isPeriodStart } from "@/modules/sales-marketing/performance/performance-periods";
import { periodContext } from "@/modules/sales-marketing/performance/performance-page";
import { METRIC_KEYS, type SalesTargetMetricKey, type SalesTargetPeriodTypeKey } from "@/modules/sales-marketing/performance/performance-registry";
import { getSalesMarketingPageContext } from "@/modules/sales-marketing/sales-marketing-page";

/** Sales & Marketing → Team Performance (Phase 05). `?metric&periodType&periodStart` pre-select the view. */
export default async function PerformancePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { actor } = await getSalesMarketingPageContext();
  const ctx = await periodContext(actor.companyId);
  const metric = (METRIC_KEYS as string[]).includes(sp.metric ?? "") ? (sp.metric as SalesTargetMetricKey) : "BOOKED_ORDER_VALUE";
  const periodType = (["MONTH", "QUARTER", "YEAR"].includes(sp.periodType ?? "") ? sp.periodType : "MONTH") as SalesTargetPeriodTypeKey;
  const periodStart = sp.periodStart && isPeriodStart(periodType, sp.periodStart, ctx.fiscalStartMonth) ? sp.periodStart : periodContaining(periodType, ctx.today, ctx.fiscalStartMonth).start;
  return (
    <>
      <SalesMarketingPageHeader title="Team performance" description="Actual sales against approved targets for you, your team and your territories." breadcrumbs={[{ label: "Team performance" }]} />
      <PerformanceBoardClient {...ctx} initial={{ metric, periodType, periodStart }} />
    </>
  );
}
