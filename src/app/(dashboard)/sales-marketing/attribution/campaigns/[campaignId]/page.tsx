import { SalesMarketingPageHeader } from "@/components/sales-marketing/SalesMarketingPageHeader";
import { AttributionCampaignClient } from "@/components/sales-marketing/attribution/AttributionCampaignClient";

export default async function AttributionCampaignPage({ params, searchParams }: { params: Promise<{ campaignId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { campaignId } = await params;
  const sp = await searchParams;
  const query = new URLSearchParams(Object.entries({ modelId: sp.modelId, from: sp.from, to: sp.to }).filter((e): e is [string, string] => Boolean(e[1]))).toString();
  return (
    <>
      <SalesMarketingPageHeader title="Campaign attribution" breadcrumbs={[{ label: "Attribution & ROI", href: "/sales-marketing/attribution" }, { label: "Campaign" }]} />
      <AttributionCampaignClient key={`${campaignId}-${query}`} campaignId={campaignId} query={query} />
    </>
  );
}
