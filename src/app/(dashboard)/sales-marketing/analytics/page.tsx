import { SalesMarketingPageHeader } from "@/components/sales-marketing/SalesMarketingPageHeader";
import { SmAnalyticsClient, type AnalyticsTab } from "@/components/sales-marketing/analytics/SmAnalyticsClient";
import { getSalesMarketingPageContext } from "@/modules/sales-marketing/sales-marketing-page";

const TABS: AnalyticsTab[] = ["dashboards", "builder", "saved", "deliveries", "glossary", "usage"];

/** Phase 17 — Sales & Marketing → Analytics: dashboards, governed report builder, saved and scheduled reports, glossary. */
export default async function SmAnalyticsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  await getSalesMarketingPageContext();
  const { tab } = await searchParams;
  return (
    <>
      <SalesMarketingPageHeader
        title="Analytics"
        description="Governed reports and dashboards across enquiries, quotations, orders, invoices, campaigns, targets and operations. Every number uses a defined metric and is shown with your own access."
        breadcrumbs={[{ label: "Analytics" }]}
      />
      <SmAnalyticsClient initialTab={TABS.includes(tab as AnalyticsTab) ? (tab as AnalyticsTab) : "dashboards"} />
    </>
  );
}
