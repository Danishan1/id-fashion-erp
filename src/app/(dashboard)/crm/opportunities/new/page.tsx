import { notFound } from "next/navigation";
import { CrmPageHeader } from "@/components/crm/CrmPageHeader";
import { getCrmPageContext } from "@/modules/crm/core/crm-page";
import { getOpportunityPrefill } from "@/modules/crm/opportunities/crm-opportunities.service";
import { OpportunityForm } from "../_components/OpportunityForm";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const id = (v?: string) => (v && UUID.test(v) ? v : null);

/** /crm/opportunities/new[?companyId=&contactId=&leadId=] — prefilled from the record it was opened from. */
export default async function NewOpportunityPage({ searchParams }: { searchParams: Promise<{ companyId?: string; contactId?: string; leadId?: string }> }) {
  const { actor, permissions } = await getCrmPageContext();
  if (!permissions.create) notFound();
  const sp = await searchParams;
  const prefill = JSON.parse(JSON.stringify(await getOpportunityPrefill(actor, { companyId: id(sp.companyId), contactId: id(sp.contactId), leadId: id(sp.leadId) })));
  return (
    <>
      <CrmPageHeader title="New opportunity" breadcrumbs={[{ label: "Opportunities", href: "/crm/opportunities" }, { label: "New" }]} />
      <OpportunityForm currentUserId={actor.userId} prefill={prefill} />
    </>
  );
}
