import { CrmPageHeader } from "@/components/crm/CrmPageHeader";
import { getCrmPageContext } from "@/modules/crm/core/crm-page";
import { OpportunitiesListClient } from "./_components/OpportunitiesListClient";

export default async function CrmOpportunitiesPage() {
  const { permissions } = await getCrmPageContext();
  return (
    <>
      <CrmPageHeader title="Opportunities" description={permissions.viewAll ? "All deals in this company." : "Deals you own or created."} breadcrumbs={[{ label: "Opportunities" }]} />
      <OpportunitiesListClient permissions={permissions} />
    </>
  );
}
