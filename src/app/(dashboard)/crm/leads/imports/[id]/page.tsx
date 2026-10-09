import { notFound } from "next/navigation";
import { CrmPageHeader } from "@/components/crm/CrmPageHeader";
import { getCrmPageContext } from "@/modules/crm/core/crm-page";
import { getImportJob } from "@/modules/crm/imports/crm-import.service";
import { ImportDetailClient } from "../_components/ImportDetailClient";

export default async function ImportDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor, permissions } = await getCrmPageContext();
  if (!permissions.create) notFound();
  const job = await getImportJob(actor, id).catch(() => null);
  if (!job) notFound();
  return (
    <>
      <CrmPageHeader title="Import" breadcrumbs={[{ label: "Leads", href: "/crm/leads" }, { label: "Import history", href: "/crm/leads/imports" }, { label: job.fileName }]} />
      <ImportDetailClient jobId={id} />
    </>
  );
}
