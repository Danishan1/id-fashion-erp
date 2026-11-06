import { SalesMarketingPageHeader } from "@/components/sales-marketing/SalesMarketingPageHeader";
import { SmWorkflowsClient } from "@/components/sales-marketing/workflows/SmWorkflowsClient";
import { getSalesMarketingPageContext } from "@/modules/sales-marketing/sales-marketing-page";

/** Phase 15 — Sales & Marketing → Workflows: switch workflows on, configure them, and monitor the running ones. */
export default async function SalesMarketingWorkflowsPage({ searchParams }: { searchParams: Promise<{ tab?: string; status?: string }> }) {
  await getSalesMarketingPageContext();
  const { tab, status } = await searchParams;
  return (
    <>
      <SalesMarketingPageHeader
        title="Workflows"
        description="Workflows follow enquiries, quotations, campaigns, budget alerts and background processing through the steps you already use — giving people tasks, reminding and escalating, and recording what happened. People still approve, convert and launch."
        breadcrumbs={[{ label: "Workflows" }]}
      />
      <SmWorkflowsClient initialTab={tab === "instances" || status ? "instances" : "definitions"} initialStatuses={status ? status.split(",").filter(Boolean) : []} />
    </>
  );
}
