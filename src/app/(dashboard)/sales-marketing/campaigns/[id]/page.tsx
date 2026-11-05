import { notFound } from "next/navigation";
import { SalesMarketingPageHeader } from "@/components/sales-marketing/SalesMarketingPageHeader";
import { CampaignDetailClient } from "@/components/sales-marketing/campaigns/CampaignDetailClient";
import { CampaignAudiencePanel } from "@/components/sales-marketing/segments/CampaignAudiencePanel";
import { CampaignDeliveryPanel } from "@/components/sales-marketing/delivery/CampaignDeliveryPanel";
import { CampaignContentPanel } from "@/components/sales-marketing/content/CampaignContentPanel";
import { PermissionService } from "@/core/rbac/PermissionService";
import { getCampaign } from "@/modules/sales-marketing/campaigns/campaign-results.service";
import { getSalesMarketingPageContext } from "@/modules/sales-marketing/sales-marketing-page";

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor, permissions } = await getSalesMarketingPageContext();
  const c = await getCampaign(actor, id).catch(() => null);
  if (!c) notFound();
  const [deliveryView, deliveryCreate, deliveryEdit] = await Promise.all((["view", "create", "edit"] as const).map((a) => PermissionService.can(actor.userId, "marketing_delivery", a)));
  const [contentView, contentCreate] = await Promise.all((["view", "create"] as const).map((a) => PermissionService.can(actor.userId, "marketing_content", a)));
  return (
    <>
      <SalesMarketingPageHeader title={`${c.code} · ${c.name}`} breadcrumbs={[{ label: "Campaigns", href: "/sales-marketing/campaigns" }, { label: c.code }]} />
      <CampaignDetailClient key={id} initial={JSON.parse(JSON.stringify(c))} currentUserId={actor.userId} />
      <CampaignAudiencePanel key={`aud-${id}`} campaignId={id} canEdit={permissions.campaigns.edit} canPickSegments={permissions.segments.view} closed={c.status === "COMPLETED" || c.status === "CANCELLED"} />
      {contentView && <CampaignContentPanel key={`content-${id}`} campaignId={id} canCreate={contentCreate} />}
      {deliveryView && <CampaignDeliveryPanel key={`del-${id}`} campaignId={id} canCreate={deliveryCreate} canEdit={deliveryEdit} />}
    </>
  );
}
