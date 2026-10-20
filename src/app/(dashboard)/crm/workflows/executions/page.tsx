import { notFound } from "next/navigation";
import { CrmPageHeader } from "@/components/crm/CrmPageHeader";
import { ExecutionsListClient } from "@/components/crm/workflows/ExecutionsListClient";
import { getCrmPageContext } from "@/modules/crm/core/crm-page";

/** Phase 18 — all workflow executions. */
export default async function CrmWorkflowExecutionsPage() {
  const { permissions } = await getCrmPageContext();
  if (!permissions.settings) notFound();
  return (
    <>
      <CrmPageHeader title="Workflow executions" description="Every time a workflow ran on a record. Failed runs can be retried; waiting runs cancelled." breadcrumbs={[{ label: "Workflows", href: "/crm/workflows" }, { label: "Executions" }]} />
      <ExecutionsListClient />
    </>
  );
}
