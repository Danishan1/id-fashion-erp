import { notFound } from "next/navigation";
import { ChannelsClient } from "@/components/sales-marketing/channels/ChannelsClient";
import { SalesMarketingPageHeader } from "@/components/sales-marketing/SalesMarketingPageHeader";
import { getSalesMarketingPageContext } from "@/modules/sales-marketing/sales-marketing-page";

/** Sales & Marketing → Sales channels (Phase 07). Managed with sales_marketing_settings. */
export default async function ChannelsPage() {
  const { permissions } = await getSalesMarketingPageContext();
  if (!permissions.settings.view) notFound();
  return (
    <>
      <SalesMarketingPageHeader
        title="Sales channels"
        description="The ways you sell. Set on each enquiry, quotation and Sales Order (the order's channel is what a sale is credited to)."
        breadcrumbs={[{ label: "Sales channels" }]}
      />
      <ChannelsClient canEdit={permissions.settings.edit} />
    </>
  );
}
