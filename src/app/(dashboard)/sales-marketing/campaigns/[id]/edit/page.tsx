import { notFound } from "next/navigation";
import { SalesMarketingPageHeader } from "@/components/sales-marketing/SalesMarketingPageHeader";
import { CampaignForm } from "@/components/sales-marketing/campaigns/CampaignForm";
import { listLinkableCampaigns } from "@/modules/sales-marketing/campaigns/campaign.service";
import { getCampaign } from "@/modules/sales-marketing/campaigns/campaign-results.service";
import { getSalesMarketingPageContext } from "@/modules/sales-marketing/sales-marketing-page";

export default async function EditCampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor } = await getSalesMarketingPageContext();
  const c = await getCampaign(actor, id).catch(() => null);
  if (!c || !c.can.edit) notFound();
  const parents = await listLinkableCampaigns(actor);
  return (
    <>
      <SalesMarketingPageHeader title={`Edit ${c.code}`} breadcrumbs={[{ label: "Campaigns", href: "/sales-marketing/campaigns" }, { label: c.code, href: `/sales-marketing/campaigns/${c.id}` }, { label: "Edit" }]} />
      <CampaignForm
        key={id}
        planLocked={c.status !== "DRAFT"}
        initial={{
          id: c.id,
          code: c.code,
          name: c.name,
          description: c.description ?? "",
          typeId: c.type.id,
          objectiveId: c.objective.id,
          ownerUserId: c.owner.id,
          departmentId: c.department?.id ?? "",
          salesChannelId: c.salesChannel?.id ?? "",
          parentCampaignId: c.parent?.id ?? "",
          priority: c.priority,
          plannedStartDate: c.plannedStartDate,
          plannedEndDate: c.plannedEndDate,
          plannedBudget: c.plannedBudget === null ? "" : String(c.plannedBudget),
          budgetNotes: c.budgetNotes ?? "",
          version: c.version,
        }}
        currentLabels={{ typeId: c.type.name, objectiveId: c.objective.name, ownerUserId: c.owner.fullName, departmentId: c.department?.name, salesChannelId: c.salesChannel?.name }}
        parentOptions={[...(c.parent && !parents.some((p) => p.id === c.parent!.id) ? [{ id: c.parent.id, code: c.parent.code, name: c.parent.name, status: "" }] : []), ...parents].map((p) => ({ id: p.id, label: p.name, sublabel: p.code }))}
      />
    </>
  );
}
