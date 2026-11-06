import { notFound } from "next/navigation";
import { SalesMarketingPageHeader } from "@/components/sales-marketing/SalesMarketingPageHeader";
import { SalesMarketingSettingsForm } from "@/components/sales-marketing/SalesMarketingSettingsForm";
import { getSalesMarketingPageContext } from "@/modules/sales-marketing/sales-marketing-page";
import { getSalesMarketingSettings } from "@/modules/sales-marketing/settings/sales-marketing-settings.service";

export default async function SalesMarketingSettingsPage() {
  const { actor, permissions } = await getSalesMarketingPageContext();
  if (!permissions.settings.view) notFound();
  const settings = await getSalesMarketingSettings(actor.companyId);
  return (
    <>
      <SalesMarketingPageHeader title="Settings" description="Quotation approval limits and defaults for new quotations." breadcrumbs={[{ label: "Settings" }]} />
      <SalesMarketingSettingsForm initial={JSON.parse(JSON.stringify(settings))} canEdit={permissions.settings.edit} />
    </>
  );
}
