import { CrmPageHeader } from "@/components/crm/CrmPageHeader";
import { getCrmPageContext } from "@/modules/crm/core/crm-page";
import { ContactsListClient } from "./_components/ContactsListClient";

export default async function CrmContactsPage() {
  const { permissions } = await getCrmPageContext();
  return (
    <>
      <CrmPageHeader title="Contacts" description={permissions.viewAll ? "All contacts in this company." : "Contacts you own or created."} breadcrumbs={[{ label: "Contacts" }]} />
      <ContactsListClient permissions={permissions} />
    </>
  );
}
