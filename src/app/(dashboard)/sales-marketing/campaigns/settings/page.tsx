import { notFound } from "next/navigation";
import { SalesMarketingPageHeader } from "@/components/sales-marketing/SalesMarketingPageHeader";
import { CampaignSettingsClient } from "@/components/sales-marketing/campaigns/CampaignSettingsClient";
import { getSalesMarketingPageContext } from "@/modules/sales-marketing/sales-marketing-page";

export default async function CampaignSettingsPage() {
  const { permissions } = await getSalesMarketingPageContext();
  if (!permissions.settings.view) notFound();
  return (
    <>
      <SalesMarketingPageHeader
        title="Campaign types & objectives"
        description="Your own lists for classifying campaigns. Whether campaign plans need approval is set in Sales & Marketing → Settings."
        breadcrumbs={[{ label: "Campaigns", href: "/sales-marketing/campaigns" }, { label: "Types & objectives" }]}
      />
      <CampaignSettingsClient canEdit={permissions.settings.edit} />
    </>
  );
}
