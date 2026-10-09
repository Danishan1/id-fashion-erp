import { notFound } from "next/navigation";
import { CrmPageHeader } from "@/components/crm/CrmPageHeader";
import { getCrmPageContext } from "@/modules/crm/core/crm-page";
import { getOpportunity } from "@/modules/crm/opportunities/crm-opportunities.service";
import { isClosedStatus } from "@/modules/crm/opportunities/opportunity-registry";
import { OpportunityForm } from "../../_components/OpportunityForm";
import type { OpportunityDetailDto } from "../../_components/opportunity-types";

/** Only open, non-archived opportunities are edited (closed ones are reopened first). */
export default async function EditOpportunityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor, permissions } = await getCrmPageContext();
  if (!permissions.edit) notFound();
  const opportunity = await getOpportunity(actor, id).catch(() => null);
  if (!opportunity || opportunity.archivedAt || isClosedStatus(opportunity.status)) notFound();
  const dto = JSON.parse(JSON.stringify(opportunity)) as OpportunityDetailDto;
  return (
    <>
      <CrmPageHeader title={`Edit ${dto.name}`} breadcrumbs={[{ label: "Opportunities", href: "/crm/opportunities" }, { label: dto.name, href: `/crm/opportunities/${dto.id}` }, { label: "Edit" }]} />
      <OpportunityForm opportunity={dto} currentUserId={actor.userId} />
    </>
  );
}
