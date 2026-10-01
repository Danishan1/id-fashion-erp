import { notFound } from "next/navigation";
import { CrmPageHeader } from "@/components/crm/CrmPageHeader";
import { getCrmPageContext } from "@/modules/crm/core/crm-page";
import { LeadForm } from "../_components/LeadForm";

export default async function NewLeadPage() {
  const { actor, permissions } = await getCrmPageContext();
  if (!permissions.create) notFound();
  return (
    <>
      <CrmPageHeader title="New lead" breadcrumbs={[{ label: "Leads", href: "/crm/leads" }, { label: "New" }]} />
      <LeadForm currentUserId={actor.userId} />
    </>
  );
}
