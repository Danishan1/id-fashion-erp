import { BulkJobDetailClient } from "@/components/bulk/BulkJobDetailClient";
import { CrmPageHeader } from "@/components/crm/CrmPageHeader";
import { getCrmPageContext } from "@/modules/crm/core/crm-page";

/** Phase 14 — one bulk job (access is checked by the API: own job, or CRM admin). */
export default async function CrmBulkJobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await getCrmPageContext();
  return (
    <>
      <CrmPageHeader title="Bulk job" breadcrumbs={[{ label: "Bulk jobs", href: "/crm/bulk-jobs" }, { label: "Job" }]} />
      <BulkJobDetailClient key={id} id={id} />
    </>
  );
}
