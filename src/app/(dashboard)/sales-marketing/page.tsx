import { SalesMarketingPageHeader } from "@/components/sales-marketing/SalesMarketingPageHeader";
import { SalesMarketingDashboardClient } from "@/components/sales-marketing/SalesMarketingDashboardClient";

/**
 * Sales & Marketing dashboard (Phase 01 foundation). Shows the module map and
 * the existing ERP data the module builds on. Sales and marketing KPIs appear
 * here as their phases are built — none are shown before real data exists.
 */
export default function SalesMarketingDashboardPage() {
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
