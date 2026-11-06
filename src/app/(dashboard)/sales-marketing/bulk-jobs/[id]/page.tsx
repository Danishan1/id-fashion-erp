import { BulkJobDetailClient } from "@/components/bulk/BulkJobDetailClient";
import { SalesMarketingPageHeader } from "@/components/sales-marketing/SalesMarketingPageHeader";
import { getSalesMarketingPageContext } from "@/modules/sales-marketing/sales-marketing-page";

/** Phase 14 — one S&M bulk job (access is checked by the API: own job, or S&M admin). */
export default async function SalesMarketingBulkJobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await getSalesMarketingPageContext();
  return (
    <>
      <SalesMarketingPageHeader title="Bulk job" breadcrumbs={[{ label: "Bulk jobs", href: "/sales-marketing/bulk-jobs" }, { label: "Job" }]} />
      <BulkJobDetailClient key={id} id={id} basePath="/sales-marketing/bulk-jobs" schedulesHref="/sales-marketing/bulk-jobs?tab=schedules" />
    </>
  );
}
