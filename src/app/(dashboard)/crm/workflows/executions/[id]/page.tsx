import { notFound } from "next/navigation";
import { CrmPageHeader } from "@/components/crm/CrmPageHeader";
import { ExecutionDetailClient } from "@/components/crm/workflows/ExecutionDetailClient";
import { getCrmPageContext } from "@/modules/crm/core/crm-page";

/** Phase 18 — one execution with its step trace. */
export default async function CrmWorkflowExecutionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { permissions } = await getCrmPageContext();
  if (!permissions.settings) notFound();
  return (
    <>
      <CrmPageHeader title="Workflow execution" breadcrumbs={[{ label: "Workflows", href: "/crm/workflows" }, { label: "Executions", href: "/crm/workflows/executions" }, { label: "Execution" }]} />
      <ExecutionDetailClient key={id} id={id} canEdit={permissions.settingsEdit} />
    </>
  );
}
