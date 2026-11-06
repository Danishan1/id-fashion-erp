import { SalesMarketingPageHeader } from "@/components/sales-marketing/SalesMarketingPageHeader";
import { SmBulkJobsClient } from "@/components/sales-marketing/bulk/SmBulkJobsClient";
import { getSalesMarketingPageContext } from "@/modules/sales-marketing/sales-marketing-page";

/** Phase 14 — Sales & Marketing → Bulk jobs: background jobs on S&M records (own; S&M admins see all) and saved schedules. */
export default async function SalesMarketingBulkJobsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  await getSalesMarketingPageContext();
  const { tab } = await searchParams;
  return (
    <>
      <SalesMarketingPageHeader
        title="Bulk jobs"
        description="Bulk actions started from the enquiry, quotation, campaign, promotion and attribution-model lists run here in the background — including dry runs and scheduled exports / recalculations. Open a job for its progress, the result per record, the error report or the export file."
        breadcrumbs={[{ label: "Bulk jobs" }]}
      />
      <SmBulkJobsClient initialTab={tab === "schedules" ? "schedules" : "jobs"} />
    </>
  );
}
