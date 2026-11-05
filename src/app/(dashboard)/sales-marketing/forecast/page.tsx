import { SalesMarketingPageHeader } from "@/components/sales-marketing/SalesMarketingPageHeader";
import { ForecastClient } from "@/components/sales-marketing/forecast/ForecastClient";
import { isPeriodStart, periodContaining } from "@/modules/sales-marketing/performance/performance-periods";
import { periodContext } from "@/modules/sales-marketing/performance/performance-page";
import type { SalesTargetPeriodTypeKey } from "@/modules/sales-marketing/performance/performance-registry";
import { getSalesMarketingPageContext } from "@/modules/sales-marketing/sales-marketing-page";

/** Sales & Marketing → Forecast (Phase 06). `?periodType&periodStart` pre-select the period. */
export default async function ForecastPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { actor, permissions } = await getSalesMarketingPageContext();
  const ctx = await periodContext(actor.companyId);
  const periodType = (["MONTH", "QUARTER", "YEAR"].includes(sp.periodType ?? "") ? sp.periodType : "MONTH") as SalesTargetPeriodTypeKey;
  const periodStart = sp.periodStart && isPeriodStart(periodType, sp.periodStart, ctx.fiscalStartMonth) ? sp.periodStart : periodContaining(periodType, ctx.today, ctx.fiscalStartMonth).start;
  return (
    <>
      <SalesMarketingPageHeader title="Sales forecast" description="Expected booked order value: what is already booked plus the weighted open pipeline, a trend estimate, and the approved target." breadcrumbs={[{ label: "Forecast" }]} />
      <ForecastClient {...ctx} initial={{ periodType, periodStart }} canSnapshot={permissions.performance.create} />
    </>
  );
}
