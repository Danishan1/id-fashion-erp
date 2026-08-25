import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { getCampaignById } from "@/modules/marketing/campaign.service";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { CampaignWorkflowPanel } from "./CampaignWorkflowPanel";

export default async function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  await PermissionService.assert(session!.user.id, "marketing", "view").catch(() => notFound());

  const campaign = await getCampaignById(session!.user.companyId, id).catch(() => null);
  if (!campaign) notFound();

  return (
    <div className="space-y-4">
      <Breadcrumb items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Campaigns", href: "/campaigns" }, { label: campaign.campaignNumber }]} />
      <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
        {campaign.campaignNumber} — {campaign.name}
      </h1>
      <CampaignWorkflowPanel key={id} campaign={JSON.parse(JSON.stringify(campaign))} />
    </div>
  );
}
