import { notFound } from "next/navigation";
import { CrmPageHeader } from "@/components/crm/CrmPageHeader";
import { WorkflowsListClient } from "@/components/crm/workflows/WorkflowsListClient";
import { getCrmPageContext } from "@/modules/crm/core/crm-page";

/** Phase 18 — workflow automation (configuration: needs CRM settings access). */
export default async function CrmWorkflowsPage() {
  const { permissions } = await getCrmPageContext();
  if (!permissions.settings) notFound();
  return (
    <>
      <CrmPageHeader title="Workflows" description="Automate follow-ups: when something happens in the CRM, check conditions and run actions. Only published workflows run." breadcrumbs={[{ label: "Workflows" }]} />
      <WorkflowsListClient permissions={permissions} />
    </>
  );
}
