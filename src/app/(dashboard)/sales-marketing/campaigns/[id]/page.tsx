import { notFound } from "next/navigation";
import { SalesMarketingPageHeader } from "@/components/sales-marketing/SalesMarketingPageHeader";
import { CampaignDetailClient } from "@/components/sales-marketing/campaigns/CampaignDetailClient";
import { getCampaign } from "@/modules/sales-marketing/campaigns/campaign-results.service";
import { getSalesMarketingPageContext } from "@/modules/sales-marketing/sales-marketing-page";

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor } = await getSalesMarketingPageContext();
  const c = await getCampaign(actor, id).catch(() => null);
  if (!c) notFound();
  return (
    <>
      <SalesMarketingPageHeader title={`${c.code} · ${c.name}`} breadcrumbs={[{ label: "Campaigns", href: "/sales-marketing/campaigns" }, { label: c.code }]} />
      <CampaignDetailClient key={id} initial={JSON.parse(JSON.stringify(c))} currentUserId={actor.userId} />
    </>
  );
}
