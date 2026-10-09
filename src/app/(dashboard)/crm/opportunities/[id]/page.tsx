import { notFound } from "next/navigation";
import { CrmPageHeader } from "@/components/crm/CrmPageHeader";
import { getCrmPageContext } from "@/modules/crm/core/crm-page";
import { getOpportunity } from "@/modules/crm/opportunities/crm-opportunities.service";
import { OpportunityDetailClient } from "../_components/OpportunityDetailClient";
import type { OpportunityDetailDto } from "../_components/opportunity-types";

export default async function OpportunityDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor, permissions } = await getCrmPageContext();
  const opportunity = await getOpportunity(actor, id).catch(() => null);
  if (!opportunity) notFound();
  // Same JSON shape the API returns (Date → ISO string, Decimal → string).
  const dto = JSON.parse(JSON.stringify(opportunity)) as OpportunityDetailDto;
  return (
    <>
      <CrmPageHeader title="Opportunity" breadcrumbs={[{ label: "Opportunities", href: "/crm/opportunities" }, { label: dto.name }]} />
      <OpportunityDetailClient initialOpportunity={dto} permissions={permissions} currentUserId={actor.userId} />
    </>
  );
}
