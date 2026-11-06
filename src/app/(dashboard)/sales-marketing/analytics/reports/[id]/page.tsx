import { SalesMarketingPageHeader } from "@/components/sales-marketing/SalesMarketingPageHeader";
import { SmAnalyticsClient } from "@/components/sales-marketing/analytics/SmAnalyticsClient";
import { getSalesMarketingPageContext } from "@/modules/sales-marketing/sales-marketing-page";

/** Phase 17 — one saved report (link target from schedules and bulk jobs). Access is checked by the API. */
export default async function SmSavedReportPage({ params }: { params: Promise<{ id: string }> }) {
  await getSalesMarketingPageContext();
  const { id } = await params;
  return (
    <>
      <SalesMarketingPageHeader title="Saved report" breadcrumbs={[{ label: "Analytics", href: "/sales-marketing/analytics" }, { label: "Saved report" }]} />
      <SmAnalyticsClient key={id} initialTab="saved" initialReportId={id} />
    </>
  );
}
