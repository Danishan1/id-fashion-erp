import { CrmPageHeader } from "@/components/crm/CrmPageHeader";
import { getCrmPageContext } from "@/modules/crm/core/crm-page";
import { LeadsListClient } from "./_components/LeadsListClient";

export default async function CrmLeadsPage() {
  const { permissions } = await getCrmPageContext();
  return (
    <>
      <CrmPageHeader
        title="Leads"
        description={permissions.viewAll ? "All leads in this company." : "Leads you own or created."}
        breadcrumbs={[{ label: "Leads" }]}
      />
      <LeadsListClient permissions={permissions} />
    </>
  );
}
