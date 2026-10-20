import { BulkJobsListClient } from "@/components/bulk/BulkJobsListClient";
import { CrmPageHeader } from "@/components/crm/CrmPageHeader";
import { getCrmPageContext } from "@/modules/crm/core/crm-page";

/** Phase 14 — background bulk jobs (own jobs; CRM admins see everyone's). */
export default async function CrmBulkJobsPage() {
  await getCrmPageContext();
  return (
    <>
      <CrmPageHeader
        title="Bulk jobs"
        description="Bulk actions started from the lead, contact, company and opportunity lists run here in the background. Open a job for its progress, the result per record, the error report or the export file."
        breadcrumbs={[{ label: "Bulk jobs" }]}
      />
      <BulkJobsListClient />
    </>
  );
}
