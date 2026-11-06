import Link from "next/link";
import { SalesMarketingPageHeader } from "@/components/sales-marketing/SalesMarketingPageHeader";
import { CampaignsClient } from "@/components/sales-marketing/campaigns/CampaignsClient";
import { buttonClasses } from "@/components/ui/Button";
import { getSalesMarketingPageContext } from "@/modules/sales-marketing/sales-marketing-page";

/** Sales & Marketing → Campaigns (Phase 08): marketing overview + campaign list. */
export default async function CampaignsPage() {
  const { permissions } = await getSalesMarketingPageContext();
  return (
    <>
      <SalesMarketingPageHeader
        title="Campaigns"
        description="Plan, approve and run marketing campaigns; results come from the leads, enquiries, quotations, orders and expenses linked to them."
        breadcrumbs={[{ label: "Campaigns" }]}
        actions={
          <div className="flex gap-2">
            <Link href="/sales-marketing/campaigns/calendar" className={buttonClasses("secondary", "sm")}>
              Calendar
            </Link>
            {permissions.settings.view && (
              <Link href="/sales-marketing/campaigns/settings" className={buttonClasses("secondary", "sm")}>
                Types &amp; objectives
              </Link>
            )}
            {permissions.campaigns.create && (
              <Link href="/sales-marketing/campaigns/new" className={buttonClasses("primary", "sm")}>
                New campaign
              </Link>
            )}
          </div>
        }
      />
      <CampaignsClient />
    </>
  );
}
