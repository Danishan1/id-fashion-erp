import { notFound } from "next/navigation";
import { SalesMarketingPageHeader } from "@/components/sales-marketing/SalesMarketingPageHeader";
import { CampaignForm } from "@/components/sales-marketing/campaigns/CampaignForm";
import { listLinkableCampaigns } from "@/modules/sales-marketing/campaigns/campaign.service";
import { getSalesMarketingPageContext } from "@/modules/sales-marketing/sales-marketing-page";
import { todayIsoDate } from "@/lib/date";

export default async function NewCampaignPage() {
  const { actor, permissions } = await getSalesMarketingPageContext();
  if (!permissions.campaigns.create) notFound();
  const parents = await listLinkableCampaigns(actor);
  const today = todayIsoDate();
  return (
    <>
      <SalesMarketingPageHeader title="New campaign" description="Saved as a draft. Submit it for approval when the plan is ready." breadcrumbs={[{ label: "Campaigns", href: "/sales-marketing/campaigns" }, { label: "New" }]} />
      <CampaignForm
        initial={{ code: "", name: "", description: "", typeId: "", objectiveId: "", ownerUserId: actor.userId, departmentId: "", salesChannelId: "", parentCampaignId: "", priority: "NORMAL", plannedStartDate: today, plannedEndDate: today, plannedBudget: "", budgetNotes: "" }}
        parentOptions={parents.map((p) => ({ id: p.id, label: p.name, sublabel: p.code }))}
      />
    </>
  );
}
