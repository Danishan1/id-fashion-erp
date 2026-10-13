import { notFound } from "next/navigation";
import { CrmPageHeader } from "@/components/crm/CrmPageHeader";
import { WorkflowDetailClient } from "@/components/crm/workflows/WorkflowDetailClient";
import { getCrmPageContext } from "@/modules/crm/core/crm-page";

/** Phase 18 — one workflow (builder, test, versions, executions). */
export default async function CrmWorkflowPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { permissions } = await getCrmPageContext();
  if (!permissions.settings) notFound();
  return (
    <>
      <CrmPageHeader title="Workflow" breadcrumbs={[{ label: "Workflows", href: "/crm/workflows" }, { label: "Workflow" }]} />
      <WorkflowDetailClient key={id} id={id} permissions={permissions} />
    </>
  );
}
