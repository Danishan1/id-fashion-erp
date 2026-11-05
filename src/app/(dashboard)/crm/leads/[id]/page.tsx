import { notFound } from "next/navigation";
import { CrmPageHeader } from "@/components/crm/CrmPageHeader";
import { CampaignLinkPanel } from "@/components/sales-marketing/campaigns/CampaignLinkPanel";
import { getCrmPageContext } from "@/modules/crm/core/crm-page";
import { getLead } from "@/modules/crm/leads/lead.service";
import { LeadDetailClient } from "../_components/LeadDetailClient";
import type { LeadDetailDto } from "../_components/lead-types";

export default async function LeadDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ convert?: string }> }) {
  const { id } = await params;
  const { convert } = await searchParams;
  const { actor, permissions } = await getCrmPageContext();
  const lead = await getLead(actor, id).catch(() => null);
  if (!lead) notFound();
  // Same JSON shape the API returns (Decimal → string, Date → ISO string).
  const dto = JSON.parse(JSON.stringify(lead)) as LeadDetailDto;
  return (
    <>
      <CrmPageHeader title="Lead" breadcrumbs={[{ label: "Leads", href: "/crm/leads" }, { label: dto.leadNumber }]} />
      {/* Marketing campaign (Sales & Marketing Phase 08) — loads itself; hidden without access. */}
      <div className="mb-4">
        <CampaignLinkPanel key={`campaign-${dto.id}`} docType="lead" id={dto.id} canChange={permissions.edit} />
      </div>
      <LeadDetailClient initialLead={dto} permissions={permissions} openConvert={convert === "1"} />
    </>
  );
}
