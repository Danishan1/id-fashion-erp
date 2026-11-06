import { notFound } from "next/navigation";
import { SalesMarketingPageHeader } from "@/components/sales-marketing/SalesMarketingPageHeader";
import { SmWorkflowDefinitionClient } from "@/components/sales-marketing/workflows/SmWorkflowDefinitionClient";
import { getSalesMarketingPageContext } from "@/modules/sales-marketing/sales-marketing-page";
import { SM_WORKFLOW_KEYS, SM_WORKFLOWS, type SmWorkflowKey } from "@/modules/sales-marketing/workflows/sm-workflow-registry";

/** Phase 15 — one workflow type: settings, entry conditions, versions, switch on / off, start on a record. */
export default async function SmWorkflowDefinitionPage({ params }: { params: Promise<{ key: string }> }) {
  await getSalesMarketingPageContext();
  const { key } = await params;
  if (!(SM_WORKFLOW_KEYS as string[]).includes(key)) notFound();
  return (
    <>
      <SalesMarketingPageHeader title={SM_WORKFLOWS[key as SmWorkflowKey].name} breadcrumbs={[{ label: "Workflows", href: "/sales-marketing/workflows" }, { label: SM_WORKFLOWS[key as SmWorkflowKey].name }]} />
      <SmWorkflowDefinitionClient key={key} workflowKey={key} />
    </>
  );
}
