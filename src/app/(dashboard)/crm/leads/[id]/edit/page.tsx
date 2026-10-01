import { notFound } from "next/navigation";
import { CrmPageHeader } from "@/components/crm/CrmPageHeader";
import { getCrmPageContext } from "@/modules/crm/core/crm-page";
import { getLead } from "@/modules/crm/leads/lead.service";
import { LeadForm } from "../../_components/LeadForm";
import type { LeadDetailDto } from "../../_components/lead-types";

export default async function EditLeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor, permissions } = await getCrmPageContext();
  if (!permissions.edit) notFound();
  const lead = await getLead(actor, id).catch(() => null);
  if (!lead || lead.archivedAt) notFound();
  const dto = JSON.parse(JSON.stringify(lead)) as LeadDetailDto;
  return (
    <>
      <CrmPageHeader
        title={`Edit ${dto.fullName}`}
        breadcrumbs={[{ label: "Leads", href: "/crm/leads" }, { label: dto.leadNumber, href: `/crm/leads/${dto.id}` }, { label: "Edit" }]}
      />
      <LeadForm lead={dto} currentUserId={actor.userId} />
    </>
  );
}
