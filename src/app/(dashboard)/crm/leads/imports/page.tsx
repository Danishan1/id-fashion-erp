import { notFound } from "next/navigation";
import { CrmPageHeader } from "@/components/crm/CrmPageHeader";
import { getCrmPageContext } from "@/modules/crm/core/crm-page";
import { ImportHistoryClient } from "./_components/ImportHistoryClient";

export default async function ImportHistoryPage() {
  const { permissions } = await getCrmPageContext();
  if (!permissions.create) notFound();
  return (
    <>
      <CrmPageHeader
        title="Import history"
        description={permissions.viewAll ? "Every lead import in this company." : "Imports you have uploaded."}
        breadcrumbs={[{ label: "Leads", href: "/crm/leads" }, { label: "Import history" }]}
      />
      <ImportHistoryClient canSeeSubmissions={permissions.settings} canEditSettings={permissions.settingsEdit} />
    </>
  );
}
