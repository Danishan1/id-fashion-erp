import { SalesMarketingPageHeader } from "@/components/sales-marketing/SalesMarketingPageHeader";
import { SmWorkflowInstanceClient } from "@/components/sales-marketing/workflows/SmWorkflowInstanceClient";
import { getSalesMarketingPageContext } from "@/modules/sales-marketing/sales-marketing-page";

/** Phase 15 — one workflow run: plan, tasks, history, operator actions. */
export default async function SmWorkflowInstancePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ existing?: string }> }) {
  await getSalesMarketingPageContext();
  const { id } = await params;
  const { existing } = await searchParams;
  return (
    <>
      <SalesMarketingPageHeader title="Workflow" breadcrumbs={[{ label: "Workflows", href: "/sales-marketing/workflows?tab=instances" }, { label: "Workflow" }]} />
      <SmWorkflowInstanceClient key={id} id={id} existing={existing === "1"} />
    </>
  );
}
