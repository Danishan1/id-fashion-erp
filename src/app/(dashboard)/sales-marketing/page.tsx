import { SalesMarketingPageHeader } from "@/components/sales-marketing/SalesMarketingPageHeader";
import { SalesMarketingDashboardClient } from "@/components/sales-marketing/SalesMarketingDashboardClient";
import { redirect } from "next/navigation";
import { getSalesMarketingPageContext } from "@/modules/sales-marketing/sales-marketing-page";

/**
 * Sales & Marketing dashboard — the module home: headline KPIs vs the previous
 * period, bookings trend, enquiry funnel, work queue, team & targets and system
 * health, all from the governed metrics in the viewer's own scope.
 */
export default async function SalesMarketingDashboardPage() {
  // Users without Sales & Marketing itself land on the area they do have.
  const { permissions } = await getSalesMarketingPageContext();
  if (!permissions.view) redirect(permissions.quotations.view ? "/sales-marketing/quotations" : "/sales-marketing/settings");
  return (
    <>
      <SalesMarketingPageHeader
        title="Sales & Marketing"
        description="How sales and marketing are doing, what needs your attention, and whether everything is running — in your own access."
      />
      <SalesMarketingDashboardClient />
    </>
  );
}
