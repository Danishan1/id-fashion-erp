import { CrmPageHeader } from "@/components/crm/CrmPageHeader";
import { getCrmPageContext } from "@/modules/crm/core/crm-page";
import { CompaniesListClient } from "./_components/CompaniesListClient";

export default async function CrmCompaniesPage() {
  const { permissions } = await getCrmPageContext();
  return (
    <>
      <CrmPageHeader title="Companies" description={permissions.viewAll ? "All CRM companies and accounts." : "Companies you own or created."} breadcrumbs={[{ label: "Companies" }]} />
      <CompaniesListClient permissions={permissions} />
    </>
  );
}
