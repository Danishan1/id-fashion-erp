import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { getCampaignById } from "@/modules/marketing/campaign.service";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { CampaignForm } from "../../CampaignForm";

export default async function EditCampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();

  const campaign = await getCampaignById(session!.user.companyId, id).catch(() => null);
  if (!campaign) notFound();

  return (
    <div className="space-y-4">
      <Breadcrumb
        items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Campaigns", href: "/campaigns" },
          { label: campaign.campaignNumber, href: `/campaigns/${id}` },
          { label: "Edit" },
        ]}
      />
      <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Edit {campaign.campaignNumber}</h1>
      <CampaignForm key={id} initialCampaign={JSON.parse(JSON.stringify(campaign))} />
    </div>
  );
}
