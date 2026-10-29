import { SalesMarketingPageHeader } from "@/components/sales-marketing/SalesMarketingPageHeader";
import { SalesMarketingDashboardClient } from "@/components/sales-marketing/SalesMarketingDashboardClient";
import { redirect } from "next/navigation";
import { getSalesMarketingPageContext } from "@/modules/sales-marketing/sales-marketing-page";

/**
 * Sales & Marketing dashboard (Phase 01 foundation). Shows the module map and
 * the existing ERP data the module builds on. Sales and marketing KPIs appear
 * here as their phases are built — none are shown before real data exists.
 */
export default async function SalesMarketingDashboardPage() {
  // Users without Sales & Marketing itself land on the area they do have.
  const { permissions } = await getSalesMarketingPageContext();
  if (!permissions.view) redirect(permissions.quotations.view ? "/sales-marketing/quotations" : "/sales-marketing/settings");
  return (
    <>
      <SalesMarketingPageHeader
        title="Sales & Marketing"
        description="Enquiries, quotations, pricing, targets and campaigns — built in phases on top of your existing customers, CRM and sales orders."
      />
      <SalesMarketingDashboardClient />
    </>
  );
}
